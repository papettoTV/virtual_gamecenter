import { assertIssueNumber } from './policy.mjs';

export const automaticIssueLabel = '実装:自動';
export const manualIssueLabel = '実装:手元';
export function issueImplementationMode(issue) {
  const labels = new Set((issue.labels ?? []).map(label => typeof label === 'string' ? label : label.name));
  if (labels.has(automaticIssueLabel) && labels.has(manualIssueLabel)) return 'conflict';
  return labels.has(automaticIssueLabel) ? 'automatic' : 'manual';
}
export function assertAutomaticIssue(issue) {
  if (issue.pull_request || issue.state !== 'open' || issueImplementationMode(issue) !== 'automatic') {
    throw Error('自動実装には、開いているIssueに「実装:自動」だけを指定してください。「実装:手元」との併用はできません。');
  }
}
export function pullImplementsIssue(pr, number) {
  number = assertIssueNumber(number);
  if ([`codex/issue-${number}`, `manual/issue-${number}`].includes(pr.head?.ref)) return true;
  // Manual PRs must identify their issue using an explicit closing reference.
  const blocks = (pr.body ?? '').matchAll(/\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+((?:#[1-9][0-9]*[\s,]*)+)/gi);
  for (const block of blocks) if ([...block[1].matchAll(/#([1-9][0-9]*)/g)].some(match => Number(match[1]) === number)) return true;
  return false;
}
export async function assertNoIssuePr({ github, repo, issueNumber, exceptPullNumber }) {
  const prs = await github.paginate(github.rest.pulls.list, { ...repo, state: 'open', per_page: 100 });
  if (prs.some(pr => pr.number !== exceptPullNumber && pullImplementsIssue(pr, issueNumber))) {
    throw Error('このIssueを実装する未マージPRが既にあります。既存PRを確認し、別のPRを作成しないでください。');
  }
}
export async function assertAutomaticAssignment({ github, repo, issueNumber, exceptPullNumber }) {
  const issue_number = assertIssueNumber(issueNumber);
  const { data: issue } = await github.rest.issues.get({ ...repo, issue_number });
  assertAutomaticIssue(issue);
  await assertNoIssuePr({ github, repo, issueNumber: issue_number, exceptPullNumber });
  return issue;
}
export async function assertManualAssignment({ github, repo, issueNumber }) {
  const issue_number = assertIssueNumber(issueNumber);
  const { data: issue } = await github.rest.issues.get({ ...repo, issue_number });
  if (issue.pull_request || issue.state !== 'open' || issueImplementationMode(issue) !== 'manual') {
    throw Error('このIssueは手元実装の対象ではありません。自動実装を並行して実行しないでください。');
  }
  await assertNoIssuePr({ github, repo, issueNumber: issue_number });
  return issue;
}
