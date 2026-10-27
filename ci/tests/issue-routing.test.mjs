import { test } from 'node:test';
import assert from 'node:assert/strict';
import { issueImplementationMode, assertAutomaticIssue, pullImplementsIssue, assertAutomaticAssignment, assertManualAssignment } from '../issue-routing.mjs';
import { mergePr, preparePr, intake } from '../github.mjs';
const base = 'a'.repeat(40), head = 'b'.repeat(40), tree = 'c'.repeat(40);
const repo = { owner: 'owner', repo: 'repo' };
function fixture(labels = ['実装:自動'], prs = []) {
  const issue = { state: 'open', labels, user: { login: 'owner' }, title: '変更', body: '要件' };
  const pr = { number: 2, user: { login: 'app[bot]' }, state: 'open', draft: false, base: { ref: 'develop', sha: base },
    head: { ref: 'codex/issue-1', sha: head, repo: { full_name: 'owner/repo' } } };
  let merges = 0;
  const listPrs = () => {}, listFiles = () => {}, listChecks = () => {};
  const github = { rest: { issues: { get: async () => ({ data: issue }), update: async () => {} },
    repos: { getCollaboratorPermissionLevel: async () => ({ data: { permission: 'admin' } }), getBranch: async () => ({ data: { commit: { sha: base } } }),
      getBranchProtection: async () => ({ data: { required_status_checks: { strict: true, contexts: ['verify', 'Automation control checks'] } } }) },
    pulls: { get: async () => ({ data: pr }), list: listPrs, listFiles, merge: async () => { merges++; return { data: { merged: true, sha: head } }; } },
    checks: { listForRef: listChecks }, git: { getCommit: async () => ({ data: { tree: { sha: tree } } }) } },
    paginate: async method => method === listPrs ? prs : method === listFiles ? [{ filename: 'docs/example.md' }] : [{ name: 'verify', app: { slug: 'github-actions' }, conclusion: 'success' }] };
  return { github, issue, pr, merges: () => merges };
}
test('自動は明示ラベルだけ、なし・旧ラベルは手元、担当ラベルの競合は禁止', () => {
  for (const labels of [[], ['codex:run'], ['実装:手元'], ['bug']]) {
    assert.equal(issueImplementationMode({ labels }), 'manual');
    assert.throws(() => assertAutomaticIssue({ state: 'open', labels }));
  }
  assert.equal(issueImplementationMode({ labels: [{ name: '実装:自動' }] }), 'automatic');
  assertAutomaticIssue({ state: 'open', labels: ['実装:自動'] });
  assert.throws(() => assertAutomaticIssue({ state: 'closed', labels: ['実装:自動'] }));
  assert.equal(issueImplementationMode({ labels: ['実装:自動', '実装:手元'] }), 'conflict');
  assert.throws(() => assertAutomaticIssue({ state: 'open', labels: ['実装:自動', '実装:手元'] }));
});
test('ブランチ名と完了参照で重複を検出し、単なる参照や似た番号は区別する', () => {
  for (const pr of [{ head: { ref: 'codex/issue-1' } }, { head: { ref: 'manual/issue-1' } },
    { head: { ref: 'different' }, body: 'Closes #1' }, { body: 'Fixes #8, #1\n修正' }, { body: 'Resolved #1' }]) assert.equal(pullImplementsIssue(pr, 1), true);
  for (const pr of [{ head: { ref: 'codex/issue-10' } }, { body: 'Refs #1' }, { body: 'Closes #10' }, { body: 'Issue #1の既存対応は維持' }]) assert.equal(pullImplementsIssue(pr, 1), false);
});
test('自動・手元のどちらも別名ブランチの関連PRがあれば新規実装を拒否する', async () => {
  const other = { number: 3, head: { ref: 'different' }, body: 'Closes #1' };
  for (const [labels, check] of [[['実装:自動'], assertAutomaticAssignment], [[], assertManualAssignment]]) {
    const { github } = fixture(labels, [other]);
    await assert.rejects(check({ github, repo, issueNumber: 1 }), /未マージPR/);
  }
});
test('手元確認は自動担当・ラベル競合・閉じたIssueを拒否し、ラベルなしを許可する', async () => {
  for (const labels of [['実装:自動'], ['実装:自動', '実装:手元']]) {
    const { github } = fixture(labels);
    await assert.rejects(assertManualAssignment({ github, repo, issueNumber: 1 }));
  }
  const { github, issue } = fixture([]);
  await assertManualAssignment({ github, repo, issueNumber: 1 });
  issue.state = 'closed';
  await assert.rejects(assertManualAssignment({ github, repo, issueNumber: 1 }));
});
test('実装中の担当変更・既存PRの発生を公開直前にも検出する', async () => {
  const f = fixture();
  await assertAutomaticAssignment({ github: f.github, repo, issueNumber: 1 });
  f.issue.labels = [];
  await assert.rejects(assertAutomaticAssignment({ github: f.github, repo, issueNumber: 1 }));
  f.issue.labels = ['実装:自動', '実装:手元'];
  await assert.rejects(assertAutomaticAssignment({ github: f.github, repo, issueNumber: 1 }));
});
test('既存の自動PRをレビュー受付でき、手元切替後は受付・マージを止める', async () => {
  process.env.AUTOMATION_BOT = 'app[bot]';
  const f = fixture();
  const context = { repo, actor: 'owner', payload: { pull_request: { number: 2 } } };
  const outputs = {};
  await preparePr({ github: f.github, context, core: { setOutput: (key, value) => { outputs[key] = value; } }, bot: 'app[bot]' });
  assert.equal(outputs.head, head);
  f.issue.labels = ['実装:手元'];
  await assert.rejects(preparePr({ github: f.github, context, core: { setOutput() {} }, bot: 'app[bot]' }));
  await assert.rejects(mergePr({ github: f.github, context, head, base, verifiedTree: tree, expectedCheck: 'verify' }));
  assert.equal(f.merges(), 0);
  f.issue.labels = ['実装:自動'];
  await assert.rejects(mergePr({ github: f.github, context, head, base, verifiedTree: tree, expectedCheck: 'verify' }), /旧マージ経路は停止済み/);
  assert.equal(f.merges(), 0);
});
test('自動実装の受付は両ラベルの競合や手元PRを無視して開始しない', async () => {
  const context = { repo, actor: 'owner', eventName: 'workflow_dispatch', payload: { issue: { number: 1 } } };
  for (const f of [fixture(['実装:自動', '実装:手元']), fixture(['実装:自動'], [{ number: 3, body: 'Closes #1' }])]) {
    await assert.rejects(intake({ github: f.github, context, core: { setOutput() {} } }));
  }
});


test('自動実装の起動はラベル付与1つに限定し、作成時との二重受付を防ぐ', async () => {
  const {readFile}=await import('node:fs/promises'); const {parse}=await import('yaml');
  const workflow=parse(await readFile(new URL('../../.github/workflows/codex-issue.yml',import.meta.url),'utf8'));
  assert.deepEqual(workflow.on.issues.types,['labeled']);
  assert.ok(workflow.on.workflow_dispatch);assert.ok(workflow.jobs.intake.if.includes("github.event.label.name == '実装:自動'"));
  assert.ok(!workflow.jobs.intake.if.includes("action == 'opened'"));
  assert.equal(workflow.concurrency['cancel-in-progress'],false);
});
