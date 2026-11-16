import { assertStagingPages } from '../control/staging-publication.mjs';

const apiOrigin = 'https://api.cloudflare.com/client/v4/accounts/60e5472a284dc71bbafbbfac8aa2a940';
const worker = '/workers/scripts/pulbase-production';
const pages = '/pages/projects/virtual-gamecenter';
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;

function requireMatch(condition, description) {
  if (!condition) throw Error(description);
}

export function productionCloudflare({ workerToken, pagesToken, execute, request = fetch }) {
  requireMatch(typeof workerToken === 'string' && workerToken.length > 0 && typeof pagesToken === 'string'
    && pagesToken.length > 0 && workerToken !== pagesToken && typeof execute === 'function', '本番専用の分離された認証が必要です。');

  async function api(target, path, method = 'GET', body) {
    const token = target === 'worker' ? workerToken : pagesToken;
    try {
      const response = await request(apiOrigin + path, {
        method, redirect: 'error', signal: AbortSignal.timeout(15000),
        headers: { Authorization: 'Bearer ' + token, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const data = await response.json();
      if (!response.ok || data.success !== true || !data.result) throw Error();
      return data.result;
    } catch {
      throw Error('Cloudflareの本番' + (target === 'worker' ? 'Worker' : 'Pages') + 'を確認できません。');
    }
  }

  async function project() {
    const config = await api('pages', pages);
    assertStagingPages(config);
    requireMatch(config.domains?.includes('pulbase.com'), '本番ドメインが一致しません。');
    return config;
  }

  async function current() {
    const [config, site, deployments] = await Promise.all([project(), api('worker', worker + '/subdomain'),
      api('worker', worker + '/deployments')]);
    requireMatch(site.enabled === false && site.previews_enabled === false, 'Workerの直接公開が無効であることを確認できません。');
    const active = deployments.deployments?.toSorted((a, b) => Date.parse(b.created_on) - Date.parse(a.created_on))[0];
    const activePages = config.canonical_deployment;
    requireMatch(Number.isFinite(Date.parse(active?.created_on)) && active.versions?.length === 1
      && active.versions[0].percentage === 100 && activePages?.environment === 'production'
      && activePages.latest_stage?.status === 'success', '現在の本番デプロイが切り戻し条件を満たしていません。');
    return { worker: { deploymentId: active.id, versionId: active.versions[0].version_id },
      pages: { deploymentId: activePages.id, revision: activePages.deployment_trigger?.metadata?.commit_hash } };
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
      const now = (await current())[target];
      requireMatch(now.deploymentId === expected.deploymentId && now.versionId === expected.versionId,
        '切り戻し直前に公開先が変わりました。');
      if (target === 'pages') {
        const previous = await api('pages', pages + '/deployments/' + before.deploymentId);
        requireMatch(previous.id === before.deploymentId && previous.environment === 'production'
          && previous.latest_stage?.status === 'success'
          && previous.deployment_trigger?.metadata?.commit_hash === before.revision, '以前のPages配信を確認できません。');
        await api('pages', pages + '/deployments/' + before.deploymentId + '/rollback', 'POST');
      } else {
        requireMatch(uuid.test(before.versionId ?? ''), '切り戻しWorkerバージョンが不正です。');
        await api('worker', worker + '/deployments', 'POST', {
          strategy: 'percentage', versions: [{ version_id: before.versionId, percentage: 100 }],
        });
      }
    },
  };
}
