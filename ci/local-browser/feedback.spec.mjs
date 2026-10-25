import { test, expect } from '@playwright/test';

const base = 'http://127.0.0.1:5174';
const modal = page => page.getByRole('dialog', { name: '感想・不具合を送る', exact: true });
async function open(page) {
  await page.goto('/');
  await page.getByRole('button', { name: '拒否する', exact: true }).click();
  await page.getByRole('button', { name: '感想・不具合を送る', exact: true }).click();
}
async function candidate(page, history = {}) {
  await page.addInitScript(({ history }) => {
    sessionStorage.setItem('pulbase.feedback-return.v1', JSON.stringify({ gameId: 'graze-duel', activity: 'player', at: Date.now() }));
    localStorage.setItem('pulbase.feedback.v1', JSON.stringify(history));
  }, { history });
}

test.beforeEach(async ({ page }) => {
  await page.route('**/api/feedback', route => {
    if (new URL(route.request().url()).origin !== base) throw Error('Local-only feedback test');
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{"accepted":true}' });
  });
});

test('manual feedback closes with Escape, outside click and close button without losing draft', async ({ page }) => {
  await open(page);
  await modal(page).getByLabel('内容', { exact: true }).fill('テスト用の感想');
  await modal(page).getByLabel('内容', { exact: true }).press('Escape');
  await expect(modal(page)).not.toBeVisible();
  await page.getByRole('button', { name: '感想・不具合を送る', exact: true }).click();
  await expect(modal(page).getByLabel('内容', { exact: true })).toHaveValue('テスト用の感想');
  await page.mouse.click(1, 1);
  await expect(modal(page)).not.toBeVisible();
  await page.getByRole('button', { name: '感想・不具合を送る', exact: true }).click();
  await modal(page).getByRole('button', { name: 'フィードバックを閉じる' }).click();
  await expect(modal(page)).not.toBeVisible();
});

test('failed sends preserve content; retry reuses its id and success clears the form', async ({ page }) => {
  const submissions = [];
  await page.route('**/api/feedback', route => {
    submissions.push(route.request().postDataJSON());
    return route.fulfill({ status: submissions.length === 1 ? 503 : 200, contentType: 'application/json', body: '{}' });
  });
  await open(page);
  await modal(page).getByRole('radio', { name: '不具合', exact: true }).check();
  await modal(page).getByLabel('内容', { exact: true }).fill('ローカル検証用の不具合報告');
  await modal(page).getByRole('button', { name: '送る', exact: true }).click();
  await expect(modal(page).getByRole('alert')).toContainText('内容は残っています');
  await expect(modal(page).getByLabel('内容', { exact: true })).toHaveValue('ローカル検証用の不具合報告');
  await modal(page).getByRole('button', { name: '送る', exact: true }).click();
  await expect(modal(page)).not.toBeVisible();
  expect(submissions).toHaveLength(2);
  expect(submissions[0].id).toBe(submissions[1].id);
  await expect(page.getByRole('status')).toContainText('ありがとうございました');
  await page.getByRole('button', { name: '感想・不具合を送る', exact: true }).click();
  await expect(modal(page).getByLabel('内容', { exact: true })).toHaveValue('');
});

test('automatic invitation waits for other dialogs to close and does not repeat', async ({ page }) => {
  await candidate(page);
  await page.goto('/');
  await page.getByRole('button', { name: '拒否する', exact: true }).click();
  await page.getByRole('button', { name: '利用規約', exact: true }).click();
  await page.waitForTimeout(1200);
  await expect(modal(page)).not.toBeVisible();
  await page.getByRole('button', { name: '閉じる', exact: true }).click();
  await expect(modal(page)).toBeVisible();
  await expect(modal(page)).toContainText('BUZZ BARRIER');
  await modal(page).getByRole('button', { name: 'フィードバックを閉じる' }).click();
  await page.waitForTimeout(1200);
  await expect(modal(page)).not.toBeVisible();
});

test('recent submission suppresses the automatic invitation, but manual entry remains available', async ({ page }) => {
  await candidate(page, { submittedAt: Date.now() });
  await page.goto('/');
  await page.getByRole('button', { name: '拒否する', exact: true }).click();
  await page.waitForTimeout(1200);
  await expect(modal(page)).not.toBeVisible();
  await page.getByRole('button', { name: '感想・不具合を送る', exact: true }).click();
  await expect(modal(page)).toBeVisible();
});

test('opening manually cancels the invitation queued for the same return', async ({ page }) => {
  await candidate(page);
  await page.goto('/');
  await page.getByRole('button', { name: '拒否する', exact: true }).click();
  await page.getByRole('button', { name: '感想・不具合を送る', exact: true }).click();
  await modal(page).getByRole('button', { name: 'フィードバックを閉じる' }).click();
  await page.waitForTimeout(1200);
  await expect(modal(page)).not.toBeVisible();
});
