import {test} from 'node:test';
import assert from 'node:assert/strict';
import {deflateRawSync, crc32} from 'node:zlib';
import {cleanupStaleStaging, readApprovalZip, guardFiles, cliPorts, repository, assertCleanupContext} from '../stale-staging-runs.mjs';

const A = 'a'.repeat(40), B = 'b'.repeat(40), C = 'c'.repeat(40), D = 'd'.repeat(40);
const clone = structuredClone;
function fixture() {
  const run = {id: 101, workflow_id: 9, path: '.github/workflows/postmerge-staging.yml', repository: {full_name: repository},
    head_repository: {full_name: repository}, head_branch: 'ci-control', head_sha: C, event: 'workflow_dispatch', run_attempt: 1, status: 'waiting'};
  const execution = {repository, environment: 'staging', ref: 'refs/heads/ci-control', event: 'workflow_dispatch', runId: '101', attempt: '1', controlSha: C};
  const approval = {version: 3, mode: 'postmerge-staging-live', execution,
    evidence: {repository, environment: 'staging', attempt: '1', runId: '55', artifactId: '77', sha: A, tree: D, policyDigest: 'a'.repeat(64)},
    files: 118, manifestDigest: 'b'.repeat(64), protection: {preflightReady: true, deploymentRequested: false, execution: clone(execution)}};
  const stage = {name: 'staging', status: 'waiting', started_at: null, steps: []};
  const jobs = [{name: 'prepare', status: 'completed', conclusion: 'success'}, stage];
  const artifact = {id: 22, name: 'postmerge-approval-101-1', expired: false, size_in_bytes: 799, workflow_run: {id: 101, head_sha: C}};
  const ci = {id: 55, path: '.github/workflows/web-checks.yml', event: 'push', head_branch: 'develop', head_sha: A,
    head_repository: {full_name: repository}, run_attempt: 1, status: 'completed', conclusion: 'success'};
  const pending = [{environment: {name: 'staging'}, reviewers: [{type: 'User', reviewer: {login: 'papettoTV'}}]}];
  const tree = {truncated: false, tree: guardFiles.map((path, i) => ({path, type: 'blob', mode: '100644', sha: i.toString(16).padStart(40, '0')}))};
  const state = {run, approval, jobs, stage, artifact, ci, pending, tree, develop: B, control: C,
    reads: [], writes: [], hook: null, loadHook: null, cancelError: false, confirmError: false};
  const api = async path => {
    state.reads.push(path);
    if (state.hook) await state.hook(path, state);
    if (path === 'git/ref/heads/ci-control') return {object: {sha: state.control}};
    if (path === 'git/ref/heads/develop') return {object: {sha: state.develop}};
    if (path === 'actions/workflows/postmerge-staging.yml') return {id: 9, path: '.github/workflows/postmerge-staging.yml', state: 'active'};
    if (path.startsWith('actions/workflows/postmerge-staging.yml/runs?status=')) {
      const listed = path.includes('status=waiting&') ? [run] : [];
      return {total_count: listed.length, workflow_runs: clone(listed)};
    }
    if (path.startsWith('git/trees/')) return clone(tree);
    if (path.startsWith('compare/')) {
      const older = path.slice(8, 48);
      return {status: 'ahead', ahead_by: 1, behind_by: 0, base_commit: {sha: older}, merge_base_commit: {sha: older}};
    }
    if (path === 'actions/runs/101') {
      if (state.writes.length && state.confirmError) throw Error('signed-url-or-secret-must-not-leak');
      return clone(run);
    }
    if (path === 'actions/runs/55') return clone(ci);
    if (path.includes('/jobs?')) return {total_count: jobs.length, jobs: clone(jobs)};
    if (path.endsWith('/pending_deployments')) return clone(pending);
    if (path.includes('/artifacts?')) return {total_count: 1, artifacts: [clone(artifact)]};
    throw Error('Unexpected test read: ' + path);
  };
  const options = {api, expectedControlSha: C, load: async n => {
    assert.equal(n, 22); if (state.loadHook) state.loadHook(state); return clone(approval);
  }, cancel: async n => {
    state.writes.push(n);
    if (state.cancelError) throw Error('HTTP 409 or ambiguous timeout');
    run.status = 'completed'; run.conclusion = 'cancelled'; return 202;
  }, apply: true};
  return {state, options};
}

