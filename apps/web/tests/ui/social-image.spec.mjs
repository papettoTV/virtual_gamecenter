import { createHash } from 'node:crypto';
import { test, expect } from '../../../../ci/ui-fixtures.mjs';

const artwork = [
  ['graze-duel', 'buzz-barrier', '78936b2ab3f306b4646e6ef72dc168bb5b7a79a3a3c1e42f7d82f5de6fe28dc8'],
  ['dot-wave', 'dot-wave', 'dd016c80592ca966d5bd47a8f3e6096314772e0d8526124fed2fe117b234c7b2'],
  ['deep-sea-salvage', 'deep-sea-salvage', '3041d2378eddda0aed1a8a9d2d1f3a8b06d6b9daf260f41b47d29cf61faf5251'],
];
for (const [game, filename, hash] of artwork) {
  test(`${game} serves approved artwork and live HTML`, async ({ page, request, baseURL }) => {
    const path = `/social/${filename}-ogp-v2.jpg`;
    const response = await request.get(path);
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toMatch(/^image\/jpeg(?:;|$)/);
    expect(createHash('sha256').update(await response.body()).digest('hex')).toBe(hash);
    const live = await request.get(`/cabinets/12345678-1234-4234-8234-123456789012?game=${game}&watch=1`);
    expect(live.status()).toBe(200);
    const html = await live.text();
    const absolute = new URL(path, baseURL).href;
    expect(html).toContain(`<meta property="og:image" content="${absolute}">`);
    expect(html).toContain(`<meta name="twitter:image" content="${absolute}">`);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(path);
    const size = await page.locator('img').evaluate(img => ({ width: img.naturalWidth, height: img.naturalHeight, complete: img.complete }));
    expect(size).toEqual({ width: 1200, height: 630, complete: true });
  });
}

// Exercise the real sharing store and panel with synthetic published results,
// without replacing authentication, accounting or game-start APIs.
for (const [game, filename] of artwork) {
  for (const kind of ['live', 'result']) {
    test(`${game} ${kind} mobile panel artwork and links`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      // Keep local LAN discovery inside the disposable test server.
      await page.route('**/api/local-address', route => route.fulfill({ json: { address: '127.0.0.1', port: 5174 } }));
      await page.goto('/');
      await page.evaluate(async ({ game, kind }) => {
        const { default: React } = await import('/node_modules/.vite/deps/react.js');
        const { default: ReactDOMClient } = await import('/node_modules/.vite/deps/react-dom_client.js');
        const { SharePanel, ResultShareButton, LiveShareButton } = await import('/src/features/sharing/ShareActions.tsx');
        const { setLiveContext } = await import('/src/features/sharing/share-service.ts');
        const host = document.createElement('div');
        host.id = 'social-image-fixture'; document.body.append(host);
        const result = { id: '12345678-1234-4234-8234-123456789012', gameId: game, gameVersion: 'test', playerName: 'Preview-test', score: 1200, elapsedTimeMs: 1000, cleared: false, metrics: {}, createdAt: '2026-01-01T00:00:00Z' };
        setLiveContext({ gameId: game, cabinetId: result.id, role: 'player', phase: 'ready' });
        ReactDOMClient.createRoot(host).render(React.createElement(React.Fragment, null,
          React.createElement(kind === 'result' ? ResultShareButton : LiveShareButton, kind === 'result' ? { draft: result, placement: 'result-page' } : {}), React.createElement(SharePanel)));
        window.__previewShareLinks = [];
        window.open = url => { window.__previewShareLinks.push(String(url)); return null; };
      }, { game, kind });
      const fixture = page.locator('#social-image-fixture');
      await fixture.getByRole('button', { name: kind === 'result' ? '結果を共有' : '観戦に招待', exact: true }).click();
      const dialog = fixture.getByRole('dialog');
      await expect(dialog).toBeVisible();
      const link = dialog.locator('.share-url');
      await expect(link).toContainText('shareId=');
      const shareUrl = new URL(await link.innerText());
      expect(shareUrl.origin).toBe(new URL(page.url()).origin);
      expect(shareUrl.pathname).toBe(`/${kind === 'result' ? 'results' : 'cabinets'}/12345678-1234-4234-8234-123456789012`);
      expect(shareUrl.searchParams.get('ref')).toBe('share');
      if (kind === 'live') {
        expect(shareUrl.searchParams.get('game')).toBe(game);
        expect(shareUrl.searchParams.get('watch')).toBe('1');
      }
      const image = dialog.locator('.social-link-card img');
      for (const target of ['X', 'Facebook']) {
        await dialog.getByRole('button', { name: target, exact: true }).click();
        await expect(image).toHaveAttribute('src', new URL(`/social/${filename}-ogp-v2.jpg`, shareUrl).href);
        await image.scrollIntoViewIfNeeded();
        await expect(image).toBeInViewport();
        await expect.poll(() => image.evaluate(img => [img.complete, img.naturalWidth, img.naturalHeight])).toEqual([true, 1200, 630]);
        // Capture handoff without sending a real social post.
        await dialog.getByRole('button', { name: `${target}で共有`, exact: true }).click();
        const handoff = new URL(await page.evaluate(() => window.__previewShareLinks.at(-1)));
        expect(handoff.searchParams.get(target === 'X' ? 'url' : 'u')).toBe(shareUrl.href);
      }
      if (kind === 'result') await expect(dialog.getByRole('button', { name: '結果画像を保存', exact: true })).toBeVisible();
      await dialog.getByRole('button', { name: '× 閉じる' }).click();
      await expect(dialog).toHaveCount(0);
    });
  }
}
