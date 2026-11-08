import { createHash } from 'node:crypto';
import { test, expect } from '../../../../ci/ui-fixtures.mjs';

// Unlike toBeInViewport, require the whole control inside its scroll clip
// and visual viewport, including when the keyboard pans the visible area.
async function expectFullyVisible(locator, container) {
  await expect(locator).toBeVisible();
  await expect.poll(() => locator.evaluate((element, selector) => {
    const rect = element.getBoundingClientRect();
    const viewport = window.visualViewport;
    const clip = element.closest(selector).getBoundingClientRect();
    const top = Math.max(viewport.offsetTop, clip.top);
    const bottom = Math.min(viewport.offsetTop + viewport.height, clip.bottom);
    const left = Math.max(viewport.offsetLeft, clip.left);
    const right = Math.min(viewport.offsetLeft + viewport.width, clip.right);
    return rect.width > 0 && rect.height > 0 && rect.top >= top - 1 && rect.bottom <= bottom + 1 && rect.left >= left - 1 && rect.right <= right + 1;
  }, container)).toBe(true);
}

async function checkResultLayout(page, dialog, testInfo, name, url) {
  const primary = dialog.getByRole('button', { name: '共有する', exact: true });
  const copy = dialog.getByRole('button', { name: 'リンクをコピー', exact: true });
  const controls = async () => {
    await expectFullyVisible(primary, '.share-footer');
    await expectFullyVisible(copy, '.share-footer');
    await primary.click({ trial: true });
  };
  const capture = async suffix => testInfo.attach(`${name}-${suffix}`, {
    body: await page.screenshot(), contentType: 'image/png',
  });
  await controls();
  await capture('open');
  const text = dialog.locator('#share-text');
  await text.scrollIntoViewIfNeeded();
  await expectFullyVisible(text, '.share-body');
  await text.fill(`到達性の確認: ${name}`);
  await expect(text).toHaveValue(`到達性の確認: ${name}`);
  await controls();
  await capture('editing');
  // Real clicks also catch intercepting overlays; no system clipboard needed.
  await copy.click();
  expect(await page.evaluate(() => window.__copied)).toBe(url);
  await expect(dialog.getByRole('status')).toHaveText('コピーしました。');
  const body = dialog.locator('.share-body');
  await body.evaluate(element => { element.scrollTop = element.scrollHeight; });
  await expect.poll(() => body.evaluate(element =>
    Math.abs(element.scrollHeight - element.clientHeight - element.scrollTop) <= 1)).toBe(true);
  await expectFullyVisible(body.locator(':scope > :last-child'), '.share-body');
  await controls();
  await capture('body-end');
}

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
    test(`${game} ${kind} panel preview, handoff and accessibility`, async ({ page, baseURL }, testInfo) => {
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
      const nativeHandoffs = [];
      page.on('request', request => {
        if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/platform/sharing/events') {
          const event = request.postDataJSON();
          if (event.eventType === 'share_native_handoff') nativeHandoffs.push(event);
        }
      });
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
        const result = { id: '12345678-1234-4234-8234-123456789012', gameId: game, gameVersion: 'test', playerName: 'Preview-test', score: 1200, elapsedTimeMs: 1000, cleared: false, metrics: game === 'dot-wave' ? { mode: 'cpu', turns: 10, remainingHp: 45 } : {}, createdAt: '2026-01-01T00:00:00Z' };
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
        setLiveContext({ gameId: game, cabinetId: result.id, role: 'player', phase: 'paused' });
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
      await expect(dialog.locator('#share-text')).toBeVisible();
      const shareUrl = new URL(await page.evaluate(async () => {
        const { sharePanel } = await import('/src/features/sharing/share-service.ts');
        return sharePanel.getSnapshot().url;
      }));
      if (kind === 'result') {
        await expect(dialog.locator('.shared-result-card')).toHaveCount(1);
        expect(await fixture.getByRole('button', { name: '結果を共有', exact: true }).evaluate(el => el.closest('[inert]') !== null)).toBe(true);
        await expect(dialog.locator('.share-result-preview')).toContainText('Preview-test');
        await expect(dialog.locator('.social-preview, .share-url')).toHaveCount(0);
        if (game === 'dot-wave') {
          await expect(dialog.locator('.shared-result-card')).toContainText('10');
          await expect(dialog.locator('.shared-result-card')).toContainText('45');
          await expect(dialog.locator('.shared-result-card')).not.toContainText('SCORE');
        }
        await page.evaluate(() => {
          Object.defineProperty(navigator, 'share', { configurable: true, value: undefined });
          Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { window.__copied = text; } } });
        });
        await checkResultLayout(page, dialog, testInfo, 'initial', shareUrl.href);
        for (const [name, size] of [
          ['narrow', { width: 320, height: 568 }],
          ['landscape', { width: 844, height: 390 }],
          ['layout-keyboard', { width: 390, height: 300 }],
        ]) {
          await page.setViewportSize(size);
          await checkResultLayout(page, dialog, testInfo, name, shareUrl.href);
        }
        await page.setViewportSize({ width: 390, height: 844 });
        await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
        await checkResultLayout(page, dialog, testInfo, 'large-text', shareUrl.href);
        await page.evaluate(() => { document.documentElement.style.fontSize = ''; });
        // Keyboard simulation with an unchanged layout viewport, separately
        // from setViewportSize above. Dispatch the real viewport events.
        const layoutHeight = await page.evaluate(() => innerHeight);
        await page.evaluate(() => {
          const viewport = window.visualViewport;
          window.__restoreShareViewport = () => {
            delete viewport.height;
            delete viewport.offsetTop;
            viewport.dispatchEvent(new Event('resize'));
            viewport.dispatchEvent(new Event('scroll'));
          };
          Object.defineProperty(viewport, 'height', { configurable: true, value: 360 });
          Object.defineProperty(viewport, 'offsetTop', { configurable: true, value: 0 });
          viewport.dispatchEvent(new Event('resize'));
        });
        expect(await page.evaluate(() => innerHeight)).toBe(layoutHeight);
        await checkResultLayout(page, dialog, testInfo, 'visual-keyboard', shareUrl.href);
        await page.evaluate(() => {
          Object.defineProperty(window.visualViewport, 'offsetTop', { configurable: true, value: 80 });
          window.visualViewport.dispatchEvent(new Event('scroll'));
        });
        expect(await page.evaluate(() => innerHeight)).toBe(layoutHeight);
        await checkResultLayout(page, dialog, testInfo, 'visual-keyboard-panned', shareUrl.href);
        await page.evaluate(() => {
          window.__restoreShareViewport();
          delete window.__restoreShareViewport;
        });
        await dialog.getByRole('button', { name: 'リンクをコピー', exact: true }).click();
        expect(await page.evaluate(() => window.__copied)).toBe(shareUrl.href);
        await expect(dialog.getByRole('status')).toHaveText('コピーしました。');
        await page.evaluate(() => {
          Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw new Error('Permission denied'); } } });
        });
        const copyLink = dialog.getByRole('button', { name: 'リンクをコピー', exact: true });
        await copyLink.click();
        await expect(dialog.getByRole('status')).toHaveText('コピーできませんでした。もう一度お試しください。');
        await expect(copyLink).toBeFocused();
        await page.evaluate(() => {
          Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
          document.addEventListener('copy', event => {
            const field = document.activeElement;
            window.__legacyCopy = {
              text: field.value.substring(field.selectionStart, field.selectionEnd),
              inDialog: Boolean(field.closest('[role="dialog"]')),
              inert: Boolean(field.closest('[inert]')),
            };
            // Intercept the real copy event so no system clipboard is needed.
            event.preventDefault();
          }, { once: true });
        });
        await copyLink.click();
        expect(await page.evaluate(() => window.__legacyCopy)).toEqual({ text: shareUrl.href, inDialog: true, inert: false });
        await expect(dialog.getByRole('status')).toHaveText('コピーしました。');
        await expect(copyLink).toBeFocused();
        await expect(dialog.locator('textarea')).toHaveCount(1);
        await dialog.locator('#share-text').fill('編集した投稿文');
        await dialog.getByRole('button', { name: '共有する', exact: true }).click();
        await expect(dialog.getByRole('status')).toContainText('共有先を選んでください');
        await page.setViewportSize({ width: 320, height: 568 });
        await checkResultLayout(page, dialog, testInfo, 'fallback-expanded', shareUrl.href);
        await dialog.locator('#share-text').fill('編集した投稿文');
        await page.setViewportSize({ width: 390, height: 844 });
      }
      expect(shareUrl.origin).toBe(new URL(page.url()).origin);
      expect(shareUrl.pathname).toBe(`/${kind === 'result' ? 'results' : 'cabinets'}/12345678-1234-4234-8234-123456789012`);
      expect(shareUrl.searchParams.get('ref')).toBe('share');
      expect(shareUrl.searchParams.get('shareId')).toMatch(/^[0-9a-f-]{36}$/);
      if (kind === 'live') {
        expect(shareUrl.searchParams.get('game')).toBe(game);
        expect(shareUrl.searchParams.get('watch')).toBe('1');
      }
      const image = dialog.locator('.social-link-card img');
      for (const target of ['X', 'Facebook']) {
        if (kind === 'live') {
          await dialog.getByRole('button', { name: target, exact: true }).click();
          await expect(image).toHaveAttribute('src', new URL(`/social/${filename}-ogp-v2.jpg`, shareUrl).href);
          await image.scrollIntoViewIfNeeded();
          await expect(image).toBeInViewport();
          await expect.poll(() => image.evaluate(img => [img.complete, img.naturalWidth, img.naturalHeight])).toEqual([true, 1200, 630]);
        }
        // Capture handoff without sending a real social post.
        await dialog.getByRole('button', { name: `${target}で共有`, exact: true }).click();
        const handoff = new URL(await page.evaluate(() => window.__previewShareLinks.at(-1)));
        expect(handoff.searchParams.get(target === 'X' ? 'url' : 'u')).toBe(shareUrl.href);
        if (kind === 'result' && target === 'X') expect(handoff.searchParams.get('text')).toBe('編集した投稿文');
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
      if (kind === 'result') {
        await page.evaluate(() => {
          window.__nativeCalls = [];
          Object.defineProperty(navigator, 'share', { configurable: true, value: data => {
            window.__nativeCalls.push(data);
            return new Promise((resolve, reject) => { window.__finishShare = { resolve, reject }; });
          } });
        });
        const primary = dialog.getByRole('button', { name: '共有する', exact: true });
        await primary.click(); await primary.click();
        expect(await page.evaluate(() => window.__nativeCalls)).toEqual([{ text: '編集した投稿文', url: shareUrl.href }]);
        await page.evaluate(() => window.__finishShare.reject(new DOMException('Cancelled', 'AbortError')));
        await expect(dialog.getByRole('status')).toHaveText('共有をキャンセルしました。');
        expect(nativeHandoffs).toEqual([]);
        await primary.click();
        await page.evaluate(() => window.__finishShare.reject(new Error('Unavailable')));
        await expect(dialog.getByRole('status')).toContainText('共有できませんでした');
        await primary.click();
        await page.evaluate(() => window.__finishShare.resolve());
        await expect(dialog.getByRole('status')).toHaveText('共有先に渡しました。');
        await expect.poll(() => nativeHandoffs.length).toBe(1);
        // A pending handoff belongs to this panel, not a later reopening.
        await primary.click();
        await page.evaluate(() => { window.__oldShare = window.__finishShare; });
        await dialog.getByRole('button', { name: '× 閉じる' }).click();
        await expect(dialog).toHaveCount(0);
        await fixture.getByRole('button', { name: '結果を共有', exact: true }).click();
        await expect(dialog.locator('#share-text')).toBeVisible();
        await dialog.locator('#share-text').fill('開き直した投稿文');
        await primary.click();
        expect(await page.evaluate(() => window.__nativeCalls.length)).toBe(5);
        expect(await page.evaluate(() => window.__nativeCalls.at(-1))).toEqual({
          text: '開き直した投稿文',
          url: await page.evaluate(async () => {
            const { sharePanel } = await import('/src/features/sharing/share-service.ts');
            return sharePanel.getSnapshot().url;
          }),
        });
        await page.evaluate(() => window.__oldShare.reject(new DOMException('Cancelled', 'AbortError')));
        await expect(dialog.getByRole('status')).toHaveCount(0);
        await primary.click();
        expect(await page.evaluate(() => window.__nativeCalls.length)).toBe(5);
        expect(nativeHandoffs).toHaveLength(1);
        await page.evaluate(() => window.__finishShare.resolve());
        await expect(dialog.getByRole('status')).toHaveText('共有先に渡しました。');
        await expect.poll(() => nativeHandoffs.length).toBe(2);
        const close = dialog.getByRole('button', { name: '× 閉じる' });
        await close.focus();
        await page.keyboard.press('Shift+Tab');
        await expect(dialog.getByRole('button', { name: 'リンクをコピー', exact: true })).toBeFocused();
        await page.keyboard.press('Tab');
        await expect(close).toBeFocused();
        await page.keyboard.press('Escape');
        await expect(fixture.getByRole('button', { name: '結果を共有', exact: true })).toBeFocused();
      } else {
        await dialog.getByRole('button', { name: '× 閉じる' }).click();
      }
      await expect(dialog).toHaveCount(0);
    });
  }
}
