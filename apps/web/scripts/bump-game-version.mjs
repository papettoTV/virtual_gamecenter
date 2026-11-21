import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export async function bumpGameVersion(file, gameId, change) {
  const segment = ['major', 'minor', 'patch'].indexOf(change);
  if (segment < 0) throw Error('更新種類を major / minor / patch から指定してください。');
  const versions = JSON.parse(await readFile(file, 'utf8'));
  if (!Object.hasOwn(versions, gameId)) throw Error('対象のゲームIDを指定してください。');
  const current = versions[gameId];
  if (typeof current !== 'string' || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(current)) throw Error('バージョンは major.minor.patch 形式である必要があります。');
  const parts = current.split('.').map(Number);
  if (!parts.every(Number.isSafeInteger) || parts[segment] >= Number.MAX_SAFE_INTEGER) throw Error('バージョンの値が大きすぎます。');
  parts[segment] += 1;
  for (let index = segment + 1; index < parts.length; index += 1) parts[index] = 0;
  versions[gameId] = parts.join('.');
  await writeFile(file, JSON.stringify(versions, null, 2) + '\n');
  return versions[gameId];
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length !== 4) throw Error('使い方: npm run game:version -- <game-id> <major|minor|patch>');
    const gameId = process.argv[2];
    const version = await bumpGameVersion(new URL('../src/domain/game-versions.json', import.meta.url), gameId, process.argv[3]);
    console.log(`${gameId}: v${version}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
