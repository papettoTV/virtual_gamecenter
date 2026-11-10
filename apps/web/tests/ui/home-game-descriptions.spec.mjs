import { test, expect } from '../../../../ci/ui-fixtures.mjs';

for (const width of [320, 390]) {
  test(`トップページのゲーム説明がスマホ幅${width}pxで全文表示される`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/');
    const decline = page.getByRole('button', { name: '拒否する', exact: true });
    if (await decline.isVisible()) await decline.click();

    const descriptions = page.locator('.showcase-description > p');
    await expect(descriptions).toHaveText([
      '弾幕かすり・無敵体当たり・対戦型シューティング',
      'リズムで攻撃・リズムで防御、対戦リズムゲーム',
      '深海に潜む、謎の生物を分析・探索ソロゲーム',
    ]);
    for (const description of await descriptions.all()) {
      await description.scrollIntoViewIfNeeded();
      await expect(description).toBeInViewport({ ratio: 1 });
      const layout = await description.evaluate(element => {
        const range = document.createRange();
        range.selectNodeContents(element);
        const textRects = [...range.getClientRects()];
        const containers = [];
        for (let parent = element; parent; parent = parent.parentElement) {
          const style = getComputedStyle(parent);
          if (/(hidden|clip|auto|scroll)/.test(`${style.overflowX} ${style.overflowY}`)) {
            containers.push(parent.getBoundingClientRect());
          }
        }
        return {
          hasText: textRects.length > 0,
          fullyVisible: textRects.every(rect => rect.left >= 0 && rect.right <= innerWidth
            && rect.top >= 0 && rect.bottom <= innerHeight
            && containers.every(box => rect.left >= box.left - 1 && rect.right <= box.right + 1
              && rect.top >= box.top - 1 && rect.bottom <= box.bottom + 1)),
          noOverflow: element.scrollHeight <= element.clientHeight + 1
            && element.scrollWidth <= element.clientWidth + 1,
        };
      });
      expect(layout).toEqual({ hasText: true, fullyVisible: true, noOverflow: true });
      await info.attach(`description-${await description.count()}-${await description.textContent()}`, {
        body: await page.screenshot(), contentType: 'image/png',
      });
    }
  });
}
