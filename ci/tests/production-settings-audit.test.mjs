import test from 'node:test';
import assert from 'node:assert/strict';
import { auditPaths, auditProductionSettings, githubReader } from '../production-settings-audit.mjs';

function fixture() {
  const rule = (branch, types) => ({ target: 'branch', enforcement: 'active', bypass_actors: [],
    conditions: { ref_name: { include: [`refs/heads/${branch}`], exclude: [] } },
    rules: types.map(type => ({ type })) });
  const data = Object.fromEntries(auditPaths.map(path => [path, { total_count: 0, secrets: [] }]));
  data['actions/variables/PULBASE_PRODUCTION_ENABLED'] = { value: 'false' };
  data['git/ref/heads/main'] = { object: { sha: '73cb5d9267c56f06f9f1150327ec6b8b3caa2bb9' } };
  data['rulesets/25520943'] = rule('main', ['update']);
  data['rulesets/25520941'] = rule('main', ['deletion', 'non_fast_forward', 'required_status_checks']);
  data['rulesets/25520941'].rules[2].parameters = { strict_required_status_checks_policy: true, do_not_enforce_on_create: false,
    required_status_checks: ['verify', 'Automation control checks'].map(context => ({ context, integration_id: 15368 })) };
  data['rulesets/25676153'] = rule('ci-control', ['creation', 'update', 'deletion', 'non_fast_forward']);
  data['environments/production'] = { can_admins_bypass: false,
    deployment_branch_policy: { custom_branch_policies: true, protected_branches: false },
    protection_rules: [{ type: 'required_reviewers', reviewers: [{ type: 'User', reviewer: { login: 'papettoTV' } }] }] };
  data['environments/production/deployment-branch-policies?per_page=100'] = { total_count: 1,
    branch_policies: [{ type: 'branch', name: 'main' }] };
  data['environments/production/secrets?per_page=100'] = { total_count: 5,
    secrets: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'PULBASE_CHECK_PASSWORD',
      'PULBASE_CHECK_USERNAME', 'PULBASE_RELEASE_APP_PRIVATE_KEY'].map(name => ({ name })) };
  return data;
}
const audit = data => auditProductionSettings(async path => data[path]);

test('準備中の設定一致は公開可能やSecret値の検証成功を意味しない', async () => {
  const result = await audit(fixture());
  assert.equal(result.settingsPassed, true);
  for (const field of ['productionReady', 'secretValuesVerified', 'writeRequested', 'deploymentRequested', 'workerCreated', 'xPosted']) {
    assert.equal(result[field], false);
  }
});

test('フラグ有効・main変更・保護欠落・bypass・CI提供元変更を拒否する', async () => {
  for (const change of [
    d => { d[auditPaths[0]].value = 'true'; },
    d => { d[auditPaths[0]].value = undefined; },
    d => { d['git/ref/heads/main'].object.sha = 'a'.repeat(40); },
    d => { d['rulesets/25520943'].bypass_actors = undefined; },
    d => { d['rulesets/25676153'].bypass_actors = [{ actor_id: 5405029 }]; },
    d => { d['rulesets/25520943'].rules[0].parameters = { update_allows_fetch_and_merge: true }; },
    d => { d['rulesets/25676153'].enforcement = 'disabled'; },
    d => { d['rulesets/25520941'].rules[2].parameters.required_status_checks[0].integration_id = 1; },
    d => { d['rulesets/25520941'].rules[2].parameters.do_not_enforce_on_create = true; },
    d => { d['rulesets/25520941'].conditions.ref_name.exclude = ['refs/heads/main']; },
  ]) {
    const data = fixture(); change(data); await assert.rejects(audit(data));
  }
});

test('承認省略・管理者bypass・developやタグからのproduction利用を拒否する', async () => {
  for (const change of [
    d => { d['environments/production'].can_admins_bypass = true; },
    d => { d['environments/production'].protection_rules = []; },
    d => { d['environments/production'].protection_rules[0].reviewers[0].reviewer.login = 'other'; },
    d => { d['environments/production/deployment-branch-policies?per_page=100'].branch_policies[0].name = 'develop'; },
    d => { d['environments/production/deployment-branch-policies?per_page=100'].branch_policies[0].type = 'tag'; },
  ]) {
    const data = fixture(); change(data); await assert.rejects(audit(data));
  }
});

test('本番トークン追加・鍵の他環境保管・一覧の欠損を拒否する', async () => {
  for (const change of [
    d => { const s = d['environments/production/secrets?per_page=100']; s.secrets.push({ name: 'CLOUDFLARE_API_TOKEN' }); s.total_count++; },
    d => { d['environments/codex/secrets?per_page=100'] = { total_count: 1, secrets: [{ name: 'PULBASE_RELEASE_APP_PRIVATE_KEY' }] }; },
    d => { d['actions/secrets?per_page=100'] = { total_count: 1, secrets: [{ name: 'UNREVIEWED' }] }; },
    d => { d['environments/production/secrets?per_page=100'].total_count = 6; },
  ]) {
    const data = fixture(); change(data); await assert.rejects(audit(data));
  }
});

test('APIは固定リポジトリへの許可済みGETだけで、失敗応答は表示しない', async () => {
  const calls = [];
  const read = githubReader(async (...args) => { calls.push(args); return { stdout: '{}' }; });
  await assert.rejects(read('git/refs/heads/main'));
  assert.equal(calls.length, 0);
  for (const path of auditPaths) await read(path);
  assert.equal(calls.length, auditPaths.length);
  for (const [command, args] of calls) {
    assert.equal(command, 'gh'); assert.deepEqual(args.slice(0, 3), ['api', '--method', 'GET']);
    assert.ok(args[3].startsWith('repos/papettoTV/virtual_gamecenter/')); assert.equal(args.length, 4);
  }
  await assert.rejects(githubReader(async () => { throw Error('private-response'); })(auditPaths[0]),
    error => !error.message.includes('private-response'));
});
