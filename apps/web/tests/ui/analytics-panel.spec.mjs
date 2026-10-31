import { test, expect } from '../../../../ci/ui-fixtures.mjs';

const panelFor = page => page.getByRole('region', { name: 'アクセス解析の設定' });

async function expectDocked(page) {
  const panel = panelFor(page);
  await expect(panel).toBeVisible();
  await expect(panel).toHaveCSS('position', 'fixed');
  await expect.poll(async () => {
    const box = await panel.boundingBox();
    return Math.abs(box.y + box.height - page.viewportSize().height);
  }).toBeLessThanOrEqual(1);
  const box = await panel.boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize().width);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 664 }, { width: 320, height: 568 }]) {
  test(`画面下部への固定と再表示 ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('/');
    await expectDocked(page);
    await expect(panelFor(page)).toContainText('Google Analyticsによるアクセス解析');
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollHeight - innerHeight)).toBeGreaterThan(0);
    for (const fraction of [0, 0.5, 1, 0]) {
      await page.evaluate(fraction => window.scrollTo(0, (document.documentElement.scrollHeight - innerHeight) * fraction), fraction);
      await expectDocked(page);
    }
    for (const name of ['拒否する', '同意する', '閉じる']) {
      await expect(panelFor(page).getByRole('button', { name, exact: true })).toBeInViewport();
    }
    await panelFor(page).getByRole('button', { name: '閉じる', exact: true }).click();
    await expect(panelFor(page)).toHaveCount(0);
    await page.getByRole('button', { name: 'アクセス解析設定', exact: true }).click();
    await expectDocked(page);
    await expect(panelFor(page)).toContainText('未選択');

    for (const [button, choice] of [['拒否する', '拒否'], ['同意する', '同意']]) {
      await panelFor(page).getByRole('button', { name: button, exact: true }).click();
      await expect(panelFor(page)).toHaveCount(0);
      await page.reload();
      await expect(page.getByRole('button', { name: 'アクセス解析設定', exact: true })).toBeVisible();
      await expect(panelFor(page)).toHaveCount(0);
      await page.getByRole('button', { name: 'アクセス解析設定', exact: true }).click();
      await expectDocked(page);
      await expect(panelFor(page)).toContainText(`現在：${choice}`);
      await expect(panelFor(page)).toContainText('開発・検証環境では同意しても解析は動作しません');
    }
  });
}

test('低いビューポートでも本文と全操作に到達できる', async ({ page }) => {
  await page.setViewportSize({ width: 568, height: 240 });
  await page.goto('/');
  await expectDocked(page);
  const panel = panelFor(page);
  await panel.evaluate(element => { element.scrollTop = 0; });
  await expect(panel.getByText('Google Analyticsによるアクセス解析', { exact: true })).toBeInViewport();
  for (const name of ['拒否する', '同意する', '閉じる']) {
    const button = panel.getByRole('button', { name, exact: true });
    await button.scrollIntoViewIfNeeded();
    await expect(button).toBeInViewport();
    await button.click({ trial: true });
  }
  await panel.getByRole('button', { name: '閉じる', exact: true }).click();
  await expect(panel).toHaveCount(0);
});
