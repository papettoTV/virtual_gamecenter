import { randomUUID } from 'node:crypto';
import { test, expect } from '../../../../ci/ui-fixtures.mjs';

for (const game of ['graze-duel', 'deep-sea-salvage', 'dot-wave']) {
  for (const delay of [0, 1200, 6000]) {
    test(`${game}: new guest waits for real bootstrap (${delay}ms) and retains cabinet`, async ({ page }) => {
      let initialized = false;
      let bootstraps = 0;
      const earlySockets = [];
      const sockets = [];
      const playerAdmissions = [];
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
          if (message.type === 'joinedCabinet' && message.role === 'player') playerAdmissions.push(socket.url());
        });
      });
      const url = `http://127.0.0.1:5174/cabinets/${randomUUID()}?game=${game}`;
      await page.goto(url);
      // Intro / liveSharing.ready can appear before guest setup or admission.
      // Use one acceptance deadline for real server admission AND the ready UI,
      // including the deliberate six-second bootstrap delay. Do not start a
      // separate default five-second UI wait while initialization is pending.
      await expect.poll(async () => {
        if (playerAdmissions.length === 0) return false;
        const phase = await page.evaluate(async gameId => gameId === 'dot-wave'
          ? document.querySelector('main.dot-wave[data-phase]')?.dataset.phase
          : (await import('/src/features/sharing/share-service.ts')).liveSharing.getSnapshot()?.phase, game);
        const readyUi = game === 'dot-wave'
          ? (await page.locator('.dot-cabinet-bar > span').textContent())?.includes('あなたの筐体')
          : await page.locator('#game-screen').isVisible();
        return phase === (game === 'dot-wave' ? 'intro' : 'ready') && readyUi;
      }, { timeout: 10000, message: 'real player admission and ready UI after guest bootstrap' }).toBe(true);
      expect(initialized).toBe(true);
      expect(bootstraps).toBe(1);
      expect(earlySockets).toEqual([]);
      expect(admissionErrors).toEqual([]);
      expect(sockets).toHaveLength(1);
      expect(playerAdmissions).toEqual(sockets);
      await expect(page).toHaveURL(url);
      expect(accounting).toEqual([]);
      await expect(page.getByRole('dialog', { name: 'ゲームを開始しますか？' })).toBeHidden();
    });
  }
}
