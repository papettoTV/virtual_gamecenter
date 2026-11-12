import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { appendFile, copyFile, lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const specName = /^[a-z0-9-]+\.spec\.mjs$/;
const projects = ['desktop', 'mobile'];
// Use the slower project time per file from develop CI 43315795218, rounded to seconds.
const measuredSeconds = new Map(Object.entries({
  'analytics-panel': 24, 'deep-sea-share': 85, 'dot-wave-spacing': 33,
  'footer-feedback': 44, 'guest-bootstrap': 14, 'home-game-descriptions': 7,
  'mobile-play': 15, 'play-confirmation': 205, 'read-budget': 32,
  'salvage-play': 77, 'social-image': 21,
}).map(([name, seconds]) => [name + '.spec.mjs', seconds]));

export function localUiUrl(value) {
  try {
    const url = new URL(value);
    return ['http:', 'ws:'].includes(url.protocol) && ['127.0.0.1', '[::1]'].includes(url.hostname)
      && url.port === '5174' && !url.username && !url.password;
  } catch { return false; }
}

export async function discoverUiTests(directory) {
  let names;
  try { names = await readdir(directory); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  const specs = names.filter(x => specName.test(x));
  if (specs.length > 20) throw Error('UIケースのファイル数が過大です');
  for (const name of specs) {
    const stat = await lstat(join(directory, name));
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 90000) throw Error('UIケースは通常テキストファイルだけです');
  }
  return specs.sort();
}

export function splitUiTests(files) {
  assert.equal(new Set(files).size, files.length, 'UI検査ファイルが重複しています');
  assert.ok(files.every(name => specName.test(name)), '不正なUI検査ファイル名です');
  const weight = file => measuredSeconds.get(file) ?? 45;
  const sorted = [...files].sort((a, b) => weight(b) - weight(a) || a.localeCompare(b, 'en'));
  const shards = [{ files: [], seconds: 0 }, { files: [], seconds: 0 }];
  for (const file of sorted) {
    const target = shards[0].seconds <= shards[1].seconds ? shards[0] : shards[1];
    target.files.push(file);
    target.seconds += weight(file);
  }
  return shards.map(shard => shard.files.sort());
}

export async function collectUiParts(root, sha, attempt) {
  assert.match(sha, /^[a-f0-9]{40}$/);
  assert.match(attempt, /^[1-9][0-9]*$/);
  const files = await discoverUiTests(join(root, 'apps/web/tests/ui'));
  const plan = splitUiTests(files);
  const partRoot = join(root, 'ci/ui-parts');
  const resultRoot = join(root, 'ci/ui-results');
  const parts = projects.flatMap(project => plan.map((selected, index) => ({
    name: `${project}-${index + 1}`, selected,
  })));
  const prefix = `ui-part-${sha}-${attempt}-`;
  assert.deepEqual((await readdir(partRoot)).sort(), parts.map(part => prefix + part.name));
  await mkdir(join(resultRoot, 'blob'), { recursive: true });
  for (const { name, selected } of parts) {
    const directory = join(partRoot, prefix + name);
    const report = JSON.parse(await readFile(join(directory, 'discovery.json'), 'utf8'));
    assert.deepEqual(report, { required: files.length > 0, files, selected }, `UI検査ファイルが不一致です: ${name}`);
    assert.deepEqual((await readdir(directory)).sort(), selected.length ? ['blob', 'discovery.json'] : ['discovery.json'], `UI証跡のファイル構成が不正です: ${name}`);
    if (selected.length) {
      const blob = name + '.zip';
      assert.deepEqual(await readdir(join(directory, 'blob')), [blob]);
      await copyFile(join(directory, 'blob', blob), join(resultRoot, 'blob', blob));
    }
  }
  await writeFile(join(resultRoot, 'discovery.json'), JSON.stringify({ required: files.length > 0, files }));
}

async function main([mode, ...args]) {
  const root = fileURLToPath(new URL('../', import.meta.url));
  if (mode === 'collect' && args.length === 0) {
    await collectUiParts(root, process.env.GITHUB_SHA, process.env.GITHUB_RUN_ATTEMPT);
    return;
  }
  const shard = args.at(-1);
  assert.ok(shard === '1' || shard === '2', 'UI検査の分割番号が不正です');
  const files = await discoverUiTests(join(root, 'apps/web/tests/ui'));
  const selected = splitUiTests(files)[Number(shard) - 1];
  if (mode === 'discover' && args.length === 1) {
    const directory = join(root, 'ci/ui-results');
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, 'discovery.json'), JSON.stringify({ required: files.length > 0, files, selected }));
    if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `enabled=${selected.length > 0}\n`);
    console.log(`ローカルUI検査: ${selected.length}/${files.length}ファイル`);
    return;
  }
  const [project] = args;
  assert.ok(mode === 'run' && args.length === 2 && projects.includes(project) && selected.length > 0);
  // Playwright matches positional filters against full file paths.
  const filters = selected.map(file => `/apps/web/tests/ui/${file.replaceAll('.', '\\.')}$`);
  const result = spawnSync(process.execPath, ['ci/node_modules/@playwright/test/cli.js', 'test',
    '--config', 'ci/ui-local.config.mjs', `--project=${project}`, '--reporter=list,blob', ...filters],
  { cwd: root, stdio: 'inherit' });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main(process.argv.slice(2));
}
