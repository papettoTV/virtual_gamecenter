import { randomUUID } from 'node:crypto';
import { test, expect } from '../../../../ci/ui-fixtures.mjs';

for (const game of ['graze-duel', 'deep-sea-salvage', 'dot-wave']) {
  for (const delay of [0, 1200, 6000]) {
    test(`${game}: new guest waits for real bootstrap (${delay}ms) and retains cabinet`, async ({ page }, testInfo) => {
      let initialized = false;
      let bootstrapAt;
      let admittedAt;
      const startedAt = Date.now();
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
        if (response.url().endsWith('/api/platform/bootstrap') && response.ok()) {
          initialized = true;
          bootstrapAt = Date.now();
        }
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
          if (message.type === 'joinedCabinet' && message.role === 'player') {
            admittedAt = Date.now();
            playerAdmissions.push(socket.url());
          }
        });
      });
      const url = `http://127.0.0.1:5174/cabinets/${randomUUID()}?game=${game}`;
      const bootstrap = page.waitForResponse(response =>
        response.url().endsWith('/api/platform/bootstrap'), { timeout: delay + 5000 });
      await page.goto(url);
      expect((await bootstrap).ok()).toBe(true);
      // The deliberate request delay is outside the existing admission budget.
      // Measure actual server admission independently from rendering readiness.
      await expect.poll(() => playerAdmissions.length, {
        timeout: Math.max(1, bootstrapAt + 5000 - Date.now()),
        intervals: [50, 100],
        message: 'real player admission within 5s of bootstrap response',
      }).toBe(1);
      expect(admittedAt - bootstrapAt).toBeLessThanOrEqual(5000);
      testInfo.annotations.push({ type: 'guest-admission', description: JSON.stringify({
        delay, bootstrapMs: bootstrapAt - startedAt, admissionMs: admittedAt - bootstrapAt,
      }) });

      // Intro / liveSharing.ready alone cannot prove participation. Only start
      // checking the UI after the real joinedCabinet acknowledgement above.
      await expect.poll(async () => {
        const phase = await page.evaluate(async gameId => gameId === 'dot-wave'
          ? document.querySelector('main.dot-wave[data-phase]')?.dataset.phase
          : (await import('/src/features/sharing/share-service.ts')).liveSharing.getSnapshot()?.phase, game);
        const readyUi = game === 'dot-wave'
          ? (await page.locator('.dot-cabinet-bar > span').textContent())?.includes('あなたの筐体')
          : await page.locator('#game-screen').isVisible();
        return phase === (game === 'dot-wave' ? 'intro' : 'ready') && readyUi;
      }, { timeout: 5000, intervals: [50, 100], message: 'render readiness after real player admission' }).toBe(true);
      testInfo.annotations.push({ type: 'guest-ready', description: JSON.stringify({
        renderAfterAdmissionMs: Date.now() - admittedAt,
      }) });
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
