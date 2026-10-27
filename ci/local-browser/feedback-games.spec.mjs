import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';

const games = [
  { id: 'graze-duel', title: 'BUZZ BARRIER', index: 0, module: 'graze-duel/runtime.ts' },
  { id: 'dot-wave', title: 'DOT WAVE', index: 1, module: 'dot-wave/entry.tsx' },
  { id: 'deep-sea-salvage', title: 'DEEP SEA SALVAGE', index: 2, module: 'deep-sea-salvage/runtime.ts' },
];
const modal = page => page.getByRole('dialog', { name: '感想・不具合を送る', exact: true });
const footer = page => page.locator('.platform-footer').getByRole('button', { name: '感想・不具合を送る', exact: true });

async function journey(page, game) {
  await page.clock.install({ time: new Date('2026-10-28T03:00:00Z') });
  await page.route('**/cabinets/feedback-check?**', route => route.fulfill({ status: 200, contentType: 'text/html', body: '<html lang="ja"><head><meta name="viewport" content="width=device-width, initial-scale=1"><script type="module">import RefreshRuntime from "/@react-refresh"; RefreshRuntime.injectIntoGlobalHook(window); window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => type => type; window.__vite_plugin_react_preamble_installed__ = true;</script><script type="module" src="/@vite/client"></script></head><body><div id="root"></div><script type="module" src="/tests/fixtures/feedback-journey.tsx"></script></body></html>' }));
  await page.goto(`/cabinets/feedback-check?game=${game.id}`);
  await expect(footer(page)).toBeVisible();
}

for (const game of games) {
  test(`${game.id}: permanent footer in the real game`, async ({ page }, info) => {
    await page.goto('/');
    await page.getByRole('button', { name: '拒否する', exact: true }).click();
    await page.getByRole('button', { name: '遊ぶ', exact: true }).nth(game.index).click();
    if (game.id === 'dot-wave') {
      await page.getByRole('button', { name: /START.*1クレジットで開始/ }).click();
      await page.getByRole('button', { name: '受け取る', exact: true }).click();
      await page.getByRole('button', { name: /START.*1クレジットで開始/ }).click();
      await expect(page.locator('main.dot-wave')).toHaveAttribute('data-phase', 'playing', { timeout: 12000 });
      await page.keyboard.press('p');
      await expect(page.locator('main.dot-wave')).toHaveAttribute('data-phase', 'paused');
    } else {
      await page.getByRole('button', { name: '受け取る', exact: true }).click();
      await page.getByRole('button', { name: '1クレジットで開始', exact: true }).click();
      await expect(page.locator('#game-screen')).toBeVisible();
    }
    await expect(page.locator('.platform-footer')).toHaveCount(1);
    await footer(page).click();
    await expect(modal(page)).toContainText(`${game.title} ／ プレイ`);
    await page.screenshot({ path: `/tmp/pulbase-feedback-permanent-${game.id}-${info.project.name}.png` });
    await modal(page).getByRole('button', { name: 'フィードバックを閉じる' }).click();
    await expect(modal(page)).not.toBeVisible();
  });

  test(`${game.id}: permanent footer survives game loading failure`, async ({ page }) => {
    await page.route(`**/src/games/${game.module}*`, route => route.abort());
    await page.goto(`/cabinets/${randomUUID()}?game=${game.id}`);
    await page.getByRole('button', { name: '拒否する', exact: true }).click();
    await expect(page.getByText('ゲームを読み込めませんでした。', { exact: true })).toBeVisible();
    await expect(page.locator('.platform-footer')).toHaveCount(1);
    await footer(page).click();
    await expect(modal(page)).toBeVisible();
  });

  test(`${game.id}: completion invites only after return, waits for other dialogs and respects daily limit`, async ({ page }, info) => {
    await journey(page, game);
    await page.getByRole('button', { name: 'プレイ開始', exact: true }).click();
    await page.clock.fastForward(100000);
    await expect(modal(page)).not.toBeVisible();
    await page.getByRole('button', { name: 'プレイ終了', exact: true }).click();
    await page.clock.fastForward(2000);
    await expect(modal(page)).not.toBeVisible();
    await page.getByRole('button', { name: 'トップへ戻る', exact: true }).click();
    await page.getByRole('button', { name: '利用規約', exact: true }).click();
    await page.clock.fastForward(2000);
    await expect(modal(page)).not.toBeVisible();
    await page.getByRole('button', { name: '閉じる', exact: true }).click();
    await page.clock.fastForward(1000);
    await expect(modal(page)).toContainText(`${game.title} ／ プレイ`);
    await page.screenshot({ path: `/tmp/pulbase-feedback-auto-${game.id}-${info.project.name}.png` });
    await modal(page).getByRole('button', { name: 'フィードバックを閉じる' }).click();
    await page.getByRole('button', { name: 'プレイ開始', exact: true }).click();
    await page.getByRole('button', { name: 'プレイ終了', exact: true }).click();
    await page.getByRole('button', { name: 'トップへ戻る', exact: true }).click();
    await page.clock.fastForward(2000);
    await expect(modal(page)).not.toBeVisible();
    await footer(page).click();
    await expect(modal(page)).toBeVisible();
  });

  test(`${game.id}: opening manually before leaving prevents a second invitation`, async ({ page }) => {
    await journey(page, game);
    await page.getByRole('button', { name: 'プレイ終了', exact: true }).click();
    await footer(page).click();
    await expect(modal(page)).toContainText(game.title);
    await modal(page).getByRole('button', { name: 'フィードバックを閉じる' }).click();
    await page.getByRole('button', { name: 'トップへ戻る', exact: true }).click();
    await page.clock.fastForward(2000);
    await expect(modal(page)).not.toBeVisible();
  });

  test(`${game.id}: watching requires sixty active seconds and never interrupts viewing`, async ({ page }) => {
    await journey(page, game);
    await page.clock.fastForward(100000);
    await page.getByRole('button', { name: 'トップへ戻る', exact: true }).click();
    await page.clock.fastForward(2000);
    await expect(modal(page)).not.toBeVisible();
    await page.getByRole('button', { name: '観戦開始', exact: true }).click();
    await page.clock.fastForward(30000);
    await page.getByRole('button', { name: '一時停止', exact: true }).click();
    await page.clock.fastForward(120000);
    await page.getByRole('button', { name: '再開', exact: true }).click();
    await page.clock.fastForward(29000);
    await page.getByRole('button', { name: 'トップへ戻る', exact: true }).click();
    await page.clock.fastForward(2000);
    await expect(modal(page)).not.toBeVisible();
    await page.getByRole('button', { name: '観戦開始', exact: true }).click();
    await page.clock.fastForward(61000);
    await expect(modal(page)).not.toBeVisible();
    await page.getByRole('button', { name: 'トップへ戻る', exact: true }).click();
    await page.clock.fastForward(1000);
    await expect(modal(page)).toContainText(`${game.title} ／ 観戦`);
  });
}