test('実際に古い承認待ちだけへcancelを1回送り結果を再確認する', async () => {
  const {state, options} = fixture();
  const r = await cleanupStaleStaging(options);
  assert.deepEqual(state.writes, [101]); assert.equal(r.results[0].outcome, 'cancelled');
  assert.equal(r.deploymentRequested, false); assert.equal(r.approvalRequested, false);
  assert.equal(state.reads.filter(p => p.endsWith('/pending_deployments')).length, 3);
});
test('dry-runは適格な候補でも書き込まない', async () => {
  const {state, options} = fixture(); options.apply = false;
  const r = await cleanupStaleStaging(options);
  assert.equal(r.results[0].outcome, 'would-cancel'); assert.deepEqual(state.writes, []);
});
const refusals = [
  ['最新の同SHA', s => s.approval.evidence.sha = B],
  ['main実行', s => s.run.head_branch = 'main'],
  ['別リポジトリ', s => s.run.head_repository.full_name = 'someone/fork'],
  ['別workflow', s => s.run.path = '.github/workflows/production-release.yml'],
  ['別workflow ID', s => s.run.workflow_id = 10],
  ['再実行', s => s.run.run_attempt = 2],
  ['pull_request実行', s => s.run.event = 'pull_request'],
  ['公開開始済み', s => { s.stage.status = 'in_progress'; s.stage.started_at = '2026-11-03T00:00:00Z'; }],
  ['runner開始済み', s => s.stage.started_at = '2026-11-03T00:00:00Z'],
  ['公開stepが存在', s => s.stage.steps = [{name: 'publish', status: 'completed'}]],
  ['prepare失敗', s => s.jobs[0].conclusion = 'failure'],
  ['別の公開jobも存在', s => s.jobs.push({name: 'production', status: 'waiting'})],
  ['終了済み', s => s.run.status = 'completed'],
  ['環境承認待ちなし', s => s.pending.splice(0)],
  ['本番環境', s => s.pending[0].environment.name = 'production'],
  ['別の承認者', s => s.pending[0].reviewers[0].reviewer.login = 'some-bot'],
  ['期限切れ成果物', s => s.artifact.expired = true],
  ['別run成果物', s => s.artifact.workflow_run.id = 999],
  ['過大な成果物', s => s.artifact.size_in_bytes = 100000],
  ['別承認scope', s => s.approval.execution.runId = '999'],
  ['本番scope', s => s.approval.evidence.environment = 'production'],
  ['鍵なし旧版', s => s.approval.mode = 'postmerge-staging-keyless'],
  ['CI再実行', s => s.ci.run_attempt = 2],
  ['失敗CI', s => s.ci.conclusion = 'failure'],
  ['CIのSHA不一致', s => s.ci.head_sha = B],
];
for (const [name, change] of refusals) test(name + 'は触らない', async () => {
  const {state, options} = fixture(); change(state);
  const r = await cleanupStaleStaging(options);
  assert.deepEqual(state.writes, []); assert.equal(r.results[0].outcome, 'untouched');
});
test('分岐・祖先不明なら取り消さない', async () => {
  const {state, options} = fixture(), original = options.api;
  options.api = async p => p.startsWith('compare/') ? {status: 'diverged', ahead_by: 1, behind_by: 1} : original(p);
  assert.equal((await cleanupStaleStaging(options)).results[0].reason, 'not-strict-ancestor');
  assert.deepEqual(state.writes, []);
});
test('古い制御版は祖先で全guardコード一致のときだけ許可する', async () => {
  const {state, options} = fixture();
  state.run.head_sha = D; state.artifact.workflow_run.head_sha = D;
  state.approval.execution.controlSha = D; state.approval.protection.execution.controlSha = D;
  assert.equal((await cleanupStaleStaging(options)).results[0].outcome, 'cancelled');
  assert.ok(state.reads.some(p => p === 'git/trees/' + D + '?recursive=1'));
});
test('古い制御のguardが変更されていれば触らない', async () => {
  const {state, options} = fixture(), original = options.api;
  state.run.head_sha = D;
  options.api = async p => { const v = await original(p); if (p.startsWith('git/trees/' + D)) v.tree[0].sha = A; return v; };
  assert.equal((await cleanupStaleStaging(options)).results[0].reason, 'changed-control-guard');
  assert.deepEqual(state.writes, []);
});
test('承認が競合してjobが開始した場合、cancel直前に拒否する', async () => {
  const {state, options} = fixture();
  state.hook = (p, s) => { if (p.includes('/jobs?') && s.reads.filter(v => v.includes('/jobs?')).length === 2) s.stage.status = 'in_progress'; };
  await cleanupStaleStaging(options); assert.deepEqual(state.writes, []);
});
test('develop/制御refが変化すれば直前に停止する', async () => {
  for (const field of ['develop', 'control']) {
    const {state, options} = fixture(); let loads = 0;
    state.loadHook = s => { if (++loads === 2) s[field] = D; };
    await cleanupStaleStaging(options); assert.deepEqual(state.writes, []);
  }
});
test('承認成果物の再読取が変化すれば取り消さない', async () => {
  const {state, options} = fixture(); let loads = 0;
  state.loadHook = s => { if (++loads === 2) s.approval.manifestDigest = 'c'.repeat(64); };
  assert.equal((await cleanupStaleStaging(options)).results[0].reason, 'changed-approval'); assert.deepEqual(state.writes, []);
});
test('cancelの409/通信失敗は再試行せず、未実施と誤報しない', async () => {
  const {state, options} = fixture(); state.cancelError = true;
  assert.equal((await cleanupStaleStaging(options)).results[0].outcome, 'cancel-outcome-unknown'); assert.deepEqual(state.writes, [101]);
});
test('202後の確認失敗はcancel要求済みとし、秘密を出さない', async () => {
  const {state, options} = fixture(); state.confirmError = true;
  const r = await cleanupStaleStaging(options);
  assert.equal(r.results[0].outcome, 'cancel-requested'); assert.ok(!JSON.stringify(r).includes('signed-url')); assert.deepEqual(state.writes, [101]);
});
test('一覧が欠ける/過大な場合は1件も変更しない', async () => {
  const {state, options} = fixture(), original = options.api;
  options.api = async p => p.includes('/runs?status=') ? {total_count: 100, workflow_runs: []} : original(p);
  await assert.rejects(cleanupStaleStaging(options), /incomplete-list/); assert.deepEqual(state.writes, []);
});

