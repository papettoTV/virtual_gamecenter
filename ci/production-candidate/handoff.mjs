import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { verifyProductionBundle } from './build-bundle.mjs';

const repository = 'papettoTV/virtual_gamecenter';
const sha = /^[a-f0-9]{40}$/;
const hash = /^[a-f0-9]{64}$/;
const maxArchive = 256 * 1024 * 1024;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

function requireMatch(condition, description) {
  if (!condition) throw Error(description);
}

export function bundleReader() {
  const get = (path, maxBuffer) => execFileSync('gh', ['api', '--method', 'GET', 'repos/' + repository + '/' + path],
    { maxBuffer, timeout: 60000, stdio: ['ignore', 'pipe', 'pipe'] });
  return {
    api: async path => {
      requireMatch(/^(?:actions\/runs\/[1-9][0-9]*(?:\/artifacts\?per_page=100)?|git\/commits\/[a-f0-9]{40}|git\/trees\/[a-f0-9]{40}\?recursive=1)$/.test(path),
        '本番成果物の照合対象外です。');
      return JSON.parse(get(path, 8 * 1024 * 1024));
    },
    load: async artifactId => {
      requireMatch(Number.isSafeInteger(artifactId) && artifactId > 0, '成果物IDが不正です。');
      return get('actions/artifacts/' + artifactId + '/zip', maxArchive);
    },
  };
}

