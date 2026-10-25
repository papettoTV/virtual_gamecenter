import { assertAutomatedPr, assertChanges, assertIssueNumber, assertSha } from './policy.mjs';
import { publicationFailureText } from './publication-result.mjs';
import { automaticIssueLabel, issueImplementationMode, assertAutomaticIssue, assertNoIssuePr, assertAutomaticAssignment } from './issue-routing.mjs';

export async function intake({ github, context, core, issueInput }) {
  const issue_number = assertIssueNumber(issueInput || context.payload.issue?.number);
  const repo = context.repo;
  const { data: issue } = await github.rest.issues.get({ ...repo, issue_number });
  if (issue.pull_request || issue.state !== 'open') throw Error('An open issue is required');
  if (issueImplementationMode(issue) === 'manual') {
    core.setOutput('eligible', 'false');
    core.info?.('手元実装のIssueです。自動実装・PR作成は行いません。');
    return;
  }
  assertAutomaticIssue(issue);
  const { data: actor } = await github.rest.repos.getCollaboratorPermissionLevel({ ...repo, username: context.actor });
  if (!['admin', 'maintain', 'write'].includes(actor.permission)) throw Error('Write access required');
  if (context.eventName !== 'workflow_dispatch') {
    const { data: author } = await github.rest.repos.getCollaboratorPermissionLevel({ ...repo, username: issue.user.login });
    const labelled = context.payload.action === 'labeled' && context.payload.label?.name === automaticIssueLabel;
    if (!labelled && !['admin', 'maintain', 'write'].includes(author.permission)) throw Error('Maintainer must label this issue');
  }
  await assertNoIssuePr({ github, repo, issueNumber: issue_number });
  const { data: branch } = await github.rest.repos.getBranch({ ...repo, branch: 'develop' });
  const sha = assertSha(branch.commit.sha);
  const text = JSON.stringify({ number: issue_number, title: issue.title, body: issue.body ?? '' });
  if (Buffer.byteLength(text) > 18000) throw Error('Issue exceeds automation input limit');
  core.setOutput('eligible', 'true');
  core.setOutput('issue', issue_number);
  core.setOutput('base', sha);
  core.setOutput('request', text);
}

export async function preparePr({ github, context, core, bot }) {
  const { data: pr } = await github.rest.pulls.get({ ...context.repo, pull_number: context.payload.pull_request.number });
  assertAutomatedPr(pr, { repository: `${context.repo.owner}/${context.repo.repo}`, bot });
  const files = await github.paginate(github.rest.pulls.listFiles, { ...context.repo, pull_number: pr.number, per_page: 100 });
  assertChanges(files);
  core.setOutput('head', pr.head.sha);
  core.setOutput('base', pr.base.sha);
  core.setOutput('number', pr.number);
  const issue_number = assertIssueNumber(pr.head.ref.replace('codex/issue-', ''));
  const issue = await assertAutomaticAssignment({ github, repo: context.repo, issueNumber: issue_number, exceptPullNumber: pr.number });
  core.setOutput('evidence_only', issue.labels?.some(label => (typeof label === 'string' ? label : label.name) === '検証:公開なし') ? 'true' : 'false');
  const request = JSON.stringify({ title: issue.title, body: issue.body ?? '' });
  if (Buffer.byteLength(request) > 18000) throw Error('Issue too large for review');
  core.setOutput('request', request);
}

// Retained as an explicit stop for older callers; never issue a merge API request.
export async function mergePr() {
  throw Error('旧マージ経路は停止済みです。保護されたci-controlのみを使用してください。');
}

export async function report({ github, context, ok, failureJson }) {
  await github.rest.issues.createComment({ ...context.repo, issue_number: context.payload.pull_request?.number ?? context.payload.issue?.number ?? assertIssueNumber(process.env.ISSUE_NUMBER),
    body: `${ok ? '検証が完了しました。' : '自動処理を停止しました。失敗したチェックの確認・修正が必要です。'}${ok ? '' : publicationFailureText(failureJson)}\n\n実行結果・画像・ログ: ${context.serverUrl}/${context.repo.owner}/${context.repo.repo}/actions/runs/${context.runId}\n\n本番公開・X告知は実施していません。` });
}
