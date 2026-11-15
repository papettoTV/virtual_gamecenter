import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { checkBundleHandoff } from '../production-candidate/handoff.mjs';

const digest = value => createHash('sha256').update(value).digest('hex');
const revision = 'a'.repeat(40);
const tree = 'b'.repeat(40);
const candidate = { sha: revision, preparationRunId: 23, fingerprint: 'c'.repeat(64) };

function fixture() {
  const paths = ['.github/workflows/production-preparation.yml', 'ci/production-preparation.mjs',
    'ci/production-candidate/build-bundle.mjs', 'tools/check-production-migrations.py',
    'ci/playwright.config.mjs', 'ci/browser/regression.spec.mjs', 'ci/check-revision.mjs'];
  const preparationFiles = Object.fromEntries(paths.map(path => [path, 'd'.repeat(40)]));
  const run = { id: 23, path: '.github/workflows/production-preparation.yml',
    head_repository: { full_name: 'papettoTV/virtual_gamecenter' }, head_branch: 'develop', head_sha: revision,
    event: 'push', run_attempt: 1, status: 'completed', conclusion: 'success' };
  const entries = { 'worker/index.js': revision, 'client/_worker.js': revision, 'client/_routes.json': '{}',
    'client/.assetsignore': '_worker.js', 'migrations/0001_test.sql': 'SELECT 1;' };
  entries['manifest.json'] = JSON.stringify({ version: 1, environment: 'production', revision, tree, run: '23', attempt: '1',
    files: Object.fromEntries(Object.entries(entries).map(([path, contents]) => [path, digest(contents)])) });
  const artifact = { id: 18, name: 'production-bundle-23-1', expired: false,
    workflow_run: { id: 23, head_sha: revision, head_branch: 'develop' } };
  const treeEntries = Object.entries(preparationFiles).map(([path, sha]) => ({ path, sha, type: 'blob', mode: '100644' }));
  let bytes;
  const rebuild = () => {
    bytes = execFileSync('python3', ['-c', [
      'import io, json, sys, zipfile', 'data = io.BytesIO()',
      'with zipfile.ZipFile(data, "w", compression=zipfile.ZIP_DEFLATED) as archive:',
      '    for path, contents in json.load(sys.stdin).items(): archive.writestr(path, contents)',
      'sys.stdout.buffer.write(data.getvalue())',
    ].join('\n')], { input: JSON.stringify(entries) });
    Object.assign(artifact, { size_in_bytes: bytes.length, digest: 'sha256:' + digest(bytes) });
  };
  rebuild();
  const responses = { 'actions/runs/23': run, ['git/commits/' + revision]: { sha: revision, tree: { sha: tree } },
    ['git/trees/' + tree + '?recursive=1']: { sha: tree, truncated: false, tree: treeEntries },
    'actions/runs/23/artifacts?per_page=100': { total_count: 1, artifacts: [artifact] } };
  const options = { preparationFiles, api: async path => responses[path], load: async id => {
    assert.equal(id, artifact.id);
    return bytes;
  } };
  return { options, artifact, run, treeEntries, entries, rebuild };
}

test('同じ準備CIと成果物が承認前後で一致する', async () => {
  const { options } = fixture();
  const checked = await checkBundleHandoff(candidate, options);
  assert.equal(checked.fileCount, 5);
  assert.deepEqual(await checkBundleHandoff(candidate, { ...options, expectedFingerprint: checked.fingerprint }), checked);
});

test('中身が同じでも承認後に成果物IDが変わると拒否する', async () => {
  const { options, artifact } = fixture();
  const first = await checkBundleHandoff(candidate, options);
  artifact.id += 1;
  await assert.rejects(checkBundleHandoff(candidate, { ...options, expectedFingerprint: first.fingerprint }), /承認前/);
});

test('再実行・手動実行・固定blob不一致・期限切れ・ZIPハッシュ不一致を拒否する', async () => {
  for (const change of [
    f => { f.run.run_attempt = 2; },
    f => { f.run.event = 'workflow_dispatch'; },
    f => { f.treeEntries[0].sha = 'e'.repeat(40); },
    f => { f.artifact.expired = true; },
    f => { f.artifact.digest = 'sha256:' + '0'.repeat(64); },
  ]) {
    const f = fixture();
    change(f);
    await assert.rejects(checkBundleHandoff(candidate, f.options));
  }
});

test('ZIP自体のハッシュが正しくても危険なパスとマニフェスト不一致を拒否する', async () => {
  for (const change of [
    entries => { entries['client/../escape.js'] = 'unexpected'; },
    entries => { entries['client/_worker.js'] = 'changed'; },
  ]) {
    const f = fixture();
    change(f.entries);
    f.rebuild();
    await assert.rejects(checkBundleHandoff(candidate, f.options));
  }
});
