import { execFile } from 'node:child_process';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { productionCommands } from './publication.mjs';

const execute = promisify(execFile);
const packageRoot = fileURLToPath(new URL('../control/toolchain/node_modules/wrangler', import.meta.url));
const identifiers = {
  worker: /Current Version ID:\s*([a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})\b/gi,
  pages: /Deployment complete! Take a peek over at (https:\/\/[a-f0-9]+\.virtual-gamecenter\.pages\.dev)\s*(?:$|\n)/g,
};

export function wranglerPublicationIdentifier(target, stdout) {
  if (!Object.hasOwn(identifiers, target)) throw Error('公開対象が不正です。');
  const matches = [...stdout.replace(/\x1b\[[0-9;]*m/g, '').matchAll(identifiers[target])];
  if (matches.length !== 1) throw Error('Wranglerの公開識別子を確認できません。');
  return matches[0][1];
}

export function fixedProductionWrangler(plan) {
  const expected = productionCommands(plan);
  return async (target, args, cwd, token) => {
    if (!Object.hasOwn(expected, target) || cwd !== plan.directory
      || JSON.stringify(expected[target]) !== JSON.stringify(args) || !token) throw Error('固定公開コマンドと一致しません。');
    const metadata = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'));
    const entry = await realpath(join(packageRoot, 'bin/wrangler.js'));
    if (metadata.name !== 'wrangler' || metadata.version !== '4.114.0'
      || !entry.startsWith(await realpath(packageRoot) + sep)) throw Error('固定Wranglerのバージョンが不一致です。');
    const home = await mkdtemp(join(tmpdir(), 'pulbase-wrangler-'));
    try {
      const { stdout } = await execute(process.execPath, [entry, ...args], { cwd, timeout: 180000, maxBuffer: 8 * 1024 * 1024,
        env: { PATH: process.env.PATH, HOME: home, XDG_CONFIG_HOME: home, CI: 'true', NO_COLOR: '1',
          CLOUDFLARE_ACCOUNT_ID: '60e5472a284dc71bbafbbfac8aa2a940', CLOUDFLARE_API_TOKEN: token,
          WRANGLER_SEND_METRICS: 'false', WRANGLER_WRITE_LOGS: 'false' } });
      return wranglerPublicationIdentifier(target, stdout);
    } catch {
      throw Error('Wranglerでの本番公開を確認できません。元応答は表示しません。');
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  };
}
