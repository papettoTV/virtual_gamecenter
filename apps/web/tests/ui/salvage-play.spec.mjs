import { randomUUID } from 'node:crypto';
import { test, expect } from '../../../../ci/ui-fixtures.mjs';

const origin = 'http://127.0.0.1:5174';
const phase = page => page.evaluate(async () =>
  (await import('/src/features/sharing/share-service.ts')).liveSharing.getSnapshot()?.phase);

test('salvage: book isolation, canvas cancellation, authorized duplicate start and restoration', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const bootstrap = page.waitForResponse(r => r.url() === `${origin}/api/platform/bootstrap` && r.request().method() === 'GET');
  await page.goto(origin);
  const account = await (await bootstrap).json();
  if (!account.welcomeCreditGranted) await page.evaluate(async () =>
    (await import('/src/features/platform/platform-client.ts')).claimWelcomeCredit());
  const loaded = page.waitForResponse(r => r.url() === `${origin}/api/platform/bootstrap` && r.request().method() === 'GET');
  await page.goto(`${origin}/cabinets/${randomUUID()}?game=deep-sea-salvage`);
  const localAccount = await (await loaded).json();
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
  await screen.getByRole('button', { name: '潜航開始', exact: true }).click();
  await expect(dialog).toBeVisible();
  // Delay only transport; actual local D1 reservation/capture and authorization run.
  await page.route('**/api/platform/credit-reservations', async route => {
    await new Promise(resolve => setTimeout(resolve, 250)); await route.continue();
  });
  const captured = page.waitForResponse(r => r.request().method() === 'POST' && r.url().endsWith('/capture'));
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
  for (const viewport of [{ width: 320, height: 568 }, { width: 844, height: 390 }, { width: 390, height: 700 }]) {
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
    await info.attach(`salvage-${viewport.width}`, { body: await page.screenshot(), contentType: 'image/png' });
    await screen.locator('#touch-collection').click();
    await expect(screen).toHaveAttribute('data-salvage-collection', 'false');
    await expect.poll(() => phase(page)).toBe('paused');
    await screen.locator('#touch-collection').click();
    await expect(screen).toHaveAttribute('data-salvage-collection', 'true');
  }
  await screen.locator('#touch-collection').click();
  await expect(screen).toHaveAttribute('data-salvage-collection', 'false');
  expect(writes.filter(u => u.endsWith('/credit-reservations'))).toHaveLength(1);
  await screen.locator('#touch-pause').click();
  await expect.poll(() => phase(page)).toBe('playing');
  await screen.getByRole('button', { name: '通常表示に戻る' }).click();
  await expect(screen).not.toHaveAttribute('data-mobile-play');
  expect(await page.evaluate(() => document.body.style.position)).not.toBe('fixed');
  await screen.getByRole('button', { name: '全画面でプレイ' }).click();
  await screen.locator('#touch-pause').click();
  page.once('dialog', dialog => dialog.dismiss());
  await screen.locator('.mobile-play-leave').click();
  await expect(screen).toHaveAttribute('data-mobile-play', 'true');
  page.once('dialog', dialog => dialog.accept());
  await screen.locator('.mobile-play-leave').click();
  await expect(page).toHaveURL(`${origin}/`);
  expect(await page.evaluate(() => document.body.style.position)).not.toBe('fixed');
});
