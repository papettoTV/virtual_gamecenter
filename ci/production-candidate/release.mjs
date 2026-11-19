import { ProductionCloudflareError } from './cloudflare-release.mjs';
import { verifyProductionApproval } from './approval.mjs';
import { sanitizeBrowserFailure } from '../control/fixed-process.mjs';
import { setTimeout as delay } from 'node:timers/promises';
import { assertProductionPagesConfiguration, executeProductionPublication, pagesUploadConfigHash } from './publication.mjs';

const sha = /^[a-f0-9]{40}$/;
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const targets = ['worker', 'pages'];

export class ProductionPromotionRejected extends Error {}

function requireMatch(condition, description) {
  if (!condition) throw Error(description);
}

function same(left, right) {
  return left.deploymentId === right.deploymentId && left.versionId === right.versionId
    && left.revision === right.revision;
}

function checkState(state) {
  requireMatch(uuid.test(state?.worker?.deploymentId ?? '') && uuid.test(state.worker.versionId ?? '')
    && uuid.test(state?.pages?.deploymentId ?? '') && sha.test(state.pages.revision ?? ''),
  '実際に配信中のWorkerとPagesを確認できません。');
  return state;
}

export async function runApprovedProductionRelease({ candidate, plan, context, github, cloudflare, regression, pause = delay }) {
  const revision = candidate.sha;
  const mainBefore = candidate.mainSha;
  requireMatch(sha.test(revision ?? '') && sha.test(mainBefore ?? '') && revision !== mainBefore
    && plan.sha === revision, '承認対象と公開計画のSHAが一致しません。');
  const report = { revision, mainBefore, phase: 'approval', success: false,
    httpPassed: false, browserPassed: false, mainUpdated: false,
    attempted: [], rollback: { status: 'not-needed', pages: false, worker: false } };
  const owned = {};
  const pending = {};
  let before;
  let beforePages;
  let operation = 'approval';
  let mainWriteAttempted = false;
  let mainWriteUncertain = false;

  const guard = async () => {
    await verifyProductionApproval({ api: github.api, context });
    await github.guard(candidate);
    requireMatch(await github.main() === mainBefore, '本番公開中にmainが変わりました。');
  };

  const observePublication = observed => {
    for (const target of targets) {
      if (same(observed[target], owned[target] ?? before[target])) continue;
      const expected = pending[target];
      if (expected && observed[target].deploymentId !== before[target].deploymentId
        && (target === 'worker' ? observed.worker.versionId === expected
          : observed.pages.deploymentId === expected && observed.pages.revision === revision)) {
        owned[target] = observed[target];
        delete pending[target];
        report.published = { ...owned };
        continue;
      }
      throw new ProductionCloudflareError(target, 'deployment-changed');
    }
  };

  const waitForPublication = async (read, target) => {
    for (let attempt = 0; ; attempt += 1) {
      const observed = checkState(await read());
      observePublication(observed);
      if (target ? owned[target] : Object.keys(pending).length === 0) return observed;
      if (attempt === 15) throw new ProductionCloudflareError('publication-readback', 'publication-not-visible');
      await pause(2000);
    }
  };

  try {
    await guard();
    report.phase = operation = 'preflight';
    await github.preflight(candidate);
    before = checkState(await cloudflare.current());
    beforePages = await cloudflare.project();
    requireMatch(beforePages.canonical_deployment?.id === before.pages.deploymentId, '公開前にPagesの配信が変わりました。');
    report.previous = before;
    requireMatch(before.pages.revision === mainBefore, '切り戻し候補とmainのSHAが一致しません。');
    await regression.http(mainBefore);
    const transport = {
      project: () => cloudflare.project(),
      execute: async (target, args, cwd) => {
        report.phase = target;
        operation = 'before-' + target;
        const state = checkState(await cloudflare.current());
        for (const surface of targets) {
          if (!same(state[surface], owned[surface] ?? before[surface])) {
            throw new ProductionCloudflareError(surface, 'deployment-changed');
          }
        }
        report.attempted.push(target);
        operation = 'publish-' + target;
        const publishedId = await cloudflare.execute(target, args, cwd);
        operation = 'readback-' + target;
        requireMatch(uuid.test(publishedId ?? '')
          && publishedId !== (target === 'worker' ? state.worker.versionId : state.pages.deploymentId),
        'この実行の公開識別子を確認できません。');
        pending[target] = publishedId;
        await waitForPublication(() => cloudflare.current(), target);
        operation = 'publication-guard';
        return owned[target];
      },
    };
    await executeProductionPublication(plan, { guard, transport, pause });

    report.phase = operation = 'http';
    await guard();
    await regression.http(revision);
    report.httpPassed = true;
    report.phase = operation = 'browser';
    await guard();
    requireMatch(await regression.browser(revision) === 8, '本番ブラウザ回帰8件が確認できません。');
    report.browserPassed = true;

    report.phase = operation = 'main';
    await guard();
    const published = checkState(await cloudflare.current());
    requireMatch(targets.every(target => same(published[target], owned[target])), '回帰後に配信が変わりました。');
    operation = 'main-pages-configuration';
    assertProductionPagesConfiguration(beforePages, await cloudflare.project(), await pagesUploadConfigHash(plan));
    mainWriteAttempted = true;
    try {
      await github.promote(revision);
    } catch (error) {
      mainWriteUncertain = !(error instanceof ProductionPromotionRejected);
    }
    report.mainUpdated = await github.main() === revision;
    requireMatch(report.mainUpdated, 'mainの反映を確認できません。');
    report.phase = 'complete';
    report.success = true;
  } catch (error) {
    const cause = error.cause ?? error;
    report.failure = { step: error.phase?.startsWith('pages-') ? error.phase : operation, ...(cause instanceof ProductionCloudflareError ? cause.diagnostic : {}) };
    if (operation === 'browser' && cause.browserFailure) report.browserFailure = sanitizeBrowserFailure(cause.browserFailure);
    if (report.attempted.length === 0) return report;
    report.rollback.status = 'needs-attention';
    let rollbackStep = 'main';
    try {
      if (mainWriteUncertain) return report;
      if (mainWriteAttempted && await github.main() !== mainBefore) return report;
      rollbackStep = 'ownership';
      const readForRollback = async () => checkState(await cloudflare.current({ verifyWorkerPrivacy: false }));
      const assertOwned = observed => {
        for (const target of targets) {
          if (!same(observed[target], before[target]) && !(owned[target] && same(observed[target], owned[target]))) {
            throw new ProductionCloudflareError(target, 'deployment-changed');
          }
        }
      };
      const current = await waitForPublication(readForRollback);
      assertOwned(current);

      for (const target of ['pages', 'worker']) {
        if (same(current[target], before[target])) continue;
        rollbackStep = 'restore-' + target;
        const observed = await readForRollback();
        // A Worker restore creates a fresh deployment ID. Pages restores its previous deployment ID.
        assertOwned(observed);
        if (same(observed[target], before[target])) continue;
        if (await github.main() !== mainBefore) return report;
        await cloudflare.rollback(target, before[target], owned[target]);
        report.rollback[target] = true;
      }
      rollbackStep = 'deployment-readback';
      // Poll reads only, and only while seeing the known rollout or the expected restore.
      for (let attempt = 0; ; attempt += 1) {
        const restored = checkState(await cloudflare.current());
        const pagesRestored = same(restored.pages, before.pages);
        const workerRestored = restored.worker.versionId === before.worker.versionId;
        if (pagesRestored && workerRestored) break;
        if ((!pagesRestored && !(owned.pages && same(restored.pages, owned.pages)))
          || (!workerRestored && !(owned.worker && same(restored.worker, owned.worker)))) {
          throw new ProductionCloudflareError('rollback-readback', 'deployment-changed');
        }
        if (attempt === 5) throw new ProductionCloudflareError('rollback-readback', 'restore-not-visible');
        await pause(2000);
      }
      rollbackStep = 'http';
      await regression.http(mainBefore);
      rollbackStep = 'pages-configuration';
      assertProductionPagesConfiguration(beforePages, await cloudflare.project(), owned.pages ? await pagesUploadConfigHash(plan) : undefined);
      report.rollback.status = 'verified';
    } catch (error) {
      report.rollbackFailure = { step: rollbackStep, ...(error instanceof ProductionCloudflareError ? error.diagnostic : {}) };
    }
  }
  return report;
}
