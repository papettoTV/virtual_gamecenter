import { ProductionCloudflareError } from './cloudflare-release.mjs';
import { verifyProductionApproval } from './approval.mjs';
import { executeProductionPublication } from './publication.mjs';
import { samePagesConfiguration } from '../control/staging-publication.mjs';

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

export async function runApprovedProductionRelease({ candidate, plan, context, github, cloudflare, regression }) {
  const revision = candidate.sha;
  const mainBefore = candidate.mainSha;
  requireMatch(sha.test(revision ?? '') && sha.test(mainBefore ?? '') && revision !== mainBefore
    && plan.sha === revision, '承認対象と公開計画のSHAが一致しません。');
  const report = { revision, mainBefore, phase: 'approval', success: false,
    httpPassed: false, browserPassed: false, mainUpdated: false,
    attempted: [], rollback: { status: 'not-needed', pages: false, worker: false } };
  const owned = {};
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
        const updated = checkState(await cloudflare.current());
        requireMatch(updated[target].deploymentId !== state[target].deploymentId
          && uuid.test(publishedId ?? '')
          && (target === 'worker' ? updated.worker.versionId === publishedId && publishedId !== state.worker.versionId
            : updated.pages.deploymentId === publishedId && updated.pages.revision === revision),
        'この実行の公開先を確認できません。');
        owned[target] = updated[target];
        report.published = { ...owned };
        operation = 'publication-guard';
      },
    };
    await executeProductionPublication(plan, { guard, transport });

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
    report.failure = { step: operation, ...(cause instanceof ProductionCloudflareError ? cause.diagnostic : {}) };
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
      const current = await readForRollback();
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
      rollbackStep = 'verify';
      const restored = checkState(await cloudflare.current());
      requireMatch(restored.pages.deploymentId === before.pages.deploymentId
        && restored.worker.versionId === before.worker.versionId, '切り戻し先が一致しません。');
      await regression.http(mainBefore);
      requireMatch(samePagesConfiguration(beforePages, await cloudflare.project()), 'Pagesの共有設定に差分があります。');
      report.rollback.status = 'verified';
    } catch (error) {
      report.rollbackFailure = { step: rollbackStep, ...(error instanceof ProductionCloudflareError ? error.diagnostic : {}) };
    }
  }
  return report;
}
