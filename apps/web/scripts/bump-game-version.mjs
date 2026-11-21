import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export async function bumpGameVersion(file, gameId) {
  const versions = JSON.parse(await readFile(file, 'utf8'));
  if (!Object.hasOwn(versions, gameId)) throw Error('対象のゲームIDを指定してください。');
  const current = versions[gameId];
  if (!Number.isSafeInteger(current) || current < 1 || current >= Number.MAX_SAFE_INTEGER) throw Error('バージョンは増加可能な正の整数である必要があります。');
  versions[gameId] = current + 1;
  await writeFile(file, JSON.stringify(versions, null, 2) + '\n');
  return versions[gameId];
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length !== 3) throw Error('使い方: npm run game:version -- <game-id>');
    const gameId = process.argv[2];
    const version = await bumpGameVersion(new URL('../src/domain/game-versions.json', import.meta.url), gameId);
    console.log(`${gameId}: v${version}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
