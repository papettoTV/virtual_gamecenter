import test from 'node:test';
import assert from 'node:assert/strict';
import { approvalScope, assertCandidate, assertMerged, runApprovedTransaction, TransactionStopped } from '../control/single-approval.mjs';
const S = char => char.repeat(40);
const time = 100000;
function fixture() {
  const execution = { repository: 'papettoTV/virtual_gamecenter', ref: 'refs/heads/ci-control', event: 'workflow_dispatch',
    environment: 'staging', runId: '100', attempt: '1', controlSha: S('a') };
  const build = { sha: S('b'), tree: S('c'), event: 'pull_request', checkSha: S('d'), runId: '200', attempt: '1',
    artifactId: '300', artifactDigest: 'e'.repeat(64), ciPassed: true, artifactVerified: true };
  const intent = { repository: execution.repository, baseRef: 'develop', pullNumber: '5', head: S('d'), base: S('f'),
    candidate: S('b'), tree: S('c'), parents: [S('f'), S('d')], build,
    review: { pass: true, head: S('d'), base: S('f'), candidate: S('b') } };
  const observation = { repository: execution.repository, baseRef: 'develop', pullNumber: '5', state: 'open', draft: false,
    head: intent.head, base: intent.base, develop: intent.base, candidate: intent.candidate, tree: intent.tree };
  const merged = { repository: execution.repository, baseRef: 'develop', pullNumber: '5', head: intent.head,
    merged: true, method: 'squash', sha: S('1'), tree: intent.tree, develop: S('1'), parents: [intent.base] };
  const mergedBuild = { ...build, sha: merged.sha, checkSha: merged.sha, event: 'push', artifactId: '301', runId: '201' };
  const calls = [];
  const step = (name, value) => async () => { calls.push(name); return structuredClone(value); };
  const adapters = {
    observeCandidate: step('observe-candidate', observation), publishCandidate: step('publish-candidate'),
    regressCandidate: step('test-candidate', { passed: true, sha: intent.candidate, tree: intent.tree }),
    merge: async value => { calls.push('merge'); assert.deepEqual(value, { pullNumber: '5', head: intent.head,
      base: intent.base, tree: intent.tree, baseRef: 'develop', method: 'squash' }); return structuredClone(merged); },
    waitForMergedCi: step('wait-merged-ci', mergedBuild), observeMerged: step('observe-merged', merged),
    publishMerged: step('publish-merged'), regressMerged: step('test-merged', { passed: true, sha: merged.sha, tree: intent.tree }),
  };
  return { execution, intent, observation, merged, mergedBuild, calls, adapters };
}
const execute = f => runApprovedTransaction({ scope: approvalScope(f.intent, f.execution, time), execution: f.execution,
  adapters: f.adapters, now: () => time + 1 });
