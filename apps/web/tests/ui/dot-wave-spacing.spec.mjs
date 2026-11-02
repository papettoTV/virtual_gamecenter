import { randomUUID } from 'node:crypto';
import { test, expect } from '../../../../ci/ui-fixtures.mjs';

const sizes = [
  { name: 'iphone-portrait', width: 390, height: 844 },
  { name: 'iphone-landscape', width: 844, height: 390 },
  { name: 'pc', width: 1440, height: 900 },
];

test.beforeEach(async ({ page }, info) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.stack ?? error.message));
  // Check even when a layout assertion fails, so a React crash is reported
  // directly instead of only as a missing game/result element.
  info.layoutPageErrors = errors;
});

test.afterEach(async ({}, info) => {
  await info.attach('page-errors', {
    body: JSON.stringify(info.layoutPageErrors, null, 2), contentType: 'application/json',
  });
  expect(info.layoutPageErrors, 'No uncaught browser errors during the game flow').toEqual([]);
});

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
    await expect(page.locator('#game-screen')).toBeVisible();
    if (size.width <= 820) await page.getByRole('button', { name: 'ゲーム開始', exact: true }).click();
    else await page.keyboard.press('Space');
    await claimGift(page);
    await page.getByRole('button', { name: '1クレジットで開始', exact: true }).click();
    await expect(page.locator('#game-screen')).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, 0));
    const referenceTop = await page.locator('.shell').evaluate(el => el.getBoundingClientRect().top + parseFloat(getComputedStyle(el).paddingTop));
    await evidence(page, info, `${size.name}-buzz-barrier`, { referenceTop, viewport: size });

    // Transform only the browser's game module, never production source. This
    // event arms a one-shot fixture consumed by the live animation loop, rather
    // than freshDuel (which also runs during React renders/reinitialization).
    await page.route('**/src/games/dot-wave/duel/MochiDuel.tsx*', async route => {
      const response = await route.fetch();
      const source = await response.text();
      const loopEntry = /const current = engine\.current;\s*if \(network\?\.matchId && network\.startsAt/;
      expect(source.match(new RegExp(loopEntry.source, 'g'))).toHaveLength(1);
      const body = source.replace(loopEntry, `
        const current = engine.current;
        if (layoutFinishRequested && current.phase === 'playing' && current.mode === 'cpu') {
          layoutFinishRequested = false;
          // Resolve a complete final exchange using the real game rules. In
          // particular, impact rendering requires an outcome and history.
          current.match = fresh('cpu', current.match.ending, 3).match;
          current.match.hp = [100, 1];
          current.exchange = createExchange(0, 0, beatAt(0));
          for (const note of current.exchange.attack.notes) note.grade = 'perfect';
          for (const note of current.exchange.defense.notes) note.grade = 'miss';
          current.outcome = resolve(current.match, current.exchange);
          current.phase = 'impact'; current.impactElapsed = 0; current.cpuStage = 3;
          current.elapsedPlayMs = 180000;
          current.score = { total: 54820, maxCombo: 42, combo: 0, bossBonus: 1200 };
          sound.current?.stop();
        }
        if (network?.matchId && network.startsAt`) + `
        let layoutFinishRequested = false;
        window.addEventListener('dot-wave-layout-finish', () => { layoutFinishRequested = true; });
      `;
      await route.fulfill({ response, body });
    });

    await enter(page, 'dot-wave');
    const main = page.locator('main.dot-wave');
    await expect(main).toHaveAttribute('data-phase', 'intro');
    await expect(page.locator('.dot-cabinet-bar > span')).toContainText('あなたの筐体');
    await accountWorks(page);
    await evidence(page, info, `${size.name}-intro`, await geometry(page, referenceTop));
    await page.getByRole('button', { name: 'START / ゲーム開始', exact: true }).click();
    await page.getByRole('dialog', { name: 'ゲームを開始しますか？', exact: true }).getByRole('button', { name: '1クレジットで開始', exact: true }).click();
    await expect(main).toHaveAttribute('data-phase', 'playing', { timeout: 12000 });
    const tap = page.locator('.duel-tap');
    await expect(tap).toBeEnabled();
    await tap.click();
    await evidence(page, info, `${size.name}-playing`, await geometry(page, referenceTop));

    // Finish the engine already playing in this cabinet. The normal impact ->
    // finished transition must notify soloEnded; keep the real start receipt,
    // authentication, credits and ranking API untouched.
    await page.evaluate(() => window.dispatchEvent(new Event('dot-wave-layout-finish')));
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
