import { randomUUID } from 'node:crypto';
import { test, expect } from '../../../../ci/ui-fixtures.mjs';
import { localUiUrl } from '../../../../ci/ui-tests.mjs';

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
  for (const input of ['primary', 'keyboard']) {
    test(`${game.id}: ${input}, ready, cancel, delayed duplicate and authorized start`, async ({ page, isMobile }) => {
      await page.goto(origin);
      const decline = page.getByRole('button', { name: '拒否する', exact: true });
      if (await decline.isVisible()) await decline.click();
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
      await page.goto(`${origin}/cabinets/${randomUUID()}?game=${game.id}&start=1`);
      const start = page.getByRole('button', { name: game.button, exact: true });
      if (isMobile || game.id === 'dot-wave') { await expect(start).toBeVisible(); await expect(start).toBeEnabled(); }
      const ready = game.id === 'dot-wave' ? 'intro' : 'ready';
      await expect.poll(() => phase(page, game.id)).toBe(ready);
      await expect(page.getByRole('dialog', { name: 'ゲームを開始しますか？' })).toBeHidden();
      expect(writes).toHaveLength(0);
      await page.reload();
      if (isMobile || game.id === 'dot-wave') await expect(start).toBeVisible();
      await expect.poll(() => phase(page, game.id)).toBe(ready);
      expect(writes).toHaveLength(0);
      const balance = await wallet(page);
      const intent = async () => {
        if (input === 'primary' && isMobile) await start.tap();
        else if (input === 'primary' && game.id === 'dot-wave') await start.click();
        else { await page.locator('body').click({ position: { x: 2, y: 2 } }); await page.keyboard.press(game.key); }
      };
      await intent();
      const dialog = page.getByRole('dialog', { name: 'ゲームを開始しますか？', exact: true });
      await expect(dialog).toBeVisible();
      await page.evaluate(code => window.dispatchEvent(new KeyboardEvent('keydown', { code, repeat: true, bubbles: true })), game.key === 'p' ? 'KeyP' : 'Space');
      await expect.poll(() => phase(page, game.id)).toBe(ready);
      expect(writes).toHaveLength(0);
      // A document listener sees real game keys only after the window capture guard.
      await page.evaluate(() => {
        window.dialogKeysAtDocument = [];
        document.addEventListener('keydown', event => window.dialogKeysAtDocument.push(event.code));
      });
      await page.keyboard.press(game.key);
      await expect(dialog).toBeVisible();
      await page.keyboard.press('Escape');
      expect(await page.evaluate(() => window.dialogKeysAtDocument)).toEqual([]);
      await expect(dialog).toBeHidden();
      expect(await wallet(page)).toBe(balance);
      await page.keyboard.press('Shift');
      expect(await page.evaluate(() => window.dialogKeysAtDocument)).toContain('ShiftLeft');
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
  test(`${game.id}: failed capture keeps play stopped and releases the unused reservation`, async ({ page, isMobile }) => {
    await page.goto(origin);
    const decline = page.getByRole('button', { name: '拒否する', exact: true });
    if (await decline.isVisible()) await decline.click();
    await page.evaluate(async () => {
      const api = await import('/src/features/platform/platform-client.ts');
      const account = await api.fetchPlatformBootstrap();
      if (!account.welcomeCreditGranted) await api.claimWelcomeCredit();
    });
    await page.goto(`${origin}/cabinets/${randomUUID()}?game=${game.id}`);
    const start = page.getByRole('button', { name: game.button, exact: true });
    if (isMobile || game.id === 'dot-wave') { await expect(start).toBeVisible(); await expect(start).toBeEnabled(); }
    await expect.poll(() => phase(page, game.id)).toBe(game.id === 'dot-wave' ? 'intro' : 'ready');
    const balance = await wallet(page);
    await page.route('**/api/platform/credit-reservations/*/capture', route => route.abort());
    if (isMobile) await start.tap();
    else { await page.locator('body').click({ position: { x: 2, y: 2 } }); await page.keyboard.press(game.key); }
    const released = page.waitForResponse(response => response.url().endsWith('/release') && response.ok());
    await page.getByRole('dialog', { name: 'ゲームを開始しますか？', exact: true })
      .getByRole('button', { name: '1クレジットで開始', exact: true }).click();
    await released;
    await expect.poll(() => phase(page, game.id)).toBe(game.id === 'dot-wave' ? 'intro' : 'ready');
    expect(await wallet(page)).toBe(balance);
  });
  for (const occupied of [false, true]) {
    test(`${game.id}: spectator never requests a start (${occupied ? 'live player' : 'empty cabinet'})`, async ({ page, browser }) => {
      const cabinet = `${origin}/cabinets/${randomUUID()}?game=${game.id}`;
      const playerContext = occupied ? await browser.newContext() : null;
      try {
        if (playerContext) {
          // Extra contexts need the same local-only network boundary as the fixture.
          await playerContext.route('**/*', route => localUiUrl(route.request().url()) ? route.continue() : route.abort());
          await playerContext.routeWebSocket('**/*', socket => localUiUrl(socket.url()) ? socket.connectToServer() : socket.close());
          const player = await playerContext.newPage();
          await player.goto(origin);
          const decline = player.getByRole('button', { name: '拒否する', exact: true });
          if (await decline.isVisible()) await decline.click();
          await player.evaluate(async () => {
            const api = await import('/src/features/platform/platform-client.ts');
            const account = await api.fetchPlatformBootstrap();
            if (!account.welcomeCreditGranted) await api.claimWelcomeCredit();
          });
          await player.goto(cabinet);
          await expect.poll(() => phase(player, game.id)).toBe(game.id === 'dot-wave' ? 'intro' : 'ready');
          const playerBalance = await wallet(player);
          await player.locator('body').click({ position: { x: 2, y: 2 } });
          await player.keyboard.press(game.key);
          await player.getByRole('dialog', { name: 'ゲームを開始しますか？', exact: true })
            .getByRole('button', { name: '1クレジットで開始', exact: true }).click();
          await expect.poll(async () => ['playing', 'countdown', 'paused'].includes(await phase(player, game.id))).toBe(true);
          await expect.poll(() => wallet(player)).toBe(playerBalance - 1);
        }
        await page.goto(origin);
        const decline = page.getByRole('button', { name: '拒否する', exact: true });
        if (await decline.isVisible()) await decline.click();
        await page.evaluate(async () => {
          const api = await import('/src/features/platform/platform-client.ts');
          const account = await api.fetchPlatformBootstrap();
          if (!account.welcomeCreditGranted) await api.claimWelcomeCredit();
        });
        const balance = await wallet(page);
        const writes = [];
        page.on('request', request => { if (request.method() === 'POST' && request.url().includes('credit-reservations')) writes.push(request.url()); });
        await page.goto(`${cabinet}&watch=1&start=1`);
        const waiting = page.getByRole('region', { name: 'プレイの開始待ち・終了', exact: true });
        if (!occupied) {
          await expect(waiting).toBeVisible();
          await expect(page.locator('.spectator-offline')).toBeAttached();
        } else {
          await expect(waiting).toBeHidden();
          if (game.id === 'dot-wave') await expect(page.locator('.dot-cabinet-bar > span')).toContainText('観戦中');
          else await expect(page.locator('#spectator-banner')).toBeVisible();
        }
        const start = page.getByRole('button', { name: game.button, exact: true });
        const dialog = page.getByRole('dialog', { name: 'ゲームを開始しますか？' });
        await expect(start).toBeHidden();
        await expect(dialog).toBeHidden();
        await page.locator('body').click({ position: { x: 2, y: 2 } });
        await page.keyboard.press(game.key);
        await page.keyboard.down(game.key);
        await page.keyboard.down(game.key);
        await page.keyboard.up(game.key);
        await expect(start).toBeHidden();
        await expect(dialog).toBeHidden();
        expect(await wallet(page)).toBe(balance);
        expect(writes).toHaveLength(0);
        if (!occupied) await expect(waiting).toBeVisible();
      } finally {
        await playerContext?.close();
      }
    });
  }
}
