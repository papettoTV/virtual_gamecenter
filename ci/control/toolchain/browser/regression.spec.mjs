import { test, expect } from '@playwright/test';
test.beforeEach(async ({context}) => {
  await context.route('**/*', route => new URL(route.request().url()).origin === 'https://develop.virtual-gamecenter.pages.dev' ? route.continue() : route.abort());
  await context.routeWebSocket('**/*', socket => new URL(socket.url()).origin === 'wss://develop.virtual-gamecenter.pages.dev' ? socket.connectToServer() : socket.close());
});
const sha = process.env.PULBASE_EXPECTED_SHA;
test('home renders active games and versioned Worker/Pages', async ({ page }) => {
  const exceptions = [];
  page.on('pageerror', error => exceptions.push(error.message));
  const response = await page.goto('/');
  expect(response.status()).toBe(200);
  expect(response.headers()['x-pulbase-revision']).toBe(sha);
  expect(response.headers()['x-pulbase-gateway-revision']).toBe(process.env.PULBASE_EXPECTED_GATEWAY_SHA ?? sha);
  await expect(page.getByRole('img', { name: 'PULBASE', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'ゲームを見て回る' })).toBeVisible();
  await expect(page.locator('.game-showcase h2').first()).toBeVisible();
  await expect(page.getByRole('button', { name: /^遊ぶ/ }).first()).toBeVisible();
  expect(exceptions).toEqual([]);
});
for (const [path, marker] of [['/legal/terms', '利用規約'], ['/legal/privacy', 'プライバシー']]) {
  test(`legal navigation ${path}`, async ({ page }) => {
    const response = await page.goto(path);
    expect(response.status()).toBe(200);
    await expect(page.locator('body')).toContainText(marker);
    // No credit spending or Google sign-in. Home bootstrap creates a fresh test guest.
  });
}

test('game navigation allows declining credit and returning before play', async ({ page, isMobile }) => {
  const reservations = [];
  page.on('request', request => {
    if (request.method() === 'POST' && new URL(request.url()).pathname.startsWith('/api/platform/credit-reservations')) reservations.push(request.url());
  });
  await page.goto('/');
  await page.getByRole('button', { name: '拒否する', exact: true }).click();
  await page.getByRole('button', { name: /^遊ぶ/ }).first().click();
  await expect(page).toHaveURL(/\/cabinets\//);
  const cabinet = new URL(page.url());
  cabinet.searchParams.delete('start');
  const cabinetUrl = cabinet.href;
  expect(cabinet.searchParams.get('game')).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  await expect(page.getByRole('button', { name: 'プロフィールを表示', exact: true })).toBeVisible();
  const badge = page.locator('.platform-credit-badge');
  await expect(badge).toBeVisible();
  const balance = await badge.textContent();
  const welcome = page.getByRole('dialog', { name: '無料5クレジット', exact: true });
  const gate = page.getByRole('dialog', { name: /クレジットが不足しています|ゲームを開始しますか/ });
  await expect(welcome).toBeHidden();
  await expect(gate).toBeHidden();
  const startButton = page.locator('button[data-ready-start]:visible');
  const keyboardStart = page.locator('[data-ready-start-key]:visible');
  await expect(startButton.or(keyboardStart)).toHaveCount(1);
  expect(reservations).toEqual([]);
  if (await startButton.isVisible()) {
    if (isMobile) await startButton.tap();
    else await startButton.click();
  } else {
    expect(isMobile).toBe(false);
    const key = await keyboardStart.getAttribute('data-ready-start-key');
    expect(key).toMatch(/^(?:Space|Enter|[a-z])$/);
    await page.keyboard.press(key);
  }
  await expect(welcome.or(gate)).toBeVisible();
  if (await welcome.isVisible()) {
    await welcome.getByRole('button', { name: '受け取らない', exact: true }).click();
  }
  await expect(gate).toBeVisible();
  await gate.locator('.platform-cancel-button').click();
  await expect(gate).toBeHidden();
  await expect(welcome).toBeHidden();
  await expect(page).toHaveURL(cabinetUrl);
  await expect(badge).toHaveText(balance);
  expect(reservations).toEqual([]);
  // Cancellation stays in READY; navigation is a separate explicit action.
  page.once('dialog', dialog => dialog.accept());
  await page.locator(':is(button, a)[data-return-to-arcade]:visible').click();
  await expect(page.getByRole('region', { name: 'ゲームを見て回る' })).toBeVisible();
  expect(reservations).toEqual([]);
});
