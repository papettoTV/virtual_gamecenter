import { rm } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { productionCloudflare } from './cloudflare-release.mjs';
import { prepareProductionPublication } from './publication.mjs';
import { checkPublicProductionBrowser, checkPublicProductionHttp } from './public-regression.mjs';
import { fixedProductionWrangler } from './public-wrangler.mjs';
import { runApprovedProductionRelease } from './release.mjs';

export async function verifyUnchangedProductionMigrations(api, main, candidate) {
  if (![main, candidate].every(value => /^[a-f0-9]{40}$/.test(value ?? ''))) throw Error('移行照合のSHAが不正です。');
  const subtree = async revision => {
    const result = await api('git/trees/' + revision + '?recursive=1');
    const matches = result.tree?.filter(entry => entry.path === 'apps/web/migrations' && entry.type === 'tree');
    if (result.truncated !== false || matches?.length !== 1 || !/^[a-f0-9]{40}$/.test(matches[0].sha ?? '')) {
      throw Error('D1の移行定義を確認できません。');
    }
    return matches[0].sha;
  };
  const [before, next] = await Promise.all([subtree(main), subtree(candidate)]);
  if (before !== next) throw Error('D1移行を含む候補では自動公開を停止します。');
}

async function waitForProductionHttp(revision) {
  for (let attempt = 1; attempt <= 8; attempt += 1) {
    try {
      return await checkPublicProductionHttp(revision);
    } catch (error) {
      if (attempt === 8) throw error;
      await delay(3000);
    }
  }
}

// Invoked by a protected job once its immutable artifact and GitHub adapter are available.
export async function executeApprovedProduction({ candidate, artifact, scope, context, github, workerToken, pagesToken }) {
  const plan = await prepareProductionPublication(artifact, scope);
  try {
    return await runApprovedProductionRelease({
      candidate, plan, context,
      github: { ...github, preflight: async selected => {
        await github.preflight(selected);
        await verifyUnchangedProductionMigrations(github.api, selected.mainSha, selected.sha);
      } },
      cloudflare: productionCloudflare({ workerToken, pagesToken, execute: fixedProductionWrangler(plan) }),
      regression: { http: waitForProductionHttp, browser: checkPublicProductionBrowser },
    });
  } finally {
    await rm(plan.directory, { recursive: true, force: true });
  }
}
