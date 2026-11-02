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
    test(`${game} ${kind} panel artwork and links`, async ({ page, baseURL }) => {
      // Use the project's real desktop/mobile viewport, without booting App.
      const origin = new URL(baseURL);
      expect(['127.0.0.1', '[::1]']).toContain(origin.hostname);
      expect(origin.protocol).toBe('http:');
      expect(origin.port).toBe('5174');
      const fixtureUrl = new URL('/__social-image-fixture', origin).href;
      await page.route(fixtureUrl, route => route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Sharing component fixture</title></head><body><div id="social-image-fixture"></div></body></html>',
      }));
      // Keep local LAN discovery inside the disposable test server.
      await page.route('**/api/local-address', route => route.fulfill({ json: { address: '127.0.0.1', port: 5174 } }));
      await page.goto(fixtureUrl);
      await page.evaluate(async ({ game, kind }) => {
        // Supply Vite's normal React refresh preamble for this minimal HTML.
        const { default: refresh } = await import('/@react-refresh');
        refresh.injectIntoGlobalHook(window);
        window.$RefreshReg$ = () => {};
        window.$RefreshSig$ = () => type => type;
        window.__vite_plugin_react_preamble_installed__ = true;
        await import('/styles.css');
        const { default: React } = await import('/node_modules/.vite/deps/react.js');
        const { default: ReactDOMClient } = await import('/node_modules/.vite/deps/react-dom_client.js');
        const { createResultImage, ResultShareButton, LiveShareButton, SharePanel } = await import('/src/features/sharing/ShareActions.tsx');
        const { setLiveContext } = await import('/src/features/sharing/share-service.ts');
        const host = document.getElementById('social-image-fixture');
        const result = { id: '12345678-1234-4234-8234-123456789012', gameId: game, gameVersion: 'test', playerName: 'Preview-test', score: 1200, elapsedTimeMs: 1000, cleared: false, metrics: {}, createdAt: '2026-01-01T00:00:00Z' };
        if (kind === 'result') {
          // Run the real renderer outside SharePanel's swallowed catch so
          // Canvas/import/encoding failures report their actual browser error.
          const file = await createResultImage(result);
          const bitmap = await createImageBitmap(file);
          const generated = { type: file.type, size: file.size, width: bitmap.width, height: bitmap.height };
          bitmap.close();
          if (generated.type !== 'image/png' || generated.size === 0 || generated.width !== 1200 || generated.height !== 630) {
            throw new Error(`Unexpected result image: ${JSON.stringify(generated)}`);
          }
        }
        setLiveContext({ gameId: game, cabinetId: result.id, role: 'player', phase: 'ready' });
        // One real panel and store; no App, guest session or game initialization.
        ReactDOMClient.createRoot(host).render(React.createElement(React.Fragment, null,
          React.createElement(kind === 'result' ? ResultShareButton : LiveShareButton, kind === 'result' ? { draft: result, placement: 'result-page' } : {}),
          React.createElement(SharePanel)));
        window.__previewShareLinks = [];
        window.open = url => { window.__previewShareLinks.push(String(url)); return null; };
      }, { game, kind });
      const fixture = page.locator('#social-image-fixture');
      await fixture.getByRole('button', { name: kind === 'result' ? '結果を共有' : '観戦に招待', exact: true }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toHaveCount(1);
      await expect(fixture.getByRole('dialog')).toBeVisible();
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
      if (kind === 'result') {
        const save = dialog.getByRole('button', { name: '結果画像を保存', exact: true });
        await expect(save).toBeVisible();
        const downloading = page.waitForEvent('download');
        await save.click();
        const download = await downloading;
        expect(download.suggestedFilename()).toBe(`${game}-result.png`);
        expect(await download.failure()).toBeNull();
        const stream = await download.createReadStream();
        const chunks = [];
        for await (const chunk of stream) chunks.push(chunk);
        const png = Buffer.concat(chunks);
        expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
        expect(png.subarray(12, 16).toString()).toBe('IHDR');
        expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1200, 630]);
      }
      await dialog.getByRole('button', { name: '× 閉じる' }).click();
      await expect(dialog).toHaveCount(0);
    });
  }
}
