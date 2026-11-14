import { randomUUID } from 'node:crypto';
import { test, expect } from '../../../../ci/ui-fixtures.mjs';
import { finishReadBudget, readBudgetTimeout, respectReadBudget } from './api-read-budget.mjs';
import { claimWelcomeAndRefresh } from './welcome-wallet.mjs';

test('BUZZ player sees edge only during play, current viewers on pause and a frozen peak at result', async ({ page, context, isMobile }, info) => {
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
    await page.goto(`/cabinets/${randomUUID()}?game=buzz-barrier`);
    await expect.poll(() => Boolean(latestState), { timeout: readBudgetTimeout }).toBe(true);
    const edge = page.locator('.buzz-spectator-edge');
    const caption = page.locator('#buzz-paused-spectators');
    pushCount(1);
    await expect(edge).toHaveAttribute('data-presence', 'none');
    const debug = page.locator('#debug-ranking-preview-toggle');
    await page.locator('summary').filter({ hasText: 'デバッグ設定' }).click();
    if (isMobile) await page.getByRole('button', { name: 'ゲーム開始', exact: true }).tap();
    else await page.keyboard.press('Space');
    await page.getByRole('button', { name: '1クレジットで開始', exact: true }).click();
    await expect(edge).toHaveAttribute('data-presence', 'watching');
    await expect(edge).toHaveCSS('pointer-events', 'none');
    await expect(edge).toHaveCSS('border-top-width', '0px');
    const glowStyle = property => edge.evaluate((element, name) => getComputedStyle(element, '::before').getPropertyValue(name), property);
    expect(await glowStyle('background-image')).toContain('radial-gradient');
    expect(await glowStyle('animation-name')).toBe('none');
    await expect(caption).toBeHidden();
    pushCount(3);
    await expect(edge).toHaveAttribute('data-pulse', '');
    expect(await glowStyle('animation-name')).toBe(isMobile ? 'none' : 'buzz-spectator-pulse');
    expect(await glowStyle('border-top-width')).toBe('0px');
    await expect(edge).not.toHaveAttribute('data-pulse', '');
    const togglePause = async () => {
      if (isMobile) await page.locator('#touch-pause').tap();
      else {
        await page.evaluate(() => document.activeElement?.blur());
        await page.keyboard.press('Space');
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
    await debug.evaluate(checkbox => {
      checkbox.checked = true;
      checkbox.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const result = page.locator('#ranking-result');
    await expect(result).toContainText('最大同時観戦');
    await expect(result).toContainText('8人');
    await expect(edge).toHaveAttribute('data-presence', 'none');
    pushCount(12);
    await expect(result).toContainText('8人');
    await expect(result).not.toContainText('12人');
  } finally {
    await finishReadBudget(context);
  }
});
