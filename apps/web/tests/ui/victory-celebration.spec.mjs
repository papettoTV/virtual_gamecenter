import { randomUUID } from 'node:crypto';
import { test, expect } from '../../../../ci/ui-fixtures.mjs';
import { respectReadBudget, finishReadBudget, readBudgetTimeout } from './api-read-budget.mjs';

for (const game of ['buzz-barrier', 'dot-wave']) {
  test(`${game}: only confirmed winners celebrate, respecting sound and motion preferences`, async ({ page, context }, info) => {
    info.setTimeout(info.timeout + readBudgetTimeout);
    await respectReadBudget(context, info);
    try {
      await page.emulateMedia({ reducedMotion: info.project.name === 'mobile' ? 'reduce' : 'no-preference' });
      await page.addInitScript(() => {
        window.cheerStarts = 0;
        const start = AudioBufferSourceNode.prototype.start;
        AudioBufferSourceNode.prototype.start = function (...args) {
          if (Math.abs((this.buffer?.duration ?? 0) - .83) < .001) window.cheerStarts++;
          return start.apply(this, args);
        };
      });
      let socket;
      await page.routeWebSocket('**/api/cabinets/**', route => {
        route.onMessage(raw => {
          if (JSON.parse(raw).type !== 'joinCabinet') return;
          socket = route;
          route.send(JSON.stringify({ type: 'joinedCabinet', role: 'player' }));
        });
      });
      await page.goto(`/cabinets/${randomUUID()}?game=${game}`);
      await expect.poll(() => Boolean(socket), { timeout: readBudgetTimeout }).toBe(true);
      const send = message => socket.send(JSON.stringify(message));
      const effect = page.locator('.victory-celebration');
      const buzz = game === 'buzz-barrier';
      const match = async (matchId, seat, winner, muted) => {
        send({ type: 'challengeAccepted', matchId, seat });
        if (buzz) {
          await expect(page.locator('#versus-title')).toHaveText('Ready?');
          await page.locator('#versus-primary').click();
          const toggle = page.getByRole('button', { name: 'ミュート', exact: true });
          if ((await toggle.getAttribute('aria-pressed')) !== String(muted)) await toggle.click();
        } else {
          await expect(page.locator('.duel-mode-info')).toContainText('通信対戦');
          const button = page.locator('.duel-sound-toggle');
          await expect(button).toBeVisible();
          if (matchId === 'loss') {
            await button.click();
            await expect(button).toHaveAttribute('aria-pressed', 'true');
          }
          if ((await button.getAttribute('aria-pressed')) !== String(!muted)) await button.click();
          await expect(button).toHaveAttribute('aria-pressed', String(!muted));
        }
        const result = { type: 'versusResult', matchId, winner, reason: 'finished', host: null, challenger: null };
        send(result);
        if (winner === seat) {
          await expect(effect).toContainText(buzz ? 'VICTORY' : 'WIN');
          await expect(effect).toHaveCSS('pointer-events', 'none');
          const piece = effect.locator('span').first();
          await expect(piece).toHaveCSS('animation-name', info.project.name === 'mobile' ? 'none' : 'victory-confetti');
          send(result);
          await expect(effect).toHaveCount(0, { timeout: 3000 });
          await expect.poll(() => page.evaluate(() => window.cheerStarts)).toBe(muted ? 0 : 1);
        } else {
          if (buzz) await expect(page.locator('#versus-title')).toHaveText(winner === 'draw' ? 'DRAW' : 'LOSER');
          else await expect(page.locator('.duel-mode-info')).toContainText('通信対戦');
          await expect(effect).toHaveCount(0);
          await expect.poll(() => page.evaluate(() => window.cheerStarts)).toBe(0);
        }
        send({ type: 'versusEnded', matchId, nextRole: buzz ? 'player' : 'spectator', reason: 'finished' });
        if (!buzz) await expect(page.locator('.duel-mode-info')).toContainText('CPU対戦');
      };
      await match('loss', 'host', 'challenger', true);
      await match('draw', 'host', 'draw', true);
      await match('muted-win', 'challenger', 'challenger', true);
      await match('audible-win', 'host', 'host', false);
      send({ type: 'roleChanged', role: 'spectator' });
      send({ type: 'versusResult', matchId: 'spectator', winner: 'host', reason: 'finished', host: null, challenger: null });
      await expect(effect).toHaveCount(0);
    } finally {
      await finishReadBudget(context);
    }
  });
}
