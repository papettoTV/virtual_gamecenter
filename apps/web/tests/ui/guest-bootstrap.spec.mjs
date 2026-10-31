import { randomUUID } from 'node:crypto';
import { test, expect } from '../../../../ci/ui-fixtures.mjs';

for (const game of ['graze-duel', 'deep-sea-salvage', 'dot-wave']) {
  for (const delay of [0, 1200, 6000]) {
    test(`${game}: new guest waits for real bootstrap (${delay}ms) and retains cabinet`, async ({ page }) => {
      let initialized = false;
      let bootstraps = 0;
      const earlySockets = [];
      const sockets = [];
      const admissionErrors = [];
      const accounting = [];
      // Delay only the request. The real local Worker creates the guest and
      // authenticates admission; no successful API response is substituted.
      await page.route('**/api/platform/bootstrap', async route => {
        bootstraps++;
        if (delay) await new Promise(resolve => setTimeout(resolve, delay));
        await route.continue();
      });
      page.on('response', response => {
        if (response.url().endsWith('/api/platform/bootstrap') && response.ok()) initialized = true;
      });
      page.on('request', request => {
        if (request.method() === 'POST' && request.url().includes('/credit-reservations')) accounting.push(request.url());
      });
      page.on('websocket', socket => {
        if (!socket.url().includes('/api/cabinets/')) return;
        sockets.push(socket.url());
        if (!initialized) earlySockets.push(socket.url());
        socket.on('framereceived', ({ payload }) => {
          const message = JSON.parse(String(payload));
          if (message.type === 'error') admissionErrors.push(message.type);
        });
      });
      const url = `http://127.0.0.1:5174/cabinets/${randomUUID()}?game=${game}`;
      await page.goto(url);
      // Six seconds deliberately exceeds the former five-second admission
      // budget. This deadline includes guest setup as well as actual admission.
      await expect.poll(() => page.evaluate(async gameId => gameId === 'dot-wave'
        ? document.querySelector('main.dot-wave[data-phase]')?.dataset.phase
        : (await import('/src/features/sharing/share-service.ts')).liveSharing.getSnapshot()?.phase, game), { timeout: 10000 })
        .toBe(game === 'dot-wave' ? 'intro' : 'ready');
      if (game === 'dot-wave') await expect(page.locator('.dot-cabinet-bar > span')).toContainText('あなたの筐体');
      else await expect(page.locator('#game-screen')).toBeVisible();
      expect(initialized).toBe(true);
      expect(bootstraps).toBe(1);
      expect(earlySockets).toEqual([]);
      expect(admissionErrors).toEqual([]);
      expect(sockets).toHaveLength(1);
      await expect(page).toHaveURL(url);
      expect(accounting).toEqual([]);
      await expect(page.getByRole('dialog', { name: 'ゲームを開始しますか？' })).toBeHidden();
    });
  }
}
