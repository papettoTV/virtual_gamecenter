import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { packageStaging, verifyStagingArtifact } from '../staging-artifact.mjs';
const sha = 'a'.repeat(40), tree = 'b'.repeat(40);
const source = JSON.parse(await readFile(new URL('../../apps/web/wrangler.jsonc', import.meta.url), 'utf8'));
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'pulbase-artifact-')), webRoot = join(root, 'web'), directory = join(root, 'artifact');
  await mkdir(join(webRoot, 'dist/virtual_gamecenter'), { recursive: true });
  await mkdir(join(webRoot, 'dist/client'), { recursive: true });
  await writeFile(join(webRoot, 'wrangler.jsonc'), JSON.stringify(source));
  await writeFile(join(webRoot, 'dist/virtual_gamecenter/wrangler.json'), JSON.stringify({ ...source.env.staging, build: { command: 'malicious command' } }));
  await writeFile(join(webRoot, 'dist/virtual_gamecenter/index.js'), `export default {}; // ${sha}`);
  await writeFile(join(webRoot, 'dist/client/_worker.js'), `export default {}; // ${sha}`);
  await writeFile(join(webRoot, 'dist/client/index.html'), '<html>test</html>');
  const options = { webRoot, directory, sha, tree, runId: '123', attempt: '1' };
  const env = { PULBASE_ARTIFACT_DIRECTORY: directory, PULBASE_RELEASE_SHA: sha, PULBASE_EXPECTED_TREE: tree,
    PULBASE_CI_RUN_ID: '123', PULBASE_CI_ATTEMPT: '1', PULBASE_DRY_RUN: 'false', CLOUDFLARE_API_TOKEN: 'example',
    GITHUB_RUN_ID: '999', GITHUB_RUN_ATTEMPT: '1', RUNNER_TEMP: root };
  return { root, webRoot, directory, options, env, cleanup: () => rm(root, { recursive: true, force: true }) };
}
test('生成設定やビルド命令を移送せず、Worker・Pages双方のSHAとハッシュを検証する', async () => {
  const f = await fixture();
  try {
    await packageStaging(f.options);
    assert.deepEqual(await readdir(join(f.directory, 'worker')), ['index.js']);
    await verifyStagingArtifact(f.options);
    for (const change of [{ sha: 'c'.repeat(40) }, { tree: 'c'.repeat(40) }, { runId: '124' }, { attempt: '2' }]) await assert.rejects(verifyStagingArtifact({ ...f.options, ...change }));
    await writeFile(join(f.directory, 'worker/index.js'), `tampered ${sha}`);
    await assert.rejects(verifyStagingArtifact(f.options), /checksum/);
  } finally { await f.cleanup(); }
});
test('Secretファイル・シンボリックリンク・未申告のファイルを拒否する', async () => {
  const f = await fixture();
  try {
    await writeFile(join(f.webRoot, 'dist/client/.dev.vars'), 'DO_NOT_UPLOAD=example');
    await assert.rejects(packageStaging(f.options));
    await rm(join(f.webRoot, 'dist/client/.dev.vars'));
    await symlink('/etc/passwd', join(f.webRoot, 'dist/client/leak'));
    await assert.rejects(packageStaging(f.options), /links/);
    await rm(join(f.webRoot, 'dist/client/leak'));
    await packageStaging(f.options);
    await writeFile(join(f.directory, 'worker/build.js'), 'extra');
    await assert.rejects(verifyStagingArtifact(f.options), /file set/);
  } finally { await f.cleanup(); }
});