async function verifyArchive(bytes, scope, consume) {
  const scratch = await mkdtemp(join(tmpdir(), 'pulbase-bundle-check-'));
  const archive = join(scratch, 'bundle.zip');
  const directory = join(scratch, 'bundle');
  try {
    await writeFile(archive, bytes, { flag: 'wx', mode: 0o600 });
    const tool = fileURLToPath(new URL('../../tools/unpack-production-bundle.py', import.meta.url));
    execFileSync('python3', ['-I', '-B', tool, archive, directory],
      { timeout: 60000, stdio: ['ignore', 'pipe', 'pipe'], env: { PATH: process.env.PATH } });
    return await consume(await verifyProductionBundle({ directory, ...scope }), directory);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

export async function checkBundleHandoff(candidate, { api, load, preparationFiles, expectedFingerprint }, consume) {
  const { sha: revision, preparationRunId, fingerprint: candidateFingerprint } = candidate;
  requireMatch(sha.test(revision ?? '') && Number.isSafeInteger(preparationRunId) && preparationRunId > 0
    && hash.test(candidateFingerprint ?? ''), '候補の識別情報が不正です。');
  const runPath = 'actions/runs/' + preparationRunId;
  const [run, commit, artifacts] = await Promise.all([
    api(runPath), api('git/commits/' + revision), api(runPath + '/artifacts?per_page=100'),
  ]);
  requireMatch(run.id === preparationRunId && run.path === '.github/workflows/production-preparation.yml'
    && run.head_repository?.full_name === repository && run.head_branch === 'develop' && run.head_sha === revision
    && run.event === 'push' && run.run_attempt === 1 && run.status === 'completed' && run.conclusion === 'success'
    && commit.sha === revision && sha.test(commit.tree?.sha ?? ''), '本番準備の初回pushまたは候補ツリーが不一致です。');
  const tree = await api('git/trees/' + commit.tree.sha + '?recursive=1');
  const fixed = Object.entries(preparationFiles ?? {});
  requireMatch(tree.sha === commit.tree.sha && tree.truncated === false && Array.isArray(tree.tree)
    && fixed.length >= 7 && sha.test(preparationFiles?.['ci/production-candidate/build-bundle.mjs'] ?? '')
    && fixed.every(([path, blob]) => tree.tree.some(entry => entry.path === path && entry.sha === blob
      && entry.type === 'blob' && entry.mode === '100644')), '本番準備の定義が保護された固定値と一致しません。');
  requireMatch(Array.isArray(artifacts.artifacts) && artifacts.total_count === artifacts.artifacts.length
    && artifacts.total_count < 100, '本番成果物の一覧が不完全です。');
  const matching = artifacts.artifacts.filter(item => item.name === `production-bundle-${preparationRunId}-1`);
  const artifact = matching[0];
  requireMatch(matching.length === 1 && Number.isSafeInteger(artifact.id) && artifact.id > 0
    && artifact.expired === false && Number.isSafeInteger(artifact.size_in_bytes)
    && artifact.size_in_bytes > 0 && artifact.size_in_bytes <= maxArchive
    && /^sha256:[a-f0-9]{64}$/.test(artifact.digest ?? '')
    && artifact.workflow_run?.id === preparationRunId && artifact.workflow_run.head_sha === revision
    && artifact.workflow_run.head_branch === 'develop', '本番成果物の出所・有効期限・ハッシュが不一致です。');
  const bytes = await load(artifact.id);
  requireMatch(Buffer.isBuffer(bytes) && bytes.length === artifact.size_in_bytes
    && 'sha256:' + digest(bytes) === artifact.digest, '本番成果物ZIPが差し替わっています。');
  const scope = { revision, tree: commit.tree.sha, run: String(preparationRunId), attempt: '1' };
  return verifyArchive(bytes, scope, async (verified, directory) => {
    const bundle = { artifactId: artifact.id, archiveDigest: artifact.digest, tree: commit.tree.sha, ...verified };
    const fingerprint = digest(JSON.stringify({ candidateFingerprint, bundle }));
    requireMatch(expectedFingerprint === undefined || fingerprint === expectedFingerprint,
      '承認前に固定した本番成果物と一致しません。');
    const result = { ...bundle, fingerprint };
    if (consume) {
      requireMatch(hash.test(expectedFingerprint ?? ''), '処理には承認前の固定値が必要です。');
      return consume(result, directory, { ...scope, expectedDigest: verified.manifestDigest });
    }
    return result;
  });
}

async function main() {
  const [, , mode] = process.argv;
  requireMatch(process.argv.length === 3 && ['--prepare', '--after-approval', '--production'].includes(mode), '照合モードが不正です。');
  const expectedFingerprint = mode === '--prepare' ? undefined : process.env.RELEASE_BUNDLE_FINGERPRINT ?? '';
  requireMatch(expectedFingerprint === undefined || hash.test(expectedFingerprint), '承認前の照合結果がありません。');
  const { candidateDiscoveryReader, checkRehearsalCandidate } = await import('./discover.mjs');
  const reader = candidateDiscoveryReader();
  const candidate = await checkRehearsalCandidate(reader, process.env);
  const policy = JSON.parse(await readFile(new URL('./policy.json', import.meta.url), 'utf8'));
  if (mode === '--production') {
    requireMatch(process.env.PULBASE_PRODUCTION_ENABLED === 'true' && process.env.PULBASE_PRODUCTION_CD_REHEARSAL === 'false',
      '本番の実行フラグが不一致です。');
    const { executeApprovedProduction } = await import('./production-operations.mjs');
    const { productionGitHub } = await import('./github-release.mjs');
    const { releaseAnnouncement } = await import('../release-announcement.mjs');
    const context = { repository: process.env.GITHUB_REPOSITORY, ref: process.env.GITHUB_REF, event: process.env.GITHUB_EVENT_NAME,
      attempt: process.env.GITHUB_RUN_ATTEMPT, runId: process.env.GITHUB_RUN_ID, controlSha: process.env.GITHUB_SHA };
    const github = productionGitHub({ context, expectedControlSha: process.env.PULBASE_EXPECTED_CONTROL_SHA,
      versions: JSON.parse(process.env.PULBASE_PRODUCTION_RULE_VERSIONS ?? '{}'), readToken: process.env.GH_TOKEN,
      appKey: process.env.PULBASE_RELEASE_APP_PRIVATE_KEY });
    const result = await checkBundleHandoff(candidate, { ...bundleReader(), preparationFiles: policy.preparationFiles, expectedFingerprint },
      async (_bundle, artifact, scope) => {
        const rechecked = await checkRehearsalCandidate(reader, process.env);
        requireMatch(rechecked.fingerprint === candidate.fingerprint, '公開前に候補が変わりました。');
        return executeApprovedProduction({ candidate, artifact, scope, context, github,
          workerToken: process.env.CLOUDFLARE_WORKER_API_TOKEN, pagesToken: process.env.CLOUDFLARE_PAGES_API_TOKEN });
      });
    const receipt = JSON.stringify(result, null, 2);
    console.log(receipt);
    if (process.env.GITHUB_STEP_SUMMARY) {
      await appendFile(process.env.GITHUB_STEP_SUMMARY, '## 本番リリース結果\n\n```json\n' + receipt + '\n```\n');
      if (result.success) {
        const draft = releaseAnnouncement({ sha: candidate.sha, confirmed: true,
          text: 'バーチャルゲーセン PULBASEを更新しました。最新版はこちらから遊べます。 https://pulbase.com/' });
        await appendFile(process.env.GITHUB_STEP_SUMMARY, draft.summary);
      }
    }
    if (!result.success) process.exitCode = 1;
    return;
  }
  const bundle = await checkBundleHandoff(candidate, { ...bundleReader(), preparationFiles: policy.preparationFiles, expectedFingerprint });
  const rechecked = await checkRehearsalCandidate(reader, process.env);
  requireMatch(rechecked.fingerprint === candidate.fingerprint, '成果物検査中に本番候補が変わりました。');
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, 'fingerprint=' + bundle.fingerprint + '\n');
  if (process.env.GITHUB_STEP_SUMMARY) {
    await appendFile(process.env.GITHUB_STEP_SUMMARY, [
      '### 本番候補の成果物照合（公開なし）', '', `- 候補 SHA \`${bundle.revision}\``,
      `- 準備 CI \`${candidate.preparationRunId}\``, `- 成果物 ID \`${bundle.artifactId}\``,
      `- ファイル数 ${bundle.fileCount}`, `- マニフェスト SHA-256 \`${bundle.manifestDigest}\``, '',
    ].join('\n'));
  }
  console.log(JSON.stringify({ ...bundle, deploymentRequested: false, mainUpdated: false }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    console.error('本番成果物の照合を停止しました。認証値や元応答は表示しません。');
    process.exitCode = 1;
  });
}
