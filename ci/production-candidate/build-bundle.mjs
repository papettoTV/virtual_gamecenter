import { createHash } from 'node:crypto';
import { lstat, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const sha = /^[a-f0-9]{40}$/;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const manifestName = 'manifest.json';
const roots = ['worker', 'client', 'migrations'];
const required = ['worker/index.js', 'client/_worker.js', 'client/_routes.json'];
const maxFile = 100 * 1024 * 1024;
const maxTotal = 250 * 1024 * 1024;

function ensure(condition, message) {
  if (!condition) throw Error(message);
}

function validPath(path) {
  const [root, ...parts] = path.split('/');
  if (!roots.includes(root) || !parts.length || !parts.every(name =>
    name === '.assetsignore' || (!name.startsWith('.') && /^[a-zA-Z0-9_@.+ -]+$/.test(name)))) return false;
  if (root === 'migrations') return parts.length === 1 && /^\d{4}_[a-z0-9_]+\.sql$/.test(parts[0]);
  return root !== 'worker' || /\.(js|wasm)$/.test(parts.at(-1));
}

function identity({ revision, tree, run, attempt }) {
  ensure(sha.test(revision) && sha.test(tree) && /^[1-9][0-9]*$/.test(run) && attempt === '1',
    '本番成果物には同一SHAの初回実行が必要です。');
  return { version: 1, environment: 'production', revision, tree, run, attempt };
}

async function walk(directory, visit, prefix = '') {
  const entries = await readdir(directory);
  for (const name of entries.sort()) {
    ensure(name !== '..' && !/[\\/\u0000-\u001f]/.test(name), '成果物のパスが不正です。');
    const path = prefix ? prefix + '/' + name : name;
    const file = join(directory, name);
    const stat = await lstat(file);
    ensure(!stat.isSymbolicLink(), 'シンボリックリンクを含む成果物を拒否しました。');
    if (stat.isDirectory()) await walk(file, visit, path);
    else {
      ensure(stat.isFile() && stat.size <= maxFile, '成果物の形式またはサイズが不正です。');
      await visit(path, file, stat.size);
    }
  }
}

export async function packProductionBundle({ webRoot, directory, ...scope }) {
  const manifest = { ...identity(scope), files: {} };
  await mkdir(directory, { mode: 0o700 });
  let total = 0;
  for (const [source, target] of [['dist/virtual_gamecenter','worker'], ['dist/client','client'], ['migrations','migrations']]) {
    const root = join(webRoot,source);
    ensure((await lstat(root)).isDirectory(), 'ビルド出力元が不正です。');
    await walk(root, async (relative, file, size) => {
      if (target === 'worker' && (relative === 'wrangler.json' || relative.startsWith('.vite/'))) return;
      const path = target + '/' + relative;
      total += size;
      ensure(validPath(path) && total <= maxTotal && Object.keys(manifest.files).length < 20000,
        '不要な設定・Secretまたは規定外の成果物を検出しました。');
      const bytes = await readFile(file);
      const destination = join(directory,path);
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, bytes, { flag: 'wx' });
      manifest.files[path] = digest(bytes);
    });
  }
  await writeFile(join(directory, manifestName), JSON.stringify(manifest), { flag: 'wx' });
  return verifyProductionBundle({ directory, ...scope });
}

export async function verifyProductionBundle({ directory, expectedDigest, ...scope }) {
  ensure((await lstat(directory)).isDirectory(), '成果物ディレクトリが不正です。');
  const stat = await lstat(join(directory, manifestName));
  ensure(stat.isFile() && stat.size <= 4 * 1024 * 1024, '成果物マニフェストが不正です。');
  const bytes = await readFile(join(directory,manifestName));
  const manifest = JSON.parse(bytes);
  const manifestDigest = digest(bytes);
  ensure(expectedDigest === undefined || manifestDigest === expectedDigest, '承認済みの成果物ハッシュと一致しません。');
  for (const [key, value] of Object.entries(identity(scope))) {
    ensure(manifest[key] === value, '本番成果物のSHA・実行IDが一致しません。');
  }
  ensure(manifest.files && typeof manifest.files === 'object' && !Array.isArray(manifest.files), 'ファイル一覧が不正です。');
  const found = new Set();
  let total = 0;
  await walk(directory, async (path, file, size) => {
    if (path === manifestName) return;
    total += size;
    ensure(validPath(path) && total <= maxTotal && found.size < 20000 && Object.hasOwn(manifest.files,path),
      '想定外の成果物を検出しました。');
    ensure(digest(await readFile(file)) === manifest.files[path], '成果物が差し替わっています。');
    found.add(path);
  });
  ensure(found.size === Object.keys(manifest.files).length && required.every(file => found.has(file))
    && [...found].some(path => path.startsWith('migrations/')), '本番成果物の構成が不足しています。');
  for (const path of ['worker/index.js','client/_worker.js']) {
    ensure((await readFile(join(directory,path),'utf8')).includes(scope.revision), '成果物に候補SHAが刻印されていません。');
  }
  return { manifestDigest, fileCount: found.size, revision: scope.revision };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [, , command, dir] = process.argv;
    const revision = process.env.PULBASE_RELEASE_SHA;
    const scope = { revision, tree: process.env.PULBASE_RELEASE_TREE, run: process.env.GITHUB_RUN_ID, attempt: process.env.GITHUB_RUN_ATTEMPT };
    ensure(process.argv.length === 4 && dir && ['pack','verify'].includes(command), '対象外の成果物操作です。');
    if (command === 'pack') {
      const git = value => execFileSync('git', ['rev-parse',value], { encoding:'utf8' }).trim();
      ensure(git('HEAD') === revision && git('HEAD^{tree}') === scope.tree, 'ビルド対象のcheckoutが一致しません。');
      console.log(JSON.stringify(await packProductionBundle({ webRoot:resolve('apps/web'),directory:resolve(dir),...scope })));
    } else {
      ensure(/^[a-f0-9]{64}$/.test(process.env.PULBASE_PRODUCTION_MANIFEST_DIGEST ?? ''), '事前に固定したマニフェストが必要です。');
      console.log(JSON.stringify(await verifyProductionBundle({ directory:resolve(dir), expectedDigest:process.env.PULBASE_PRODUCTION_MANIFEST_DIGEST,...scope })));
    }
  } catch {
    console.error('本番成果物検査を停止しました。応答本文・認証情報は表示しません。');
    process.exitCode = 1;
  }
}
