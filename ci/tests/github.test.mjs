import { test } from 'node:test';
import assert from 'node:assert/strict';
import { intake, mergePr, report } from '../github.mjs';
const base = 'a'.repeat(40), head = 'b'.repeat(40), tree = 'c'.repeat(40);
const context = { repo: { owner: 'owner', repo: 'repo' }, actor: 'owner', eventName: 'issues', payload: { action: 'opened', issue: { number: 1 }, pull_request: { number: 2 } } };
test('issue failure comment includes the implementation stop reason and run evidence', async () => {
  const comments = [];
  const github = { rest: { issues: { createComment: async value => comments.push(value) } } };
  await report({ github, context: { ...context, serverUrl: 'https://github.com', runId: 42 }, ok: false,
    failureJson: JSON.stringify({ code: 'no_patch', reason: '対象外のため人の対応が必要です。' }) });
  assert.equal(comments.length, 1);
  assert.match(comments[0].body, /対象外のため人の対応/);
  assert.match(comments[0].body, /actions\/runs\/42/);
  assert.match(comments[0].body, /本番公開・X告知は実施していません/);
});
test('ラベルなしは管理者のIssue・手動workflow実行でも自動実装を起動しない', async () => {
  for (const eventName of ['issues', 'workflow_dispatch']) {
    const outputs = {};
    const github = { rest: { issues: { get: async () => ({ data: { state: 'open', labels: [], user: { login: 'owner' } } }) } } };
    await intake({ github, context: { ...context, eventName }, core: { setOutput: (key, value) => { outputs[key] = value; } } });
    assert.deepEqual(outputs, { eligible: 'false' });
  }
});
test('外部起票の自動Issueは管理者による明示ラベル付与が必要', async () => {
  let branchReads = 0;
  const github = { rest: { repos: { getCollaboratorPermissionLevel: async ({ username }) => ({ data: { permission: username === 'owner' ? 'admin' : 'read' } }),
    getBranch: async () => { branchReads++; return { data: { commit: { sha: base } } }; } }, issues: { get: async () => ({ data: { state: 'open', labels: [{ name: '実装:自動' }], user: { login: 'outsider' }, title: 'Issue' } }) }, pulls: { list() {} } }, paginate: async () => [] };
  const outputs = {};
  const core = { setOutput: (key, value) => { outputs[key] = value; } };
  await assert.rejects(intake({ github, context, core }), /Maintainer/); assert.equal(branchReads, 0);
  await intake({ github, context: { ...context, payload: { ...context.payload, action: 'labeled', label: { name: '実装:自動' } } }, core });
  assert.equal(outputs.base, base);
  assert.equal(outputs.eligible, 'true');
});
test('管理者の起票・手動実行も自動ラベルがあれば受付し、無権限者は起動できない', async () => {
  let actor = 'owner';
  const github = { rest: { repos: { getCollaboratorPermissionLevel: async ({ username }) => ({ data: { permission: username === actor ? 'admin' : 'read' } }), getBranch: async () => ({ data: { commit: { sha: base } } }) },
    issues: { get: async () => ({ data: { state: 'open', labels: [{ name: '実装:自動' }], user: { login: 'owner' }, title: 'Issue' } }) }, pulls: { list() {} } }, paginate: async () => [] };
  for (const eventName of ['issues', 'workflow_dispatch']) {
    const outputs = {};
    await intake({ github, context: { ...context, eventName }, core: { setOutput: (key, value) => { outputs[key] = value; } } });
    assert.equal(outputs.eligible, 'true');
  }
  actor = 'other';
  await assert.rejects(intake({ github, context, core: { setOutput() {} } }), /Write access/);
});
test('旧mergePrはAPIを一切呼ばず、どの入力でも停止する', async () => {
  let calls = 0;
  const github = new Proxy({}, { get() { calls++; throw Error('API must not be accessed'); } });
  await assert.rejects(mergePr({ github, context, head, base, verifiedTree: tree }), /旧マージ経路は停止済み/);
  assert.equal(calls, 0);
});
