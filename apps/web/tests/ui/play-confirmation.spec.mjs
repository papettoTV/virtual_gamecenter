import { test, expect } from '../../../../ci/ui-fixtures.mjs';

const origin = 'http://127.0.0.1:5174';
const games = [
  { id: 'graze-duel', button: 'ゲーム開始', key: 'Space' },
  { id: 'deep-sea-salvage', button: '潜航開始', key: 'p' },
  { id: 'dot-wave', button: 'START / ゲーム開始', key: 'Space' },
];
async function wallet(page) {
  return page.evaluate(async () => (await (await import('/src/features/platform/platform-client.ts')).fetchPlatformBootstrap()).wallet.availableTotal);
}
async function phase(page, game) {
  return page.evaluate(async game => game === 'dot-wave'
    ? document.querySelector('main.dot-wave[data-phase]')?.dataset.phase
    : (await import('/src/features/sharing/share-service.ts')).liveSharing.getSnapshot()?.phase, game);
}
for (const game of games) {
  for (const input of ['button', 'keyboard']) {
    test(`${game.id}: ${input}, ready, cancel, delayed duplicate and authorized start`, async ({ page }) => {
      await page.goto(origin);
      // Only the disposable local guest and the real welcome-credit API are used.
      await page.evaluate(async () => {
        const api = await import('/src/features/platform/platform-client.ts');
        const account = await api.fetchPlatformBootstrap();
        if (!account.welcomeCreditGranted) await api.claimWelcomeCredit();
      });
      const writes = [];
      page.on('request', request => {
        if (request.method() === 'POST' && request.url().includes('/api/platform/credit-reservations')) writes.push(request.url());
      });
      await page.goto(`${origin}/cabinets/confirmation-${game.id}-${input}?game=${game.id}&start=1`);
      const start = page.getByRole('button', { name: game.button, exact: true });
      await expect(start).toBeVisible();
      await expect(start).toBeEnabled();
      const ready = game.id === 'dot-wave' ? 'intro' : 'ready';
      await expect.poll(() => phase(page, game.id)).toBe(ready);
      await expect(page.getByRole('dialog', { name: 'ゲームを開始しますか？' })).toBeHidden();
      expect(writes).toHaveLength(0);
      await page.reload();
      await expect(start).toBeVisible();
      await expect.poll(() => phase(page, game.id)).toBe(ready);
      expect(writes).toHaveLength(0);
      const balance = await wallet(page);
      const intent = async () => {
        if (input === 'button') await start.click();
        else { await page.locator('body').click({ position: { x: 2, y: 2 } }); await page.keyboard.press(game.key); }
      };
      await intent();
      const dialog = page.getByRole('dialog', { name: 'ゲームを開始しますか？', exact: true });
      await expect(dialog).toBeVisible();
      await page.evaluate(code => window.dispatchEvent(new KeyboardEvent('keydown', { code, repeat: true, bubbles: true })), game.key === 'p' ? 'KeyP' : 'Space');
      await expect.poll(() => phase(page, game.id)).toBe(ready);
      expect(writes).toHaveLength(0);
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
      expect(await wallet(page)).toBe(balance);
      await intent();
      await dialog.getByRole('button', { name: 'キャンセル', exact: true }).click();
      await expect(dialog).toBeHidden();
      await expect.poll(() => phase(page, game.id)).toBe(ready);
      expect(await wallet(page)).toBe(balance);
      await intent();
      // Delay the real request, without replacing credit or authorization responses.
      await page.route('**/api/platform/credit-reservations', async route => {
        await new Promise(resolve => setTimeout(resolve, 250));
        await route.continue();
      });
      await dialog.getByRole('button', { name: '1クレジットで開始', exact: true }).evaluate(button => { button.click(); button.click(); });
      await page.keyboard.press(game.key);
      await expect.poll(async () => ['playing', 'countdown', 'paused'].includes(await phase(page, game.id))).toBe(true);
      await expect(dialog).toBeHidden();
      await expect.poll(() => wallet(page)).toBe(balance - 1);
      expect(writes.filter(url => url.endsWith('/credit-reservations'))).toHaveLength(1);
      expect(writes.filter(url => url.endsWith('/capture'))).toHaveLength(1);
      expect(writes.filter(url => url.endsWith('/release'))).toHaveLength(0);
    });
  }
  test(`${game.id}: failed capture keeps play stopped and releases the unused reservation`, async ({ page }) => {
    await page.goto(origin);
    await page.evaluate(async () => {
      const api = await import('/src/features/platform/platform-client.ts');
      const account = await api.fetchPlatformBootstrap();
      if (!account.welcomeCreditGranted) await api.claimWelcomeCredit();
    });
    await page.goto(`${origin}/cabinets/confirmation-failed-${game.id}?game=${game.id}`);
    const start = page.getByRole('button', { name: game.button, exact: true });
    await expect(start).toBeVisible(); await expect(start).toBeEnabled();
    const balance = await wallet(page);
    await page.route('**/api/platform/credit-reservations/*/capture', route => route.abort());
    await start.click();
    const released = page.waitForResponse(response => response.url().endsWith('/release') && response.ok());
    await page.getByRole('dialog', { name: 'ゲームを開始しますか？', exact: true })
      .getByRole('button', { name: '1クレジットで開始', exact: true }).click();
    await released;
    await expect.poll(() => phase(page, game.id)).toBe(game.id === 'dot-wave' ? 'intro' : 'ready');
    expect(await wallet(page)).toBe(balance);
  });
  test(`${game.id}: spectator never requests a start`, async ({ page }) => {
    const writes = [];
    page.on('request', request => { if (request.method() === 'POST' && request.url().includes('credit-reservations')) writes.push(request.url()); });
    await page.goto(`${origin}/cabinets/confirmation-watch-${game.id}?game=${game.id}&watch=1&start=1`);
    await page.keyboard.press(game.key);
    await expect(page.getByRole('dialog', { name: 'ゲームを開始しますか？' })).toBeHidden();
    expect(writes).toHaveLength(0);
  });
}
