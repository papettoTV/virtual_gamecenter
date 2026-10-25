import test from 'node:test';
import assert from 'node:assert/strict';
import { executionContext, verifyProtection as verify, readApi } from '../control/protection-check.mjs';
const controlSha = 'a'.repeat(40), mainSha = '73cb5d9267c56f06f9f1150327ec6b8b3caa2bb9';
const versions = { ciControl: '2026-10-23T00:00:00.000Z', main: '2026-10-21T20:32:35.191Z' };
const verifyProtection = (api, execution, options = { ruleVersions: JSON.stringify(versions) }) => verify(api, execution, options);
const env = { GITHUB_REPOSITORY: 'papettoTV/virtual_gamecenter', GITHUB_REF: 'refs/heads/ci-control',
  GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_RUN_ID: '10', GITHUB_RUN_ATTEMPT: '1', GITHUB_SHA: controlSha };
function fixture(mutate = () => {}) {
  const state = {
    'environments/staging': { can_admins_bypass: false, deployment_branch_policy: { custom_branch_policies: true, protected_branches: false },
      protection_rules: [{ type: 'required_reviewers', reviewers: [{ type: 'User', reviewer: { login: 'papettoTV' } }] }] },
    'environments/staging/deployment-branch-policies?per_page=100': { total_count: 1, branch_policies: [{ name: 'ci-control', type: 'branch' }] },
    'rulesets?per_page=100': [{ id: 1, name: 'ci-control-human-managed' }, { id: 2, name: 'main-release-app-only' }],
    'rulesets/1': { target: 'branch', enforcement: 'active', bypass_actors: [],
      updated_at: versions.ciControl,
      conditions: { ref_name: { include: ['refs/heads/ci-control'], exclude: ['refs/heads/main', 'refs/heads/develop'] } },
      rules: ['creation', 'update', 'deletion', 'non_fast_forward'].map(type => ({ type })) },
    'rulesets/2': { target: 'branch', enforcement: 'active', bypass_actors: [],
      updated_at: versions.main,
      conditions: { ref_name: { include: ['refs/heads/main'], exclude: [] } }, rules: [{ type: 'update' }] },
    'git/ref/heads/ci-control': { object: { sha: controlSha } }, 'git/ref/heads/main': { object: { sha: mainSha } },
  };
  mutate(state);
  return async path => { assert.ok(Object.hasOwn(state, path), path); return structuredClone(state[path]); };
}
test('承認前後に使う読み取りで、鍵なし・公開なしの保護確認結果を返す', async () => {
  const value = await verifyProtection(fixture(), executionContext(env));
  assert.equal(value.mode, 'rehearsal-only'); assert.equal(value.protectionVerified, true);
  assert.equal(value.deploymentRequested, false); assert.equal(value.mainSha, mainSha);
});
test('CI制御以外のref・イベント・再実行・不正IDを拒否する', () => {
  for (const patch of [{ GITHUB_REF: 'refs/heads/develop' }, { GITHUB_REF: 'refs/tags/ci-control' },
    { GITHUB_EVENT_NAME: 'pull_request_target' }, { GITHUB_RUN_ATTEMPT: '2' }, { GITHUB_RUN_ID: '10\ncommand' },
    { GITHUB_SHA: 'latest' }, { GITHUB_REPOSITORY: 'attacker/repo' }]) assert.throws(() => executionContext({ ...env, ...patch }));
});
test('承認者の追加・承認解除・管理者bypass・ref制限の解除を拒否する', async () => {
  for (const mutate of [s => s['environments/staging'].can_admins_bypass = true,
    s => s['environments/staging'].protection_rules = [],
    s => s['environments/staging'].protection_rules[0].reviewers.push({ type: 'User', reviewer: { login: 'other' } }),
    s => s['environments/staging'].deployment_branch_policy.custom_branch_policies = false,
    s => s['environments/staging/deployment-branch-policies?per_page=100'].branch_policies[0].type = 'tag',
    s => s['environments/staging/deployment-branch-policies?per_page=100'].branch_policies[0].name = 'develop',
    s => s['environments/staging/deployment-branch-policies?per_page=100'].total_count = 2]) {
    await assert.rejects(verifyProtection(fixture(mutate), executionContext(env)));
  }
});
test('制御ブランチやmainの保護解除・例外・SHA変更を拒否する', async () => {
  for (const mutate of [s => s['rulesets/1'].bypass_actors = [{ actor_id: 1 }],
    s => s['rulesets/1'].enforcement = 'disabled', s => s['rulesets/1'].rules.pop(),
    s => s['rulesets/1'].conditions.ref_name.exclude.push('refs/heads/ci-control'),
    s => s['rulesets/1'].rules[1].parameters = { update_allows_fetch_and_merge: true },
    s => s['rulesets/2'].bypass_actors = [{ actor_id: 1 }], s => s['rulesets/2'].enforcement = 'disabled',
    s => s['git/ref/heads/ci-control'].object.sha = 'b'.repeat(40), s => s['git/ref/heads/main'].object.sha = 'b'.repeat(40)]) {
    await assert.rejects(verifyProtection(fixture(mutate), executionContext(env)));
  }
});
test('読取APIだけを許可し、外部redirect・応答本文・認証値を漏らさない', async () => {
  let count = 0;
  const api = readApi('not-a-real-token', async (url, options) => {
    count++; assert.ok(url.startsWith('https://api.github.com/repos/papettoTV/virtual_gamecenter/'));
    assert.equal(options.method, 'GET'); assert.equal(options.redirect, 'error');
    return new Response('private response not-a-real-token', { status: 403 });
  });
  for (const path of ['https://attacker.test', '../other', 'actions/runs/1/approve', 'git/ref/heads/develop']) await assert.rejects(api(path));
  assert.equal(count, 0);
  await assert.rejects(api('environments/staging'), error => !error.message.includes('not-a-real-token') && !error.message.includes('private response'));
});
test('省略された例外一覧を空と推定せず、人の設定版照合を必須にする', async () => {
  const hidden = () => fixture(s => { delete s['rulesets/1'].bypass_actors; delete s['rulesets/2'].bypass_actors; });
  const pre = await verifyProtection(hidden(), executionContext(env), { requireSnapshot: false });
  assert.equal(pre.preflightReady, true); assert.equal(pre.protectionVerified, false); assert.equal(pre.bypassSnapshotVerified, false);
  await assert.rejects(verifyProtection(hidden(), executionContext(env), {}));
  const approved = await verifyProtection(hidden(), executionContext(env));
  assert.equal(approved.bypassSnapshotVerified, true);
  await assert.rejects(verifyProtection(fixture(s => { delete s['rulesets/1'].bypass_actors; s['rulesets/1'].updated_at = '2026-10-24T00:00:00.000Z'; }), executionContext(env)));
});
