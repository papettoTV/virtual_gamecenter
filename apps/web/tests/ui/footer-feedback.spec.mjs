import { randomUUID } from 'node:crypto';
import { test, expect } from '../../../../ci/ui-fixtures.mjs';
import { claimWelcomeAndRefresh } from './welcome-wallet.mjs';
import { respectReadBudget, finishReadBudget, readBudgetTimeout } from './api-read-budget.mjs';

const panel = page => page.getByRole('region', { name: 'アクセス解析の設定' });
const feedback = page => page.getByRole('dialog', { name: 'ご意見・感想を送る', exact: true });

async function settings(page) {
  const footer = page.locator('.platform-footer');
  await expect(footer.getByRole('button', { name: 'アクセス解析設定', exact: true })).toHaveCount(0);
  await expect(footer.getByRole('link', { name: 'ライセンス', exact: true })).toHaveAttribute('href', '/third-party-notices.html');
  await footer.getByRole('button', { name: 'プライバシーポリシー', exact: true }).click();
  const dialog = page.getByRole('dialog').filter({ has: page.getByTitle('プライバシーポリシー全文') });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'アクセス解析設定', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(panel(page)).toBeVisible();
}

async function checkFeedback(page, button) {
  await button.click();
  await expect(feedback(page)).toBeVisible();
  await expect(feedback(page)).toContainText('あなたのご意見を改善に役立てます。');
  await feedback(page).getByRole('button', { name: 'フィードバックを閉じる', exact: true }).click();
  await expect(feedback(page)).toBeHidden();
}

test.beforeEach(async ({ context }, info) => {
  info.setTimeout(info.timeout + readBudgetTimeout);
  await respectReadBudget(context, info);
});
test.afterEach(async ({ context }) => { await finishReadBudget(context); });

for (const width of [1280, 390]) {
  test(`フッター設定変更後もプレイ・結果の案内・観戦を利用できる ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 844 });
    const loaded = page.waitForResponse(r => new URL(r.url()).pathname === '/api/platform/bootstrap' && r.request().method() === 'GET', { timeout: readBudgetTimeout });
    await page.goto('/');
    const response = await loaded;
    expect(response.ok()).toBe(true);
    const account = await response.json();
    await panel(page).getByRole('button', { name: '閉じる', exact: true }).click();
    for (const [button, choice] of [['同意する', '同意'], ['拒否する', '拒否']]) {
      await settings(page);
      await panel(page).getByRole('button', { name: button, exact: true }).click();
      await settings(page);
      await expect(panel(page)).toContainText(`現在：${choice}`);
      await panel(page).getByRole('button', { name: '閉じる', exact: true }).click();
    }
    await checkFeedback(page, page.locator('.platform-footer').getByRole('button', { name: 'ご意見・感想を送る', exact: true }));
    if (!account.welcomeCreditGranted) await claimWelcomeAndRefresh(page);
    const cabinet = `/cabinets/${randomUUID()}?game=deep-sea-salvage&power=1&powerDrain=100`;
    await page.goto(cabinet);
    const screen = page.locator('#game-screen');
    await screen.getByRole('button', { name: '潜航開始', exact: true }).click();
    const start = page.getByRole('dialog', { name: 'ゲームを開始しますか？', exact: true });
    await expect(start).toBeVisible();
    const capture = page.waitForResponse(r => r.request().method() === 'POST' && /\/credit-reservations\/[^/]+\/capture$/.test(new URL(r.url()).pathname));
    await start.getByRole('button', { name: '1クレジットで開始', exact: true }).click();
    expect((await (await capture).json()).status).toBe('captured');
    await expect(start).toBeHidden();
    if (await screen.locator('#touch-pause').isVisible()) await screen.locator('#touch-pause').click();
    else await page.keyboard.press('p');
    const result = page.locator('#ranking-submit-panel');
    await expect(result).toBeVisible({ timeout: 15000 });
    await checkFeedback(page, result.getByRole('button', { name: 'ご意見・感想を送る', exact: true }));
    await expect(result).toBeVisible();
    await info.attach('結果のフィードバック導線', { body: await page.screenshot(), contentType: 'image/png' });
    const reservations = [];
    page.on('request', r => {
      if (r.method() === 'POST' && new URL(r.url()).pathname.includes('/credit-reservations')) reservations.push(r.url());
    });
    await page.goto(`${cabinet}&watch=1`);
    await expect(page.getByRole('region', { name: 'プレイの開始待ち・終了', exact: true })).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'ゲームを開始しますか？', exact: true })).toBeHidden();
    expect(reservations).toEqual([]);
  });
}
