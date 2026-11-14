import { randomUUID } from 'node:crypto';
import { test, expect } from '../../../../ci/ui-fixtures.mjs';
import { finishReadBudget, readBudgetTimeout, respectReadBudget } from './api-read-budget.mjs';
import { claimWelcomeAndRefresh } from './welcome-wallet.mjs';
import { installDotWaveFinishFixture } from './dot-wave-finish-fixture.mjs';

const games = [
  { id: 'buzz-barrier', start: 'ゲーム開始', pauseKey: 'Space', caption: '#buzz-paused-spectators', result: '#ranking-result' },
  { id: 'dot-wave', start: 'START / ゲーム開始', pauseKey: 'KeyP', caption: '.duel-choice-panel .spectator-presence-caption', result: '.dot-result-card' },
  { id: 'deep-sea-salvage', start: '潜航開始', pauseKey: 'KeyP', caption: '#salvage-paused-spectators', result: '#ranking-result', params: '&powerDrain=7' },
];

for (const game of games) {
  test(`${game.id}: glow, pause count and frozen result peak`, async ({ page, context, isMobile }, info) => {
    info.setTimeout(info.timeout + readBudgetTimeout);
    await respectReadBudget(context, info);
    try {
      await page.emulateMedia({ reducedMotion: isMobile ? 'reduce' : 'no-preference' });
      let latestState;
      let cabinetSocket;
      let count = 0;
      const pushCount = value => {
        count = value;
        cabinetSocket.send(JSON.stringify({ ...latestState, state: { ...latestState.state, spectatorCount: count } }));
      };
      await page.routeWebSocket('**/api/cabinets/**', socket => {
        const server = socket.connectToServer();
        server.onMessage(raw => {
          const message = JSON.parse(raw);
          if (message.type === 'cabinetState') {
            cabinetSocket = socket;
            latestState = message;
            pushCount(count);
          } else socket.send(raw);
        });
      });
      const bootstrap = page.waitForResponse(response => new URL(response.url()).pathname === '/api/platform/bootstrap' && response.request().method() === 'GET', { timeout: readBudgetTimeout });
      await page.goto('/');
      const account = await (await bootstrap).json();
      const decline = page.getByRole('button', { name: '拒否する', exact: true });
      if (await decline.isVisible()) await decline.click();
      if (!account.welcomeCreditGranted) await claimWelcomeAndRefresh(page);
      if (game.id === 'dot-wave') await installDotWaveFinishFixture(page);
      await page.goto(`/cabinets/${randomUUID()}?game=${game.id}${game.params ?? ''}`);
      await expect.poll(() => Boolean(latestState), { timeout: readBudgetTimeout }).toBe(true);
      const edge = page.locator('.spectator-presence-edge');
      const caption = page.locator(game.caption);
      pushCount(1);
      await expect(edge).toHaveAttribute('data-presence', 'none');
      const debug = page.locator('#debug-ranking-preview-toggle');
      if (game.id === 'buzz-barrier') await page.locator('summary').filter({ hasText: 'デバッグ設定' }).click();
      if (game.id === 'buzz-barrier' && !isMobile) await page.keyboard.press('Space');
      else await page.getByRole('button', { name: game.start, exact: true }).click();
      await page.getByRole('button', { name: '1クレジットで開始', exact: true }).click();
      await expect(edge).toHaveAttribute('data-presence', 'watching', { timeout: 12000 });
      await expect(edge).toHaveCSS('pointer-events', 'none');
      await expect(edge).toHaveCSS('border-top-width', '0px');
      const glowStyle = property => edge.evaluate((element, name) => getComputedStyle(element, '::before').getPropertyValue(name), property);
      expect(await glowStyle('background-image')).toContain('radial-gradient');
      expect(await glowStyle('animation-name')).toBe('none');
      await expect(caption).toBeHidden();
      pushCount(3);
      await expect(edge).toHaveAttribute('data-pulse', '');
      expect(await glowStyle('animation-name')).toBe(isMobile ? 'none' : 'spectator-presence-pulse');
      expect(await glowStyle('border-top-width')).toBe('0px');
      await expect(edge).not.toHaveAttribute('data-pulse', '');
      const togglePause = async () => {
        if (game.id === 'dot-wave') await page.locator('.duel-pause-toggle').click();
        else if (isMobile) await page.locator('#touch-pause').tap();
        else {
          await page.evaluate(() => document.activeElement?.blur());
          await page.keyboard.press(game.pauseKey);
        }
      };
      await togglePause();
      await expect(caption).toBeVisible();
      await expect(caption).toHaveText('現在 3人が観戦中');
      pushCount(8);
      await expect(caption).toHaveText('現在 8人が観戦中');
      pushCount(2);
      await expect(caption).toHaveText('現在 2人が観戦中');
      await togglePause();
      await expect(caption).toBeHidden();
      pushCount(4);
      await expect(edge).toHaveAttribute('data-presence', 'crowd');
      await expect(edge).not.toHaveAttribute('data-pulse', '');
      if (game.id === 'dot-wave') await page.evaluate(() => window.dispatchEvent(new Event('dot-wave-layout-finish')));
      if (game.id === 'buzz-barrier') await debug.evaluate(checkbox => {
        checkbox.checked = true;
        checkbox.dispatchEvent(new Event('change', { bubbles: true }));
      });
      const result = page.locator(game.result);
      await expect(result).toContainText('最大同時観戦', { timeout: 20000 });
      await expect(result).toContainText('8人');
      await expect(edge).toHaveAttribute('data-presence', 'none');
      if (game.id !== 'graze-duel') {
        const peak = result.locator('.spectator-result-caption');
        await expect(result.locator('.result-metrics')).not.toContainText('最大同時観戦');
        await expect(peak).toHaveText('最大同時観戦 8人');
        await expect(peak).toHaveCSS('font-size', '12px');
        await expect(peak).toHaveCSS('text-align', 'center');
        const metrics = await result.locator('.result-metrics').boundingBox();
        expect((await peak.boundingBox()).y).toBeGreaterThanOrEqual(metrics.y + metrics.height);
      }
      pushCount(12);
      await expect(result).toContainText('8人');
      await expect(result).not.toContainText('12人');
    } finally {
      await finishReadBudget(context);
    }
  });
}
