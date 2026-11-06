import { randomUUID } from 'node:crypto';
import { test, expect } from '../../../../ci/ui-fixtures.mjs';

const origin = 'http://127.0.0.1:5174';
const phase = page => page.evaluate(async () =>
  (await import('/src/features/sharing/share-service.ts')).liveSharing.getSnapshot()?.phase);

// Independent guests keep each scenario below the runner's normal case timeout.
async function prepare(page) {
  const sockets = new Set();
  page.on('websocket', socket => {
    if (!/^\/api\/cabinets\/[^/]+\/ws$/.test(new URL(socket.url()).pathname)) return;
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await page.setViewportSize({ width: 390, height: 844 });
  const bootstrap = page.waitForResponse(r => r.url() === `${origin}/api/platform/bootstrap` && r.request().method() === 'GET', { timeout: 10000 });
  await page.goto(origin, { waitUntil: 'domcontentloaded' });
  const bootstrapResponse = await bootstrap;
  expect(bootstrapResponse.ok()).toBe(true);
  const account = await bootstrapResponse.json();
  if (!account.welcomeCreditGranted) await page.evaluate(async () =>
    (await import('/src/features/platform/platform-client.ts')).claimWelcomeCredit());
  const loaded = page.waitForResponse(r => r.url() === `${origin}/api/platform/bootstrap` && r.request().method() === 'GET', { timeout: 10000 });
  await page.goto(`${origin}/cabinets/${randomUUID()}?game=deep-sea-salvage`, { waitUntil: 'domcontentloaded' });
  const loadedResponse = await loaded;
  expect(loadedResponse.ok()).toBe(true);
  const localAccount = await loadedResponse.json();
  const decline = page.getByRole('button', { name: '拒否する', exact: true });
  if (await decline.isVisible()) await decline.click();
  const screen = page.locator('#game-screen');
  await expect.poll(() => phase(page)).toBe('ready');
  await expect(screen.locator('.salvage-touch-help').first()).toBeVisible();
  await expect(screen.locator('.salvage-key-help').first()).toBeHidden();
  await expect(screen.locator('.ranking-panel, .ranking-registration-section')).toHaveCount(0);
  await expect(screen.locator('#touch-pause')).toBeHidden();
  const writes = [];
  page.on('request', r => {
    if (r.method() === 'POST' && r.url().includes('/api/platform/credit-reservations')) writes.push(r.url());
  });
  return { screen, localAccount, writes, sockets };
}

async function start(page, { screen, localAccount, writes }, canvasStart = false) {
  const dialog = page.getByRole('dialog', { name: 'ゲームを開始しますか？', exact: true });
  if (canvasStart) await screen.locator('#game').click({ position: { x: 20, y: 20 } });
  else await screen.getByRole('button', { name: '潜航開始', exact: true }).click();
  await expect(dialog).toBeVisible();
  expect(writes).toHaveLength(0);
  // Delay only transport; actual local D1 reservation/capture and authorization run.
  await page.route('**/api/platform/credit-reservations', async route => {
    await new Promise(resolve => setTimeout(resolve, 250)); await route.continue();
  });
  const captured = page.waitForResponse(r => r.request().method() === 'POST' && r.url().endsWith('/capture'), { timeout: 10000 });
  await dialog.getByRole('button', { name: '1クレジットで開始', exact: true }).evaluate(button => { button.click(); button.click(); });
  await page.locator('#game').dispatchEvent('pointerdown', { clientX: 150, clientY: 200 });
  await page.locator('#game').dispatchEvent('pointerup');
  const capture = await (await captured).json();
  expect(capture.status).toBe('captured');
  expect(capture.wallet.availableTotal).toBe(localAccount.wallet.availableTotal - 1);
  await expect.poll(() => phase(page)).toBe('playing');
  await expect(screen).toHaveAttribute('data-mobile-play', 'true');
  expect(writes.filter(u => u.endsWith('/credit-reservations'))).toHaveLength(1);
  expect(writes.filter(u => u.endsWith('/capture'))).toHaveLength(1);
  expect(writes.filter(u => u.endsWith('/release'))).toHaveLength(0);
  await expect(screen.locator('.game-share-button')).toBeHidden();
  await expect(screen.locator('#salvage-status')).toContainText('POWER');
}

test('salvage: ready book isolation and cancelled canvas authorization', async ({ page }) => {
  const { screen, localAccount, writes } = await prepare(page);
  const book = screen.locator('#salvage-ready-collection');
  await expect(book).toHaveAccessibleName('図鑑を開く');
  const bounds = await book.boundingBox();
  expect(bounds.width).toBeGreaterThanOrEqual(44);
  expect(bounds.height).toBeGreaterThanOrEqual(44);
  await book.click();
  await expect(book).toHaveAccessibleName('図鑑を閉じる');
  await expect(screen.locator('.salvage-intro')).toBeHidden();
  await expect.poll(() => phase(page)).toBe('ready');
  expect(writes).toHaveLength(0);
  await book.click();
  await expect(screen.locator('.salvage-intro')).toBeVisible();

  const dialog = page.getByRole('dialog', { name: 'ゲームを開始しますか？', exact: true });
  // A canvas gesture outside the HTML start button follows the same authorization.
  await screen.locator('#game').click({ position: { x: 20, y: 20 } });
  await expect(dialog).toBeVisible();
  expect(writes).toHaveLength(0);
  await dialog.getByRole('button', { name: 'キャンセル', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect.poll(() => phase(page)).toBe('ready');
  await expect(page.locator('.platform-credit-badge')).toHaveText(String(localAccount.wallet.availableTotal));
  expect(writes).toHaveLength(0);
  expect(await page.evaluate(async () => {
    const response = await fetch('/api/platform/credits');
    if (!response.ok) throw new Error(`Wallet read failed: ${response.status}`);
    return (await response.json()).wallet.availableTotal;
  })).toBe(localAccount.wallet.availableTotal);
});

test('salvage: real authorization, duplicate inputs and single capture', async ({ page }) => {
  const state = await prepare(page);
  await start(page, state, true);
  await expect(page.getByRole('dialog', { name: 'ゲームを開始しますか？', exact: true })).toBeHidden();
  await expect(state.screen.locator('.salvage-intro')).toBeHidden();
  await expect(state.screen).toHaveAttribute('data-salvage-collection', 'false');
  await state.screen.locator('#touch-pause').click();
  await expect.poll(() => phase(page)).toBe('paused');
});

for (const viewport of [{ width: 320, height: 568 }, { width: 844, height: 390 }, { width: 390, height: 700 }]) {
  test(`salvage ${viewport.width}: status, book and pause after rotation`, async ({ page }, info) => {
    const state = await prepare(page);
    const { screen, writes } = state;
    await start(page, state);
    // Pausing and auxiliary controls cannot become movement/start input.
    await screen.locator('#touch-pause').click();
    await expect.poll(() => phase(page)).toBe('paused');
    const statusNodeIsStable = await screen.locator('#salvage-status').evaluate(async status => {
      const text = status.firstChild;
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return status.firstChild === text;
    });
    expect(statusNodeIsStable).toBe(true);
    await screen.locator('#touch-collection').click();
    await expect(screen).toHaveAttribute('data-salvage-collection', 'true');
    await page.setViewportSize(viewport);
    const status = await screen.locator('#salvage-status').boundingBox();
    expect(status.y).toBeGreaterThanOrEqual(0);
    expect(status.y + status.height).toBeLessThanOrEqual(viewport.height);
    expect(status.width).toBeGreaterThan(viewport.width - 50);
    const pause = await screen.locator('#touch-pause').boundingBox();
    const collection = await screen.locator('#touch-collection').boundingBox();
    expect(pause.y).toBeGreaterThanOrEqual(status.y + status.height);
    expect(collection.y).toBeGreaterThanOrEqual(status.y + status.height);
    expect(collection.y + collection.height).toBeLessThanOrEqual(viewport.height);
    expect(collection.x + collection.width).toBeLessThanOrEqual(pause.x);
    await expect(screen.locator('#touch-collection')).toHaveAccessibleName('図鑑を閉じる');
    expect(collection.width).toBeGreaterThanOrEqual(44);
    expect(collection.height).toBeGreaterThanOrEqual(44);
    const canvas = await screen.locator('#game').boundingBox();
    expect(canvas.width).toBeGreaterThan(0); expect(canvas.height).toBeGreaterThan(0);
    // The collection (including the last row) is drawn inside this canvas.
    // Checking its entire bounds catches overlays even when controls miss each other.
    const leave = screen.locator('.mobile-play-leave');
    await expect(leave).toBeVisible();
    const exit = await leave.boundingBox();
    expect(exit.y).toBeGreaterThanOrEqual(canvas.y + canvas.height);
    expect(exit.y).toBeGreaterThanOrEqual(pause.y + pause.height);
    expect(exit.y + exit.height).toBeLessThanOrEqual(viewport.height);
    expect(exit.height).toBeGreaterThanOrEqual(44);
    // Let transient credit notifications expire naturally before collecting evidence.
    await expect(page.locator('.notification')).toHaveCount(0, { timeout: 15000 });
    await info.attach(`salvage-${viewport.width}`, { body: await page.screenshot(), contentType: 'image/png' });
    await screen.getByRole('button', { name: '通常表示に戻る' }).click();
    await expect(screen).not.toHaveAttribute('data-mobile-play');
    await expect(screen).toHaveAttribute('data-salvage-collection', 'true');
    await expect(leave).toBeHidden();
    const fullscreen = screen.getByRole('button', { name: '全画面でプレイ' });
    const eligible = await page.evaluate(() => matchMedia('(max-width: 820px), (pointer: coarse)').matches);
    if (eligible) await expect(fullscreen).toBeVisible({ timeout: 5000 });
    else await expect(fullscreen).toHaveCount(0, { timeout: 5000 });
    // Preserve the landscape book checks above; reentry uses an eligible width
    // even in the desktop project's fine-pointer browser.
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(fullscreen).toBeVisible({ timeout: 5000 });
    await fullscreen.click({ timeout: 5000 });
    await expect(screen).toHaveAttribute('data-mobile-play', 'true');
    await expect(leave).toBeVisible();
    const restoredCanvas = await screen.locator('#game').boundingBox();
    const restoredExit = await leave.boundingBox();
    expect(restoredExit.y).toBeGreaterThanOrEqual(restoredCanvas.y + restoredCanvas.height);
    await screen.locator('#touch-collection').click();
    await expect(screen).toHaveAttribute('data-salvage-collection', 'false');
    await expect.poll(() => phase(page)).toBe('paused');
    await screen.locator('#touch-collection').click();
    await expect(screen).toHaveAttribute('data-salvage-collection', 'true');
    await screen.locator('#touch-collection').click();
    await expect(screen).toHaveAttribute('data-salvage-collection', 'false');
    expect(writes.filter(u => u.endsWith('/credit-reservations'))).toHaveLength(1);
    await screen.locator('#touch-pause').click();
    await expect.poll(() => phase(page)).toBe('playing');
  });
}

test('salvage: restore, reenter fullscreen and exit directly with connection cleanup', async ({ page }) => {
  const state = await prepare(page);
  const { screen, localAccount, writes, sockets } = state;
  await start(page, state);
  await expect.poll(() => sockets.size).toBe(1);
  await screen.getByRole('button', { name: '通常表示に戻る' }).click();
  await expect(screen).not.toHaveAttribute('data-mobile-play');
  const scrollState = () => page.evaluate(() => ({
    fixed: document.body.style.position === 'fixed',
    hidden: document.body.style.overflow === 'hidden',
    inert: document.querySelectorAll('[inert]').length,
    fullscreen: Boolean(document.fullscreenElement),
  }));
  await expect.poll(scrollState).toEqual({ fixed: false, hidden: false, inert: 0, fullscreen: false });
  await screen.getByRole('button', { name: '全画面でプレイ' }).click();
  await expect(screen).toHaveAttribute('data-mobile-play', 'true');
  await screen.locator('#touch-pause').click();
  await expect.poll(() => phase(page)).toBe('paused');
  await screen.locator('#touch-collection').click();
  await expect(screen).toHaveAttribute('data-salvage-collection', 'true');
  const dialogs = [];
  page.on('dialog', async dialog => { dialogs.push(dialog.message()); await dialog.dismiss(); });
  await screen.locator('.mobile-play-leave').click();
  await expect(page).toHaveURL(`${origin}/`);
  await expect(screen).toHaveCount(0);
  await expect.poll(() => phase(page)).toBeUndefined();
  await expect.poll(() => sockets.size).toBe(0);
  await expect.poll(scrollState).toEqual({ fixed: false, hidden: false, inert: 0, fullscreen: false });
  await expect(page.locator('.platform-credit-badge')).toHaveText(String(localAccount.wallet.availableTotal - 1));
  expect(await page.evaluate(async () => {
    const response = await fetch('/api/platform/credits');
    if (!response.ok) throw new Error(`Wallet read failed: ${response.status}`);
    return (await response.json()).wallet.availableTotal;
  })).toBe(localAccount.wallet.availableTotal - 1);
  expect(dialogs).toEqual([]);
  expect(writes.filter(u => u.endsWith('/credit-reservations'))).toHaveLength(1);
  expect(writes.filter(u => u.endsWith('/capture'))).toHaveLength(1);
  expect(writes.filter(u => u.endsWith('/release'))).toHaveLength(0);
});
