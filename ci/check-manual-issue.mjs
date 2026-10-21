// Read-only preflight for a local Codex session before starting an Issue or creating a new PR.
import { execFileSync } from 'node:child_process';
import { assertManualAssignment } from './issue-routing.mjs';
const repo = { owner: 'papettoTV', repo: 'virtual_gamecenter' };
const prefix = `repos/${repo.owner}/${repo.repo}`;
function get(path) {
  return JSON.parse(execFileSync('gh', ['api', path], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 8 * 1024 * 1024 }));
}
try {
  if (process.argv.length !== 3) throw Error('Issue番号を1つ指定してください。');
  const github = { rest: { issues: { get: async ({ issue_number }) => ({ data: get(`${prefix}/issues/${issue_number}`) }) }, pulls: { list() {} } },
    paginate: async () => {
      const prs = [];
      for (let page = 1; ; page++) {
        const batch = get(`${prefix}/pulls?state=open&per_page=100&page=${page}`);
        prs.push(...batch);
        if (batch.length < 100) return prs;
      }
    } };
  await assertManualAssignment({ github, repo, issueNumber: process.argv[2] });
  console.log('手元実装のIssueで、関連する未マージPRはありません。切替時は自動実装の実行停止も別途確認してください。');
} catch {
  console.error('手元実装の事前確認に失敗しました。Issueの状態・実装ラベル・既存PRとGitHubへのアクセスを確認し、新規PRの作成を止めてください。');
  process.exitCode = 1;
}
