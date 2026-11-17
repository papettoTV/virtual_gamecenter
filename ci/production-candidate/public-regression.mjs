const origin = 'https://pulbase.com';
const alias = 'https://virtual-gamecenter.pages.dev';
const sha = /^[a-f0-9]{40}$/;

const cases = [
  [origin, '/', 200, true],
  [alias, '/', 401, true],
  [origin, '/api/health', 200],
  [origin, '/legal/terms', 200],
  [origin, '/legal/privacy', 200],
  ...['deep-sea-salvage', 'dot-wave', 'buzz-barrier'].map(
    game => [origin, '/share/live/' + game + '/image.png', 200]),
  [origin, '/operator/feedback', 401],
  [origin, '/api/operator/operations', 401],
];

export async function checkPublicProductionHttp(revision, request = fetch) {
  if (!sha.test(revision ?? '')) throw Error('本番HTTP回帰のSHAが不正です。');
  await Promise.all(cases.map(async ([host, path, status, checkRevision]) => {
    const url = new URL(path, host);
    url.searchParams.set('release-check', revision);
    const response = await request(url, {
      method: 'GET', redirect: 'manual', cache: 'no-store', signal: AbortSignal.timeout(15000),
    });
    try {
      if (response.status !== status
        || (status === 401 && !/^Basic\b/i.test(response.headers.get('www-authenticate') ?? ''))
        || (checkRevision && (response.headers.get('x-pulbase-revision') !== revision
          || response.headers.get('x-pulbase-gateway-revision') !== revision))) {
        throw Error('本番HTTP回帰が不合格です（' + host + path + '）。');
      }
    } finally {
      await response.body?.cancel();
    }
  }));
}
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { browserDiagnostics, parseBrowserReport, publicToolEnvironment, runFixedTool } from '../control/fixed-process.mjs';


export async function checkPublicProductionBrowser(revision, { command = runFixedTool, listOnly = false } = {}) {
  if (!sha.test(revision ?? '')) throw Error('本番ブラウザ回帰のSHAが不正です。');
  const folder = await mkdtemp(join(tmpdir(), 'pulbase-production-browser-'));
  try {
    const harness = new URL('../control/toolchain/', import.meta.url);
    const playwright = new URL('node_modules/@playwright/test/index.mjs', harness).href;
    const source = await readFile(new URL('browser/regression.spec.mjs', harness), 'utf8');
    const spec = source.replace("'@playwright/test'", JSON.stringify(playwright))
      .replaceAll('https://develop.virtual-gamecenter.pages.dev', origin)
      .replaceAll('wss://develop.virtual-gamecenter.pages.dev', 'wss://pulbase.com');
    await writeFile(join(folder, 'production.spec.mjs'), spec);
    await writeFile(join(folder, 'playwright.config.mjs'), `
import { defineConfig, devices } from ${JSON.stringify(playwright)};
export default defineConfig({
  testDir: '.', timeout: 30000, retries: 0, workers: 1, reporter: 'json',
  use: { channel: 'chromium', baseURL: ${JSON.stringify(origin)}, serviceWorkers: 'block',
    screenshot: 'off', trace: 'off', video: 'off', launchOptions: {chromiumSandbox: true} },
  projects: [{ name: 'desktop', use: devices['Desktop Chrome'] }, { name: 'mobile', use: devices['Pixel 7'] }],
});`);
    const result = await command('playwright', ['test', '--config', join(folder, 'playwright.config.mjs'),
      '--output', join(folder, 'results'), ...(listOnly ? ['--list'] : [])], {
      cwd: folder, timeout: 270000, env: { ...publicToolEnvironment(), HOME: process.env.HOME,
        PULBASE_BROWSER_ENVIRONMENT: 'production', PULBASE_EXPECTED_SHA: revision },
    });
    try {
      if (result.exitCode !== 0) throw Error();
      const parsed = parseBrowserReport(result.stdout, { listOnly });
      return listOnly ? parsed.listedTests : parsed.stats.expected;
    } catch {
      const error = Error('本番ブラウザ回帰が不合格です。');
      error.browserFailure = browserDiagnostics(result.stdout, result.exitCode);
      throw error;
    }
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}
