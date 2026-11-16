import { setTimeout as delay } from 'node:timers/promises';
import { assertStagingPages } from '../control/staging-publication.mjs';

const apiOrigin = 'https://api.cloudflare.com/client/v4/accounts/60e5472a284dc71bbafbbfac8aa2a940';
const worker = '/workers/scripts/pulbase-production';
const pages = '/pages/projects/virtual-gamecenter';
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;

function requireMatch(condition, description) {
  if (!condition) throw Error(description);
}

export class ProductionCloudflareError extends Error {
  constructor(operation, reason, status) {
    super('Cloudflareの本番配信を確認できません。');
    this.diagnostic = { operation, reason, ...(status === undefined ? {} : { status }) };
  }
}

export function productionCloudflare({ workerToken, pagesToken, execute, request = fetch, pause = delay }) {
  requireMatch(typeof workerToken === 'string' && workerToken.length > 0 && typeof pagesToken === 'string'
    && pagesToken.length > 0 && workerToken !== pagesToken && typeof execute === 'function', '本番専用の分離された認証が必要です。');

  async function api(target, operation, path, method = 'GET', body) {
    const token = target === 'worker' ? workerToken : pagesToken;
    const options = {
      method, redirect: 'error',
      headers: { Authorization: 'Bearer ' + token, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    };
    // A failed write may still have reached Cloudflare. Only retry reads.
    for (let attempt = 0; ; attempt += 1) {
      let response;
      try {
        response = await request(apiOrigin + path, { ...options, signal: AbortSignal.timeout(15000) });
      } catch {
        if (method !== 'GET' || attempt === 2) throw new ProductionCloudflareError(operation, 'network');
        await pause(1000 * (attempt + 1));
        continue;
      }
      if (method === 'GET' && attempt < 2 && (response.status === 429 || response.status >= 500)) {
        await response.body?.cancel();
        await pause(1000 * (attempt + 1));
        continue;
      }
      if (!response.ok) throw new ProductionCloudflareError(operation, 'http', response.status);
      const data = await response.json().catch(() => null);
      if (data?.success !== true || !data.result) throw new ProductionCloudflareError(operation, 'api-response');
      return data.result;
    }
  }

  async function project() {
    const config = await api('pages', 'pages-project', pages);
    try {
      assertStagingPages(config);
      requireMatch(config.domains?.includes('pulbase.com'), '本番ドメインが一致しません。');
    } catch {
      throw new ProductionCloudflareError('pages-project', 'configuration');
    }
    return config;
  }

  async function activeWorker() {
    const deployments = await api('worker', 'worker-deployments', worker + '/deployments');
    // Cloudflare defines the first deployment as the one actively serving traffic.
    const active = deployments.deployments?.[0];
    if (!uuid.test(active?.id ?? '') || active.versions?.length !== 1
      || active.versions[0].percentage !== 100 || !uuid.test(active.versions[0].version_id ?? '')) {
      throw new ProductionCloudflareError('worker-deployments', 'active-deployment');
    }
    return { deploymentId: active.id, versionId: active.versions[0].version_id };
  }

  async function activePages() {
    const active = (await project()).canonical_deployment;
    const revision = active?.deployment_trigger?.metadata?.commit_hash;
    if (!uuid.test(active?.id ?? '') || active.environment !== 'production'
      || active.latest_stage?.status !== 'success' || !/^[a-f0-9]{40}$/.test(revision ?? '')) {
      throw new ProductionCloudflareError('pages-project', 'active-deployment');
    }
    return { deploymentId: active.id, revision };
  }

  async function assertWorkerPrivate() {
    const site = await api('worker', 'worker-subdomain', worker + '/subdomain');
    if (site.enabled !== false || site.previews_enabled !== false) {
      throw new ProductionCloudflareError('worker-subdomain', 'configuration');
    }
  }

  async function current({ verifyWorkerPrivacy = true } = {}) {
    const [workerState, pagesState] = await Promise.all([activeWorker(), activePages(),
      verifyWorkerPrivacy ? assertWorkerPrivate() : undefined]);
    return { worker: workerState, pages: pagesState };
  }

  return {
    project,
    current,
    async execute(target, args, cwd) {
      requireMatch(target === 'worker' || target === 'pages', '対象外の公開を拒否しました。');
      const published = await execute(target, args, cwd, target === 'worker' ? workerToken : pagesToken);
      if (target === 'worker') return published;
      const active = (await project()).canonical_deployment;
      requireMatch(/^https:\/\/[a-f0-9]+\.virtual-gamecenter\.pages\.dev$/.test(published ?? '')
        && active?.url === published && uuid.test(active.id ?? ''), 'Pagesの公開操作と配信IDが一致しません。');
      return active.id;
    },
    async rollback(target, before, expected) {
      requireMatch((target === 'pages' || target === 'worker') && uuid.test(before.deploymentId ?? ''),
        '切り戻し先が不正です。');
      const now = await (target === 'worker' ? activeWorker() : activePages());
      requireMatch(now.deploymentId === expected.deploymentId && now.versionId === expected.versionId,
        '切り戻し直前に公開先が変わりました。');
      if (target === 'pages') {
        const previous = await api('pages', 'pages-rollback-source', pages + '/deployments/' + before.deploymentId);
        requireMatch(previous.id === before.deploymentId && previous.environment === 'production'
          && previous.latest_stage?.status === 'success'
          && previous.deployment_trigger?.metadata?.commit_hash === before.revision, '以前のPages配信を確認できません。');
        await api('pages', 'pages-rollback', pages + '/deployments/' + before.deploymentId + '/rollback', 'POST');
      } else {
        requireMatch(uuid.test(before.versionId ?? ''), '切り戻しWorkerバージョンが不正です。');
        await api('worker', 'worker-rollback', worker + '/deployments', 'POST', {
          strategy: 'percentage', versions: [{ version_id: before.versionId, percentage: 100 }],
        });
      }
    },
  };
}