function zip(value = {safe: true}, {name = 'postmerge-approval.json', method = 8} = {}) {
  const data = Buffer.from(JSON.stringify(value)), packed = method === 0 ? data : deflateRawSync(data), n = Buffer.from(name);
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(method, 8);
  local.writeUInt32LE(crc32(data), 14); local.writeUInt32LE(packed.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(n.length, 26);
  const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 6); central.writeUInt16LE(method, 10);
  central.writeUInt32LE(crc32(data), 16); central.writeUInt32LE(packed.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(n.length, 28);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + n.length, 12); end.writeUInt32LE(local.length + n.length + packed.length, 16);
  return Buffer.concat([local, n, packed, central, n, end]);
}
test('保存/deflateの小さな承認JSONだけをメモリ内で読む', () => {
  assert.deepEqual(readApprovalZip(zip()), {safe: true}); assert.deepEqual(readApprovalZip(zip({ok: 1}, {method: 0})), {ok: 1});
});
test('ZIPのパス・CRC・多重entry・ZIP64・展開サイズ制限を検証する', () => {
  assert.throws(() => readApprovalZip(zip({}, {name: '../postmerge-approval.json'})));
  assert.throws(() => readApprovalZip(Buffer.alloc(70000)));
  assert.throws(() => readApprovalZip(zip({v: 'x'.repeat(40000)})));
  for (const mutate of [
    b => b.writeUInt16LE(2, b.length - 14),
    b => b.writeUInt16LE(45, 4),
    b => b.writeUInt16LE(1, 6),
    b => { const cd = b.readUInt32LE(b.length - 6); b.writeUInt32LE(0, cd + 16); },
  ]) { const b = zip(); mutate(b); assert.throws(() => readApprovalZip(b)); }
  assert.throws(() => readApprovalZip(zip().subarray(0, 25)));
});
test('CLIアダプタは任意パス/書込/force-cancelを受け付けない', async () => {
  const calls = [], ports = cliPorts({command: async (...args) => { calls.push(args); return {stdout: Buffer.from('{}')}; }});
  await assert.rejects(ports.api('actions/runs/1/force-cancel'));
  await assert.rejects(ports.api('environments/production'));
  await assert.rejects(ports.load('../1'));
  await assert.rejects(ports.cancel(101)); assert.equal(calls.length, 0);
  await ports.api('git/ref/heads/develop'); assert.equal(calls[0][1][1], '--hostname'); assert.equal(calls[0][1][2], 'github.com');
});
test('書込はdevelopの初回Web checks由来のActions実行に限定する', () => {
  const env = {GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: repository, GITHUB_REF: 'refs/heads/develop',
    GITHUB_EVENT_NAME: 'workflow_run', GITHUB_RUN_ATTEMPT: '1', GH_TOKEN: 'test-only-not-a-token'};
  const event = {action: 'requested', workflow_run: {event: 'push', run_attempt: 1, path: '.github/workflows/web-checks.yml',
    head_branch: 'develop', head_repository: {full_name: repository}}};
  assert.doesNotThrow(() => assertCleanupContext(env, event));
  for (const change of [
    x => x.GITHUB_ACTIONS = 'false', x => x.GITHUB_REF = 'refs/heads/main',
    x => x.GITHUB_RUN_ATTEMPT = '2', x => x.GITHUB_EVENT_NAME = 'workflow_dispatch',
    x => delete x.GH_TOKEN, x => x.GITHUB_REPOSITORY = 'someone/fork',
  ]) { const x = clone(env); change(x); assert.throws(() => assertCleanupContext(x, event)); }
  for (const change of [
    x => x.action = 'in_progress', x => x.workflow_run.event = 'pull_request',
    x => x.workflow_run.head_branch = 'main', x => x.workflow_run.run_attempt = 2,
    x => x.workflow_run.path = '.github/workflows/production-release.yml',
  ]) { const x = clone(event); change(x); assert.throws(() => assertCleanupContext(env, x)); }
});