test('1回の承認対象で候補公開・テスト・マージ・実SHAのCI・再公開を直列に進める', async () => {
  const f = fixture(), result = await execute(f);
  assert.equal(result.approvalCount, 1); assert.equal(result.productionRequested, false);
  assert.deepEqual(f.calls, ['observe-candidate', 'publish-candidate', 'test-candidate', 'observe-candidate', 'merge',
    'wait-merged-ci', 'observe-merged', 'publish-merged', 'observe-merged', 'test-merged', 'observe-merged']);
});
test('main・別ref・別環境・別イベント・再実行からの承認利用を拒否する', () => {
  const f = fixture();
  for (const patch of [{ ref: 'refs/heads/main' }, { ref: 'refs/heads/develop' }, { ref: 'refs/tags/ci-control' },
    { environment: 'production' }, { repository: 'other/repo' }, { event: 'pull_request_target' }, { attempt: '2' }]) {
    assert.throws(() => approvalScope(f.intent, { ...f.execution, ...patch }, time));
  }
});
test('候補のCI・成果物・レビューの対象不一致や未合格を拒否する', () => {
  for (const mutate of [f => f.intent.build.ciPassed = false, f => f.intent.build.artifactVerified = false,
    f => f.intent.build.sha = S('2'), f => f.intent.build.checkSha = S('2'), f => f.intent.review.pass = false,
    f => f.intent.review.head = S('2'), f => f.intent.parents.reverse(), f => f.intent.baseRef = 'main']) {
    const f = fixture(); mutate(f); assert.throws(() => approvalScope(f.intent, f.execution, time));
  }
});
test('承認対象をコピーして固定し、呼出元の後続変更では広げられない', () => {
  const f = fixture(), scope = approvalScope(f.intent, f.execution, time);
  f.intent.build.sha = S('2'); assert.equal(scope.intent.build.sha, S('b'));
  assert.throws(() => { scope.intent.baseRef = 'main'; });
});
test('別実行・別制御コード・期限切れで承認を流用できない', () => {
  const f = fixture(), scope = approvalScope(f.intent, f.execution, time);
  for (const patch of [{ runId: '101' }, { controlSha: S('2') }]) assert.throws(() => assertCandidate(scope, f.observation, { ...f.execution, ...patch }, time));
  assert.throws(() => assertCandidate(scope, f.observation, f.execution, scope.expiresAt));
});
test('承認後にPRやdevelopが変わると初回公開前に停止する', async () => {
  for (const patch of [{ head: S('2') }, { base: S('2') }, { develop: S('2') }, { candidate: S('2') }, { tree: S('2') }]) {
    const f = fixture(); f.adapters.observeCandidate = async () => ({ ...f.observation, ...patch });
    await assert.rejects(execute(f), TransactionStopped); assert.deepEqual(f.calls, []);
  }
});
test('候補テスト不合格ならマージも再公開もしない', async () => {
  const f = fixture(); f.adapters.regressCandidate = async () => ({ passed: false });
  await assert.rejects(execute(f), error => error.phase === 'candidate' && error.mergedSha === null);
  assert.ok(!f.calls.includes('merge'));
});
test('マージ直前にも対象を再確認する', async () => {
  const f = fixture(); let count = 0;
  f.adapters.observeCandidate = async () => ({ ...f.observation, develop: count++ ? S('2') : f.intent.base });
  await assert.rejects(execute(f), error => error.phase === 'merge'); assert.ok(!f.calls.includes('merge'));
});
test('実マージは同じtree・予定の親・現在のdevelop・実SHA自身のCIが必要', () => {
  const f = fixture(), scope = approvalScope(f.intent, f.execution, time);
  for (const patch of [{ tree: S('2') }, { parents: [S('2')] }, { develop: S('2') }, { head: S('2') }, { baseRef: 'main' }]) {
    assert.throws(() => assertMerged(scope, { ...f.merged, ...patch }, f.mergedBuild, f.execution, time));
  }
  for (const patch of [{ sha: f.intent.candidate }, { checkSha: f.intent.candidate }, { ciPassed: false }, { artifactVerified: false }, { event: 'pull_request' }]) {
    assert.throws(() => assertMerged(scope, f.merged, { ...f.mergedBuild, ...patch }, f.execution, time));
  }
});
test('マージ後のCI失敗では再公開せず、マージ済みSHAを通知できる', async () => {
  const f = fixture(); f.adapters.waitForMergedCi = async () => ({ ...f.mergedBuild, ciPassed: false });
  await assert.rejects(execute(f), error => error.phase === 'merged-ci' && error.mergedSha === f.merged.sha);
  assert.ok(!f.calls.includes('publish-merged'));
});
test('実公開失敗では詳細や秘密値を漏らさず停止し、巻き戻し・自動再試行しない', async () => {
  const f = fixture(); let writes = 0;
  f.adapters.publishMerged = async () => { writes++; throw Error('secret-example'); };
  await assert.rejects(execute(f), error => error.phase === 'merged-deployment' && !error.message.includes('secret-example'));
  assert.equal(writes, 1); assert.ok(!f.calls.includes('test-merged'));
});
test('マージAPIが応答前に切断したら未マージと決めつけず不明として停止する', async () => {
  const f = fixture(); let attempts = 0;
  f.adapters.merge = async () => { attempts++; throw Error('network timeout'); };
  await assert.rejects(execute(f), error => error.phase === 'merge' && error.mergeOutcome === 'unknown');
  assert.equal(attempts, 1); assert.ok(!f.calls.includes('publish-merged'));
});
test('最終回帰中にdevelopが動いても完了にはしない', async () => {
  const f = fixture(); let observations = 0;
  f.adapters.observeMerged = async () => ({ ...f.merged, develop: ++observations === 3 ? S('2') : f.merged.sha });
  await assert.rejects(execute(f), error => error.phase === 'merged-deployment' && error.mergeOutcome === 'merged');
});
