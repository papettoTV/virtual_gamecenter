import { createHash } from 'node:crypto';
import { cp, lstat, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { assertSha } from './policy.mjs';
import { checkBuildConfig, checkReleaseConfig } from '../apps/web/scripts/release-config.mjs';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function id(value) { if (!/^[1-9][0-9]*$/.test(String(value))) throw Error('Invalid CI identity'); return String(value); }
async function files(directory, prefix = '') {
  const result = [];
  for (const name of (await readdir(join(directory, prefix))).sort()) {
    if (/[\\\u0000-\u001f]/.test(name) || name === '..' || (name.startsWith('.') && name !== '.assetsignore')) throw Error('Unexpected or secret artifact path');
    const path = join(prefix, name), stat = await lstat(join(directory, path));
    if (stat.isSymbolicLink()) throw Error('Artifact links are forbidden');
    if (stat.isDirectory()) result.push(...await files(directory, path));
    else if (stat.isFile() && stat.size <= 100 * 1024 * 1024) result.push(path);
    else throw Error('Unexpected artifact entry');
    if (result.length > 20000) throw Error('Artifact exceeds file limit');
  }
  return result;
}
export async function packageStaging({ webRoot, directory, sha, tree, runId, attempt }) {
  assertSha(sha); assertSha(tree); id(runId); id(attempt);
  const source = JSON.parse(await readFile(join(webRoot, 'wrangler.jsonc'), 'utf8'));
  const built = JSON.parse(await readFile(join(webRoot, 'dist/virtual_gamecenter/wrangler.json'), 'utf8'));
  if ([...checkReleaseConfig(source, 'staging'), ...checkBuildConfig(built, source.env.staging, 'staging')].length) throw Error('Build configuration mismatch');
  await rm(directory, { recursive: true, force: true });
  await mkdir(join(directory, 'worker'), { recursive: true });
  // Never transfer generated Wrangler config or .dev.vars to the privileged runner.
  async function copyWorker(prefix = '') {
    for (const name of await readdir(join(webRoot, 'dist/virtual_gamecenter', prefix))) {
      const path = join(prefix, name), from = join(webRoot, 'dist/virtual_gamecenter', path);
      if (!prefix && ['.vite', 'wrangler.json', '.dev.vars'].includes(name)) continue;
      const stat = await lstat(from);
      if (stat.isSymbolicLink() || !/^[a-zA-Z0-9_.-]+$/.test(name) || name.startsWith('.')) throw Error('Unexpected Worker output');
      if (stat.isDirectory()) await copyWorker(path);
      else if (stat.isFile() && /\.(?:js|wasm)$/.test(name)) {
        await mkdir(join(directory, 'worker', prefix), { recursive: true });
        await cp(from, join(directory, 'worker', path), { dereference: false });
      } else throw Error('Unsupported Worker output');
    }
  }
  await copyWorker();
  await cp(join(webRoot, 'dist/client'), join(directory, 'client'), { recursive: true, dereference: false });
  const entries = {};
  for (const path of await files(directory)) entries[path] = hash(await readFile(join(directory, path)));
  const manifest = { version: 1, environment: 'staging', sha, tree, runId: id(runId), attempt: id(attempt), files: entries };
  await writeFile(join(directory, 'manifest.json'), JSON.stringify(manifest));
  await verifyStagingArtifact({ directory, sha, tree, runId, attempt });
  return manifest;
}
export async function verifyStagingArtifact({ directory, sha, tree, runId, attempt }) {
  assertSha(sha); assertSha(tree); id(runId); id(attempt);
  const manifestStat = await lstat(join(directory, 'manifest.json'));
  if (!manifestStat.isFile() || manifestStat.isSymbolicLink() || manifestStat.size > 4 * 1024 * 1024) throw Error('Invalid manifest');
  const manifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'));
  if (manifest.version !== 1 || manifest.environment !== 'staging' || manifest.sha !== sha || manifest.tree !== tree || manifest.runId !== String(runId) || manifest.attempt !== String(attempt)) throw Error('Artifact provenance mismatch');
  const actual = (await files(directory)).filter(path => path !== 'manifest.json');
  if (JSON.stringify(actual.sort()) !== JSON.stringify(Object.keys(manifest.files ?? {}).sort())) throw Error('Artifact file set mismatch');
  for (const path of actual) {
    if (!path.startsWith('worker/') && !path.startsWith('client/')) throw Error('Unexpected artifact root');
    if (!/^[a-f0-9]{64}$/.test(manifest.files[path]) || hash(await readFile(join(directory, path))) !== manifest.files[path]) throw Error('Artifact checksum mismatch');
  }
  for (const path of ['worker/index.js', 'client/_worker.js']) {
    if (!(await readFile(join(directory, path), 'utf8')).includes(sha)) throw Error('Artifact revision is not stamped');
  }
  return manifest;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const sha = assertSha(process.env.PULBASE_RELEASE_SHA);
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    if (head !== sha) throw Error('Build checkout mismatch');
    await packageStaging({ webRoot: resolve('apps/web'), directory: resolve('ci/staging-build'), sha,
      tree: execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { encoding: 'utf8' }).trim(), runId: process.env.GITHUB_RUN_ID, attempt: process.env.GITHUB_RUN_ATTEMPT });
    console.log('検証済みのstaging成果物を作成しました。Secret・生成された公開設定は含めていません。');
  } catch { console.error('staging成果物の検証に失敗しました。'); process.exitCode = 1; }
}
