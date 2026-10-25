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
  expect(response.headers()['x-pulbase-gateway-revision']).toBe(sha);
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

test('game navigation allows declining credit and returning before play', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '拒否する', exact: true }).click();
  await page.getByRole('button', { name: /^遊ぶ/ }).first().click();
  await expect(page).toHaveURL(/\/cabinets\//);
  const welcome = page.getByRole('dialog', { name: '無料5クレジット', exact: true });
  await expect(welcome).toBeVisible();
  await welcome.getByRole('button', { name: '受け取らない', exact: true }).click();
  const gate = page.getByRole('dialog', { name: /クレジットが不足しています|ゲームを開始しますか/ });
  await expect(gate).toBeVisible();
  await gate.locator('.platform-cancel-button').click();
  await expect(page.getByRole('region', { name: 'ゲームを見て回る' })).toBeVisible();
});
