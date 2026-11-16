import { sign } from 'node:crypto';
import { ProductionPromotionRejected } from './release.mjs';

const repo = 'papettoTV/virtual_gamecenter';
const appId = 5405029;
const sha = /^[a-f0-9]{40}$/;
const snapshots = ['ciControl', 'mainUpdate', 'mainIntegrity'];
const rulesets = { ciControl: 25676153, mainUpdate: 25520943, mainIntegrity: 25520941 };
const headers = token => ({ Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json',
  'Content-Type': 'application/json', 'X-GitHub-Api-Version': '2022-11-28' });

function requireMatch(condition, description) {
  if (!condition) throw Error(description);
}

function appJwt(key) {
  const encode = object => Buffer.from(JSON.stringify(object)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const payload = encode({ alg: 'RS256', typ: 'JWT' }) + '.' + encode({ iss: appId, iat: now - 30, exp: now + 300 });
  return payload + '.' + sign('RSA-SHA256', Buffer.from(payload), key).toString('base64url');
}

function confirmRules(rule, { branch, version, types, appBypass = false }) {
  const refs = rule?.conditions?.ref_name;
  requireMatch(rule?.target === 'branch' && rule.enforcement === 'active' && Array.isArray(refs?.include)
    && refs.include.length === 1 && refs.include[0] === 'refs/heads/' + branch
    && Array.isArray(refs.exclude) && refs.exclude.every(ref => branch === 'ci-control'
      && ['refs/heads/develop', 'refs/heads/main'].includes(ref))
    && new Date(rule.updated_at).toISOString() === version
    && Array.isArray(rule.rules) && rule.rules.length === types.length
    && types.every(type => rule.rules.filter(value => value.type === type).length === 1),
  'ブランチ保護の内容または設定版が一致しません。');
  // GitHub can omit bypass_actors for a read-only workflow token. The independently
  // verified UTC version is supplied by the protected production environment.
  if (rule.bypass_actors !== undefined) {
    const list = rule.bypass_actors;
    requireMatch(Array.isArray(list) && (appBypass
      ? list.length === 1 && list[0].actor_id === appId && list[0].actor_type === 'Integration' && list[0].bypass_mode === 'always'
      : list.length === 0), 'ブランチ保護のbypassが一致しません。');
  }
}

export function productionGitHub({ context, expectedControlSha, versions, readToken, appKey, request = fetch }) {
  requireMatch(context.controlSha === expectedControlSha && sha.test(expectedControlSha ?? '')
    && Object.keys(versions ?? {}).length === snapshots.length && snapshots.every(key =>
      /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(versions[key] ?? ''))
    && readToken && appKey, '本番の固定保護設定と認証が必要です。');
  const send = (path, token, method = 'GET', body) => request('https://api.github.com/' + path, {
    method, headers: headers(token), redirect: 'error', signal: AbortSignal.timeout(15000),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const get = async (path, token = readToken) => {
    const response = await send(path, token);
    if (!response.ok) throw Error('GitHubの本番設定を読み取れません。');
    return response.json();
  };
  const api = path => {
    requireMatch(/^(?:actions\/runs\/[1-9][0-9]*(?:\/approvals)?|environments\/production(?:\/deployment-branch-policies\?per_page=100)?|git\/ref\/heads\/(?:main|develop|ci-control)|git\/trees\/[a-f0-9]{40}\?recursive=1|compare\/[a-f0-9]{40}\.\.\.[a-f0-9]{40}|rulesets\/(?:25676153|25520943|25520941))$/.test(path),
      '許可対象外のGitHub APIです。');
    return get('repos/' + repo + '/' + path);
  };
  const head = async branch => (await api('git/ref/heads/' + branch)).object?.sha;

  async function guard(candidate) {
    const [control, update, integrity, develop] = await Promise.all([
      ...snapshots.map(key => api('rulesets/' + rulesets[key])), head('develop'),
    ]);
    requireMatch(develop === candidate.sha && context.controlSha === candidate.controlSha, '承認対象のSHAが変わりました。');
    confirmRules(control, { branch: 'ci-control', version: versions.ciControl,
      types: ['creation', 'deletion', 'non_fast_forward', 'update'] });
    confirmRules(update, { branch: 'main', version: versions.mainUpdate, types: ['update'], appBypass: true });
    requireMatch(update.rules[0].parameters?.update_allows_fetch_and_merge !== true, 'mainの更新条件が一致しません。');
    confirmRules(integrity, { branch: 'main', version: versions.mainIntegrity,
      types: ['deletion', 'non_fast_forward', 'required_status_checks'] });
    const checks = integrity.rules.find(rule => rule.type === 'required_status_checks').parameters;
    requireMatch(checks?.strict_required_status_checks_policy === true && checks.do_not_enforce_on_create === false
      && checks.required_status_checks?.length === 2 && ['verify', 'Automation control checks'].every(name =>
        checks.required_status_checks.some(check => check.context === name && check.integration_id === 15368)),
    'mainの必須CIが一致しません。');
  }

  async function withAppToken(operation) {
    const jwt = appJwt(appKey);
    const [app, installed] = await Promise.all([get('app', jwt), get('repos/' + repo + '/installation', jwt)]);
    requireMatch(app.id === appId && app.slug === 'pulbase-release' && app.owner?.login === 'papettoTV'
      && installed.app_id === appId && !installed.suspended_at && Number.isSafeInteger(installed.id) && installed.id > 0,
    '本番専用GitHub Appが一致しません。');
    const permissions = { contents: 'write', workflows: 'write' };
    const issued = await send('app/installations/' + installed.id + '/access_tokens', jwt, 'POST', {
      repositories: ['virtual_gamecenter'], permissions,
    });
    if (!issued.ok) throw new ProductionPromotionRejected('本番Appの範囲限定トークンを作成できません。');
    const credential = await issued.json();
    try {
      requireMatch(typeof credential.token === 'string' && credential.token
        && Object.keys(credential.permissions ?? {}).every(key => key === 'metadata' || Object.hasOwn(permissions, key))
        && Object.entries(permissions).every(([key, value]) => credential.permissions[key] === value),
      '本番Appトークンの範囲が不正です。');
      const accessible = await get('installation/repositories', credential.token);
      requireMatch(accessible.total_count === 1 && accessible.repositories?.length === 1
        && accessible.repositories[0].full_name === repo, '本番Appトークンのリポジトリが一致しません。');
      return await operation(credential.token);
    } finally {
      if (typeof credential.token === 'string' && credential.token) {
        const revoked = await send('installation/token', credential.token, 'DELETE');
        requireMatch(revoked.status === 204, '本番Appの一時トークンを失効できません。');
      }
    }
  }

  return {
    api, guard, main: () => head('main'),
    async preflight(candidate) {
      requireMatch(sha.test(candidate.mainSha ?? '') && sha.test(candidate.sha ?? ''), '昇格対象のSHAが不正です。');
      const comparison = await api('compare/' + candidate.mainSha + '...' + candidate.sha);
      requireMatch(comparison.status === 'ahead' && comparison.merge_base_commit?.sha === candidate.mainSha,
        'mainからfast-forwardで昇格できません。');
      await withAppToken(async () => {});
    },
    async promote(revision) {
      requireMatch(sha.test(revision ?? ''), '昇格対象のSHAが不正です。');
      await withAppToken(async token => {
        const response = await send('repos/' + repo + '/git/refs/heads/main', token, 'PATCH', { sha: revision, force: false });
        if ([400, 401, 403, 404, 409, 422].includes(response.status)) throw new ProductionPromotionRejected('GitHubがmainの昇格を拒否しました。');
        if (!response.ok) throw Error('main昇格の結果を確定できません。');
      });
    },
  };
}
