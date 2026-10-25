// Preparation only: trusted adapters are not wired to GitHub or Cloudflare yet.
// This module must run inside the protected ci-control staging-approved job.
const repository = 'papettoTV/virtual_gamecenter';
const sha = /^[a-f0-9]{40}$/;
const digest = /^[a-f0-9]{64}$/;
const id = value => /^[1-9][0-9]*$/.test(String(value));
const ttl = 60 * 60 * 1000;
function requireCondition(condition, message) { if (!condition) throw Error(message); }
function identity(value) {
  requireCondition(value && sha.test(value.sha ?? '') && sha.test(value.tree ?? '')
    && id(value.runId) && id(value.attempt) && id(value.artifactId)
    && digest.test(value.artifactDigest ?? '') && value.ciPassed === true
    && value.artifactVerified === true, 'CI・成果物の同一性を確認できません。');
}
function context(value) {
  requireCondition(value?.repository === repository && value.ref === 'refs/heads/ci-control'
    && value.event === 'workflow_dispatch' && value.environment === 'staging'
    && id(value.runId) && String(value.attempt) === '1' && sha.test(value.controlSha ?? ''),
  '承認済み公開ジョブの実行元ではありません。再試行は新しい実行と承認が必要です。');
}
export function approvalScope(intent, execution, approvedAt = Date.now()) {
  context(execution);
  requireCondition(Number.isSafeInteger(approvedAt) && approvedAt > 0, '承認時刻が不正です。');
  requireCondition(intent?.repository === repository && intent.baseRef === 'develop'
    && id(intent.pullNumber) && sha.test(intent.head ?? '') && sha.test(intent.base ?? '')
    && sha.test(intent.candidate ?? '') && sha.test(intent.tree ?? '')
    && Array.isArray(intent.parents) && intent.parents.length === 2
    && intent.parents[0] === intent.base && intent.parents[1] === intent.head,
  '承認対象のPR・マージ候補が不正です。');
  identity(intent.build);
  requireCondition(intent.build.sha === intent.candidate && intent.build.tree === intent.tree
    && intent.build.event === 'pull_request' && intent.build.checkSha === intent.head
    && intent.review?.pass === true && intent.review.head === intent.head
    && intent.review.base === intent.base && intent.review.candidate === intent.candidate,
  '同じ候補のCIまたはCodexレビューが合格していません。');
  // Copy and recursively freeze: caller mutations cannot widen the approval scope.
  const freeze = value => {
    if (value && typeof value === 'object') {
      Object.values(value).forEach(freeze); Object.freeze(value);
    }
    return value;
  };
  return freeze({ intent: structuredClone(intent), execution: structuredClone(execution), approvedAt, expiresAt: approvedAt + ttl });
}
function active(scope, execution, now) {
  context(execution);
  requireCondition(execution.runId === scope.execution.runId && execution.controlSha === scope.execution.controlSha
    && String(execution.attempt) === String(scope.execution.attempt), '別実行へ承認を流用できません。');
  requireCondition(Number.isSafeInteger(now) && now >= scope.approvedAt && now < scope.expiresAt,
    '承認の有効時間を超えました。新しい承認が必要です。');
}
export function assertCandidate(scope, observation, execution, now = Date.now()) {
  active(scope, execution, now);
  const expected = scope.intent;
  requireCondition(observation?.pullNumber === expected.pullNumber && observation.state === 'open'
    && observation.draft === false && observation.repository === repository && observation.baseRef === 'develop'
    && observation.head === expected.head && observation.base === expected.base
    && observation.develop === expected.base && observation.candidate === expected.candidate
    && observation.tree === expected.tree, '承認後にPR・develop・マージ候補が変わりました。');
}
export function assertMerged(scope, merged, build, execution, now = Date.now()) {
  active(scope, execution, now);
  const expected = scope.intent;
  requireCondition(merged?.repository === repository && merged.baseRef === 'develop'
    && merged.pullNumber === expected.pullNumber && merged.head === expected.head
    && merged.merged === true && merged.method === 'squash' && sha.test(merged.sha ?? '')
    && merged.tree === expected.tree && merged.develop === merged.sha
    && Array.isArray(merged.parents) && merged.parents.length === 1 && merged.parents[0] === expected.base,
  '実マージの内容・親コミット・現在のdevelopが承認対象と一致しません。');
  identity(build);
  requireCondition(build.event === 'push' && build.checkSha === merged.sha
    && build.sha === merged.sha && build.tree === expected.tree,
  '実マージSHA自身のCI・成果物が合格していません。');
}
function regression(result, expected) {
  requireCondition(result?.passed === true && result.sha === expected.sha && result.tree === expected.tree,
    '対象SHAの回帰テストが合格していません。');
}

export class TransactionStopped extends Error {
  constructor(phase, mergedSha, mergeAttempted) {
    super('検証公開の処理を停止しました。候補の変更・CI・公開結果を確認してください。');
    this.name = 'TransactionStopped'; this.phase = phase; this.mergedSha = mergedSha;
    this.mergeOutcome = mergedSha ? 'merged' : mergeAttempted ? 'unknown' : 'not-attempted';
  }
}

// Adapters must independently read live GitHub evidence and validated artifacts.
// No approval flag from Issue/PR/artifact data is accepted as authorization.
export async function runApprovedTransaction({ scope, execution, adapters, now = Date.now }) {
  let phase = 'candidate', mergedSha = null, mergeAttempted = false;
  const expected = scope.intent;
  try {
    // Serialize the entire lifecycle with the existing staging concurrency group.
    assertCandidate(scope, await adapters.observeCandidate(), execution, now());
    await adapters.publishCandidate(expected.build);
    regression(await adapters.regressCandidate(), { sha: expected.candidate, tree: expected.tree });
    phase = 'merge';
    // Re-read both head and base immediately before merging the pinned head.
    assertCandidate(scope, await adapters.observeCandidate(), execution, now());
    mergeAttempted = true;
    const merged = await adapters.merge({ pullNumber: expected.pullNumber, head: expected.head,
      base: expected.base, tree: expected.tree, baseRef: 'develop', method: 'squash' });
    if (sha.test(merged?.sha ?? '')) mergedSha = merged.sha;
    phase = 'merged-ci';
    // A successful candidate test never substitutes for the actual merge's CI.
    const build = await adapters.waitForMergedCi(merged);
    const current = await adapters.observeMerged(merged);
    assertMerged(scope, current, build, execution, now());
    phase = 'merged-deployment';
    await adapters.publishMerged(build);
    // A moving develop stops completion rather than silently including new work.
    assertMerged(scope, await adapters.observeMerged(merged), build, execution, now());
    regression(await adapters.regressMerged(), { sha: current.sha, tree: expected.tree });
    assertMerged(scope, await adapters.observeMerged(merged), build, execution, now());
    return { status: 'completed', pullNumber: expected.pullNumber, candidate: expected.candidate,
      mergedSha: current.sha, controlSha: execution.controlSha, runId: execution.runId,
      approvalCount: 1, productionRequested: false };
  } catch {
    // Never automatically revert a completed merge or publish unrelated latest code.
    throw new TransactionStopped(phase, mergedSha, mergeAttempted);
  }
}
