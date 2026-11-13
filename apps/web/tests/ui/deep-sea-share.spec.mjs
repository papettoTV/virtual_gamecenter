import { randomUUID } from 'node:crypto';
import { test, expect } from '../../../../ci/ui-fixtures.mjs';

// Both projects retain six independent layout/hit-target cases. Repeat the full
// interaction contract at the phone representative and both desktop breakpoints.
const interactionWidths = new Set([390, 1184, 1185]);

for (const width of [320, 390, 844, 1184, 1185, 1440]) {
  test(`deep sea: independent share and profile controls at ${width}px`, async ({ page, isMobile }, info) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/');
    const decline = page.getByRole('button', { name: '拒否する', exact: true });
    if (await decline.isVisible()) await decline.click();
    const reservations = [];
    page.on('request', request => {
      if (request.method() === 'POST' && request.url().includes('/api/platform/credit-reservations')) reservations.push(request.url());
    });
    await page.goto(`/cabinets/${randomUUID()}?game=deep-sea-salvage&start=1`);
    await expect.poll(() => page.evaluate(async () => {
      const context = (await import('/src/features/sharing/share-service.ts')).liveSharing.getSnapshot();
      return context && { role: context.role, phase: context.phase };
    })).toEqual({ role: 'player', phase: 'ready' });
    const share = page.locator('#game-screen .safe-live-share button');
    const profile = page.getByRole('button', { name: 'プロフィールを表示', exact: true });
    await expect(share).toBeVisible();
    await expect(profile).toBeVisible();
    const geometry = await share.evaluate(button => {
      const profile = document.querySelector('.platform-profile-button');
      const box = element => {
        const { x, y, right, bottom, width, height } = element.getBoundingClientRect();
        return { x, y, right, bottom, width, height };
      };
      const a = box(button), b = box(profile);
      return { share: a, profile: b, overlap: a.x < b.right && a.right > b.x && a.y < b.bottom && a.bottom > b.y,
        shareHit: document.elementFromPoint(a.x + a.width / 2, a.y + a.height / 2)?.closest('button') === button,
        profileHit: document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2)?.closest('button') === profile };
    });
    await info.attach('controls', { body: JSON.stringify(geometry, null, 2), contentType: 'application/json' });
    expect(geometry.overlap).toBe(false);
    expect(geometry.shareHit).toBe(true);
    expect(geometry.profileHit).toBe(true);
    if (interactionWidths.has(width)) {
      const activate = button => isMobile ? button.tap() : button.click();
      await activate(share);
      const dialog = page.getByRole('dialog', { name: '観戦リンクを共有', exact: true });
      await expect(dialog).toBeVisible();
      await expect(profile).toHaveAttribute('aria-expanded', 'false');
      await expect(dialog.locator('.social-link-card, textarea')).toHaveCount(0);
      for (const name of ['Xに投稿', 'Facebookに投稿', '投稿文とリンクをコピー']) await expect(dialog.getByRole('button', { name, exact: true })).toBeVisible();
      await dialog.getByRole('button', { name: '× 閉じる', exact: true }).click();
      await activate(profile);
      await expect(page.getByRole('region', { name: 'プレイヤー情報', exact: true })).toBeVisible();
      await expect(dialog).toBeHidden();
      await activate(profile);
      await expect(page.getByRole('region', { name: 'プレイヤー情報', exact: true })).toBeHidden();
      await share.focus();
      await page.keyboard.press('Enter');
      await expect(dialog).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
    }
    await expect(page.getByRole('dialog', { name: 'ゲームを開始しますか？', exact: true })).toBeHidden();
    expect(reservations).toEqual([]);
  });
}
