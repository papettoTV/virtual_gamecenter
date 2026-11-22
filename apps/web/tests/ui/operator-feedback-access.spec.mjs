import { test, expect } from '../../../../ci/ui-fixtures.mjs';

test('未ログインではフィードバック一覧をHTMLでもJSONでも閲覧できない', async ({ page }) => {
  const response = await page.goto('/operator/feedback');
  expect(response.status()).toBe(401);
  // Vite may normalize Cache-Control; storage must still be forbidden.
  expect(response.headers()['cache-control'].split(',').map(value => value.trim())).toContain('no-store');
  expect(response.headers()['x-robots-tag']).toContain('noindex');
  await expect(page.locator('body')).toContainText('開発者ユーザーでログインしてください。');
  await expect(page.locator('table')).toHaveCount(0);
  await expect(page.locator('a[href="/operator/operations"]')).toHaveCount(0);
  const json = await page.request.get('/api/operator/feedback');
  expect(json.status()).toBe(401);
  expect(json.headers()['cache-control'].split(',').map(value => value.trim())).toContain('no-store');
  expect(json.headers()['x-robots-tag']).toContain('noindex');
  expect(await json.json()).toEqual({ error: '開発者ユーザーでログインしてください。' });
});
