import { randomUUID } from 'node:crypto';
import { test, expect } from '../../../../ci/ui-fixtures.mjs';

const sizes = [
  { name: 'iphone-portrait', width: 390, height: 844 },
  { name: 'iphone-landscape', width: 844, height: 390 },
  { name: 'pc', width: 1440, height: 900 },
];

async function enter(page, game) {
  await page.goto('/');
  const decline = page.getByRole('button', { name: '拒否する', exact: true });
  if (await decline.isVisible()) await decline.click();
  await page.goto(`/cabinets/${randomUUID()}?game=${game}&start=1`);
}

async function claimGift(page) {
  await page.getByRole('button', { name: '受け取る', exact: true }).click();
}

async function accountWorks(page) {
  const button = page.getByRole('button', { name: 'プロフィールを表示', exact: true });
  await button.click();
  await expect(page.getByRole('region', { name: 'プレイヤー情報', exact: true })).toBeVisible();
  await button.click();
  await expect(button).toHaveAttribute('aria-expanded', 'false');
}

async function geometry(page, referenceTop) {
  await page.evaluate(() => window.scrollTo(0, 0));
  const rects = await page.evaluate(() => {
    const box = selector => {
      const r = document.querySelector(selector).getBoundingClientRect();
      return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
    };
    return {
      bar: box('.dot-cabinet-bar'), label: box('.dot-cabinet-bar > span'),
      header: box('main.dot-wave > header'), board: box('.duel-board'),
      account: box('.platform-profile-button'),
      actions: box('.dot-cabinet-actions'), viewport: innerWidth,
      overflow: document.documentElement.scrollWidth,
    };
  });
  const { bar, label, header, board, account, actions, viewport } = rects;
  // BUZZ BARRIER's normal shell starts at 8px on mobile / 28px on PC.
  // Allow the existing desktop bar margin, but reject the old extra 55px padding.
  expect(Math.abs(label.y - referenceTop)).toBeLessThanOrEqual(40);
  expect(label.y).toBeLessThanOrEqual(viewport <= 820 ? 24 : 52);
  expect(header.y - bar.bottom).toBeGreaterThanOrEqual(0);
  expect(header.y - bar.bottom).toBeLessThanOrEqual(12);
  expect(board.y).toBeGreaterThanOrEqual(header.bottom);
  for (const r of [bar, label, header, board, account, actions]) {
    expect(r.x).toBeGreaterThanOrEqual(0);
    expect(r.right).toBeLessThanOrEqual(viewport + 1);
    expect(r.width).toBeGreaterThan(0);
    expect(r.height).toBeGreaterThan(0);
  }
  const overlaps = r => r.x < account.right && r.right > account.x && r.y < account.bottom && r.bottom > account.y;
  for (const r of [label, actions, header, board]) expect(overlaps(r)).toBe(false);
  expect(rects.overflow).toBeLessThanOrEqual(viewport + 1);
  return rects;
}

async function evidence(page, info, name, measurements) {
  await info.attach(`${name}-geometry`, { body: JSON.stringify(measurements, null, 2), contentType: 'application/json' });
  await info.attach(name, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
}

for (const size of sizes) {
  test(`${size.name}: normal page intro, playing and ALL CLEAR spacing`, async ({ page }, info) => {
    test.setTimeout(60000);
    await page.setViewportSize({ width: size.width, height: size.height });
    // Use the real local server, guest bootstrap and cabinet connection.
    await enter(page, 'graze-duel');
    await claimGift(page);
    await page.getByRole('button', { name: '1クレジットで開始', exact: true }).click();
    await expect(page.locator('#game-screen')).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, 0));
    const referenceTop = await page.locator('.shell').evaluate(el => el.getBoundingClientRect().top + parseFloat(getComputedStyle(el).paddingTop));
    await evidence(page, info, `${size.name}-buzz-barrier`, { referenceTop, viewport: size });

    await enter(page, 'dot-wave');
    const main = page.locator('main.dot-wave');
    await expect(main).toHaveAttribute('data-phase', 'intro');
    await expect(page.locator('.dot-cabinet-bar > span')).toContainText('あなたの筐体');
    await accountWorks(page);
    await evidence(page, info, `${size.name}-intro`, await geometry(page, referenceTop));
    await page.getByRole('button', { name: /START.*1クレジットで開始/ }).click();
    await expect(main).toHaveAttribute('data-phase', 'playing', { timeout: 12000 });
    const tap = page.locator('.duel-tap');
    await expect(tap).toBeEnabled();
    await tap.click();
    await evidence(page, info, `${size.name}-playing`, await geometry(page, referenceTop));

    // Seed only the game engine's first render, without altering platform,
    // authentication, credits, ranking endpoints, or production source files.
    // The full cabinet page and real result/ranking/retry components still render.
    await page.route('**/src/games/dot-wave/duel/campaign.ts*', async route => {
      const response = await route.fetch();
      const source = await response.text();
      expect(source).toContain('function freshDuel(');
      const body = source.replace('function freshDuel(', 'function originalFreshDuel(') + `
        let seeded = false;
        export function freshDuel(...args) {
          const engine = originalFreshDuel(...args);
          if (!seeded) {
            seeded = true;
            engine.phase = 'finished'; engine.cpuStage = 3;
            engine.match.winner = 0; engine.match.hp = [100, 0];
            engine.elapsedPlayMs = 180000;
            engine.score = { total: 54820, maxCombo: 42, combo: 0, bossBonus: 1200 };
          }
          return engine;
        }
      `;
      await route.fulfill({ response, body });
    });
    await enter(page, 'dot-wave');
    await expect(main).toHaveAttribute('data-phase', 'finished');
    await expect(page.locator('.dot-result-card h2')).toHaveText('ALL CLEAR');
    await expect(page.locator('.dot-result-card .result-score')).toContainText('54,820');
    await accountWorks(page);
    await evidence(page, info, `${size.name}-all-clear`, await geometry(page, referenceTop));
    const ranking = page.getByRole('button', { name: 'ランキングに登録', exact: true });
    await expect(ranking).toBeEnabled();
    await ranking.scrollIntoViewIfNeeded();
    await expect(ranking).toBeInViewport();
    const submission = page.waitForResponse(response =>
      new URL(response.url()).pathname === '/api/ranking' && response.request().method() === 'POST');
    await ranking.click();
    expect((await submission).ok()).toBe(true);
    await expect(ranking).toHaveCount(0);
    await expect(page.locator('.dot-result-card .result-score')).toContainText('54,820');
    const retry = page.getByRole('button', { name: '1クレジットでリトライ', exact: true });
    await retry.scrollIntoViewIfNeeded();
    await expect(retry).toBeInViewport();
    await evidence(page, info, `${size.name}-result-actions`, { rankingSubmitted: true });
    await retry.click();
    await expect(main).toHaveAttribute('data-phase', 'intro');
    await geometry(page, referenceTop);
  });
}
