import { test, expect } from '../../../../ci/ui-fixtures.mjs';
import { respectReadBudget, finishReadBudget, readBudgetTimeout } from './api-read-budget.mjs';

test.beforeEach(async ({ context }, info) => {
  info.setTimeout(info.timeout + readBudgetTimeout);
  await respectReadBudget(context, info);
});
test.afterEach(async ({ context }) => finishReadBudget(context));

for (const leaveBeforeAdmission of [false, true]) {
  test(`BUZZ BARRIER: delayed real admission retains cabinet; leave first=${leaveBeforeAdmission}`, async ({ page, isMobile }, info) => {
    const connections = [];
    const sent = [];
    const writes = [];
    const buffered = [];
    let hold = true;
    // Keep the real local socket, guest authorization and Worker messages.
    // Release server frames only after the application's 5s admission timeout.
    await page.routeWebSocket('**/api/cabinets/**', socket => {
      connections.push(socket.url());
      const server = socket.connectToServer();
      socket.onMessage(raw => { sent.push(JSON.parse(String(raw))); server.send(raw); });
      server.onMessage(raw => {
        if (hold) buffered.push(() => socket.send(raw));
        else socket.send(raw);
      });
    });
    page.on('request', request => {
      if (request.method() === 'POST' && request.url().includes('/credit-reservations')) writes.push(request.url());
    });
    await page.goto('/');
    await page.getByRole('button', { name: '拒否する', exact: true }).click();
    await expect(page.locator('.platform-credit-badge')).toHaveText(/^\d+$/);
    const balance = await page.locator('.platform-credit-badge').textContent();
    await page.locator('[data-showcase-play="buzz-barrier"]').click();
    await expect(page).toHaveURL(/\/cabinets\//);
    const selected = new URL(page.url());
    selected.searchParams.delete('start');
    // This state proves the actual admission budget expired, without relaxing it.
    await expect(page.getByText('筐体への参加を待っています。時間をおいて再度開始してください。', { exact: true })).toBeVisible({ timeout: 10000 });
    expect(buffered.length).toBeGreaterThan(0);
    await expect(page.locator('#game-screen')).toBeVisible();
    await expect(page).toHaveURL(selected.href);
    const leave = () => page.locator(':is(button, a)[data-return-to-arcade]:visible').click();
    if (leaveBeforeAdmission) await leave();
    hold = false;
    buffered.splice(0).forEach(deliver => deliver());
    if (!leaveBeforeAdmission) {
      await expect.poll(() => page.evaluate(async () =>
        (await import('/src/features/sharing/share-service.ts')).liveSharing.getSnapshot()?.role)).toBe('player');
      const intent = async () => {
        if (isMobile) await page.getByRole('button', { name: 'ゲーム開始', exact: true }).tap();
        else await page.keyboard.press('Space');
      };
      const welcome = page.getByRole('dialog', { name: '無料5クレジット', exact: true });
      const gate = page.getByRole('dialog', { name: /クレジットが不足しています|ゲームを開始しますか/ });
      for (let attempt = 0; attempt < 2; attempt++) {
        await intent();
        await expect(welcome).toBeVisible();
        await welcome.getByRole('button', { name: '受け取らない', exact: true }).click();
        await expect(gate).toBeVisible();
        await info.attach(`delayed-admission-start-dialog-${attempt}`, { body: await page.screenshot(), contentType: 'image/png' });
        await page.keyboard.press('Space');
        await gate.locator('.platform-cancel-button').evaluate(button => { button.click(); button.click(); });
        await expect(gate).toBeHidden();
        await expect(page).toHaveURL(selected.href);
        await expect(page.locator('.platform-credit-badge')).toHaveText(balance);
        expect(writes).toEqual([]);
        expect(sent.some(message => message.type === 'startSolo')).toBe(false);
      }
      await leave();
    }
    await expect(page.getByRole('region', { name: 'ゲームを見て回る' })).toBeVisible();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator('#game-screen')).toHaveCount(0);
    expect(connections).toHaveLength(1);
    expect(writes).toEqual([]);
    expect(sent.some(message => message.type === 'startSolo')).toBe(false);
    // Read real persisted accounting once; cancellation must leave no reservation.
    const wallet = await page.evaluate(async () => {
      const response = await fetch('/api/platform/credits');
      if (!response.ok) throw new Error(`wallet: ${response.status}`);
      return (await response.json()).wallet;
    });
    expect(wallet.availableTotal).toBe(Number(balance));
    expect(wallet.reservedFree + wallet.reservedPurchased).toBe(0);
  });
}
