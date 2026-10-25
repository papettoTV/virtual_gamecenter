import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
export function reviewReceipt(env) {
  const review = JSON.parse(env.REVIEW_RESULT);
  if (review.pass !== true || !Array.isArray(review.findings) || review.findings.length) throw Error('レビュー未合格');
  const result = { version: 1, repository: env.GITHUB_REPOSITORY, pullNumber: env.PR_NUMBER,
    head: env.PR_HEAD, base: env.PR_BASE, candidate: env.PR_CANDIDATE, tree: env.PR_TREE,
    reviewRun: env.GITHUB_RUN_ID, reviewAttempt: env.GITHUB_RUN_ATTEMPT,
    buildRun: env.BUILD_RUN_ID, buildAttempt: env.BUILD_ATTEMPT, buildArtifact: env.BUILD_ARTIFACT_ID,
    pass: true, findings: [] };
  if (result.repository !== 'papettoTV/virtual_gamecenter' || result.reviewAttempt !== '1' || result.buildAttempt !== '1'
    || !['pullNumber','reviewRun','buildRun','buildArtifact'].every(k => /^[1-9][0-9]*$/.test(result[k] ?? ''))
    || !['head','base','candidate','tree'].every(k => /^[a-f0-9]{40}$/.test(result[k] ?? ''))) throw Error('レビュー証跡の識別子が不正');
  return result;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { await writeFile('review-receipt.json', JSON.stringify(reviewReceipt(process.env)), { mode: 0o600 }); }
  catch { console.error('レビュー証跡を生成できません。公開なしで停止します。'); process.exitCode = 1; }
}
