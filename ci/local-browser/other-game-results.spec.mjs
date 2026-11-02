import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';

test.beforeEach(async ({ page }) => {
  page.on('pageerror', error => console.error('Local result preview:', error.message));
  await page.route('**/api/feedback', route => {
    if (new URL(route.request().url()).origin !== 'http://127.0.0.1:5174') throw Error('Local-only feedback test');
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{"accepted":true}' });
  });
});

async function feedback(page, panel, game) {
  await panel.getByRole('button', { name: '感想・不具合を送る' }).click();
  const dialog = page.getByRole('dialog', { name: '感想・不具合を送る', exact: true });
  await expect(dialog).toContainText(game);
  await dialog.getByRole('radio', { name: 'よかった', exact: true }).check();
  await dialog.getByLabel('内容', { exact: true }).fill('ローカル結果画面の確認用フィードバック');
  const sent = page.waitForRequest(request => request.url().endsWith('/api/feedback') && request.method() === 'POST');
  await dialog.getByRole('button', { name: '送る', exact: true }).click();
  const request = await sent;
  expect(request.postDataJSON().gameId).toBe(game === 'DOT WAVE' ? 'dot-wave' : 'deep-sea-salvage');
  await expect(dialog).not.toBeVisible();
  await expect(panel).toBeVisible();
}

for (const ending of ['clear', 'loss']) test(`DOT WAVE ${ending}: result hierarchy and manual feedback`, async ({ page }, info) => {
  await page.route('**/__dot-result?**', route => route.fulfill({ status: 200, contentType: 'text/html', body: '<html lang="ja"><head><meta name="viewport" content="width=device-width, initial-scale=1"><script type="module">import RefreshRuntime from "/@react-refresh"; RefreshRuntime.injectIntoGlobalHook(window); window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => type => type; window.__vite_plugin_react_preamble_installed__ = true;</script><script type="module" src="/@vite/client"></script></head><body><div id="root"></div><script type="module" src="/tests/fixtures/dot-result-preview.tsx"></script></body></html>' }));
  await page.route('**/api/ranking**', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ rankings: [{ player_name: 'Player-確認用', score: 54820, created_at: '2026-10-28 00:00:00' }] }) }));
  await page.goto(`/__dot-result?ending=${ending}`);
  const panel = page.getByRole('region', { name: 'DOT WAVEのプレイ結果' });
  await expect(panel.getByRole('heading', { level: 2 })).toHaveText(ending === 'clear' ? 'ALL CLEAR' : 'GAME OVER');
  await expect(panel.locator('.result-score')).toHaveText('54,820');
  const box = await panel.boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize().width);
  const retry = await panel.getByRole('button', { name: '1クレジットでリトライ' }).boundingBox();
  const secondary = await panel.locator('.ranking-secondary-actions').boundingBox();
  expect(retry.y + retry.height).toBeLessThanOrEqual(secondary.y);
  await feedback(page, panel, 'DOT WAVE');
  await expect(panel.locator('.result-score')).toHaveText('54,820');
  await panel.screenshot({ path: `/tmp/pulbase-dot-${ending}-${info.project.name}.png` });
  if (ending === 'clear') {
    await panel.getByRole('button', { name: 'ランキングに登録' }).click();
    await expect(panel.getByRole('table')).toBeVisible();
    await expect(panel.locator('.result-score')).toHaveText('54,820');
    await expect(panel.getByRole('button', { name: 'ランキングに登録' })).not.toBeVisible();
  }
});

test('deep sea salvage: actual result, collection return and feedback', async ({ page }, info) => {
  await page.goto('/');
  await page.getByRole('button', { name: '拒否する', exact: true }).click();
  await expect(page.locator('.platform-profile-button')).toBeVisible();
  await page.goto(`/cabinets/${randomUUID()}?game=deep-sea-salvage&start=1&power=1&powerDrain=100`);
  await page.getByRole('button', { name: '受け取る', exact: true }).click();
  await page.getByRole('button', { name: '1クレジットで開始', exact: true }).click();
  await expect(page.locator('#game-screen')).toBeVisible();
  if (info.project.name === 'mobile') await page.locator('#touch-pause').click();
  else await page.keyboard.press('p');
  const panel = page.locator('#ranking-submit-panel');
  await expect(panel).toBeVisible({ timeout: 15000 });
  await expect(panel.locator('#ranking-submit-heading')).toContainText('電力');
  await expect(panel.locator('.result-metrics')).toContainText('最大深度');
  await expect(page.locator('#touch-pause')).not.toBeVisible();
  await expect(page.locator('.game-share-button')).not.toBeVisible();
  const score = await panel.locator('.result-score').textContent();
  await panel.getByRole('button', { name: '図鑑を見る', exact: true }).click();
  await expect(panel).not.toBeVisible();
  await page.locator('#game').click();
  await expect(panel).toBeVisible();
  await expect(panel.locator('.result-score')).toHaveText(score);
  await feedback(page, panel, 'DEEP SEA SALVAGE');
  while (await page.getByRole('button', { name: '通知を閉じる', exact: true }).count()) {
    await page.getByRole('button', { name: '通知を閉じる', exact: true }).first().click();
  }
  await panel.screenshot({ path: `/tmp/pulbase-salvage-${info.project.name}.png` });
  await panel.locator('#ranking-another-game').click();
  await expect(page.getByRole('region', { name: 'ゲームを見て回る' })).toBeVisible();
});
