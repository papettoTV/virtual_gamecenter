// Explicitly simulated evidence. No network, child processes, or publish/merge API.
import { readFile, writeFile, appendFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { approvalScope, runApprovedTransaction } from './single-approval.mjs';
import { executionContext, readApi, verifyProtection } from './protection-check.mjs';
const S = value => value.repeat(40);
export async function rehearse(execution, now = Date.now) {
  const build = { sha: S('b'), tree: S('c'), event: 'pull_request', checkSha: S('d'), runId: '200', attempt: '1',
    artifactId: '300', artifactDigest: 'e'.repeat(64), ciPassed: true, artifactVerified: true };
  const intent = { repository: execution.repository, baseRef: 'develop', pullNumber: '1', head: S('d'), base: S('f'),
    candidate: S('b'), tree: S('c'), parents: [S('f'), S('d')], build,
    review: { pass: true, head: S('d'), base: S('f'), candidate: S('b') } };
  const candidate = { repository: execution.repository, baseRef: 'develop', pullNumber: '1', state: 'open', draft: false,
    head: intent.head, base: intent.base, develop: intent.base, candidate: intent.candidate, tree: intent.tree };
  const merged = { repository: execution.repository, baseRef: 'develop', pullNumber: '1', head: intent.head,
    merged: true, method: 'squash', sha: S('1'), tree: intent.tree, develop: S('1'), parents: [intent.base] };
  const phases = [], simulate = (name, result) => async () => { phases.push(name); return structuredClone(result); };
  const outcome = await runApprovedTransaction({ scope: approvalScope(intent, execution, now()), execution, now,
    adapters: { observeCandidate: simulate('候補の再照合', candidate), publishCandidate: simulate('候補公開の模擬'),
      regressCandidate: simulate('候補回帰の模擬', { passed: true, sha: intent.candidate, tree: intent.tree }),
      merge: simulate('developマージの模擬', merged),
      waitForMergedCi: simulate('実マージCIの模擬', { ...build, sha: merged.sha, checkSha: merged.sha, event: 'push' }),
      observeMerged: simulate('実マージ対象の再照合', merged), publishMerged: simulate('実SHA再公開の模擬'),
      regressMerged: simulate('最終回帰の模擬', { passed: true, sha: merged.sha, tree: intent.tree }) } });
  // Do not expose synthetic SHA/PR numbers as if they were real deployments.
  return { mode: 'rehearsal-only', simulated: true, rehearsalPassed: outcome.status === 'completed',
    runId: execution.runId, controlSha: execution.controlSha, phases,
    intendedApprovalCount: 1, realMergeExecuted: false, realDeploymentExecuted: false, productionRequested: false };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length !== 2) throw Error('予行試験以外のモードはありません。');
    const execution = executionContext();
    const before = JSON.parse(await readFile('control-protection.json', 'utf8'));
    if (before.mode !== 'rehearsal-only' || before.preflightReady !== true
      || JSON.stringify(before.execution) !== JSON.stringify(execution)) throw Error('別実行の事前確認を流用できません。');
    await verifyProtection(readApi(process.env.GH_TOKEN), execution, { ruleVersions: process.env.PULBASE_CONTROL_RULE_VERSIONS });
    const report = await rehearse(execution);
    await writeFile('control-rehearsal.json', JSON.stringify(report, null, 2), { mode: 0o600 });
    if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY,
      `## 公開なしの予行試験が成功\n制御SHA: ${execution.controlSha}\n\nすべて模擬処理です。実際のCI成果物・PRマージ・公開・回帰テストの成功を示すものではありません。\n`);
    console.log(JSON.stringify(report, null, 2));
  } catch (error) { console.error(error instanceof Error ? error.message : '予行試験を停止しました。'); process.exitCode = 1; }
}
