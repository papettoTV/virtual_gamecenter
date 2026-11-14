import { randomUUID } from 'node:crypto';
import { test, expect } from '../../../../ci/ui-fixtures.mjs';
import { localUiUrl } from '../../../../ci/ui-tests.mjs';
import { respectReadBudget, finishReadBudget, readBudgetTimeout } from './api-read-budget.mjs';

import { claimWelcomeAndRefresh } from './welcome-wallet.mjs';
import { instrument, delayedReadProbe } from './read-budget-instrument.mjs';

const origin = 'http://127.0.0.1:5174';
const games = [
  { id: 'graze-duel', button: 'ゲーム開始', key: 'Space' },
  { id: 'deep-sea-salvage', button: '潜航開始', key: 'p' },
  { id: 'dot-wave', button: 'START / ゲーム開始', key: 'Space' },
];
// Wait for the rendered wallet without spending the bootstrap endpoint's budget.
async function wallet(page) {
  const badge = page.locator('.platform-credit-badge');
  await expect(badge).toHaveText(/^\d+$/);
  return Number(await badge.textContent());
}
async function persistedWallet(page) {
  return page.evaluate(async () => {
    const response = await fetch('/api/platform/credits', { credentials: 'same-origin' });
    if (!response.ok) throw new Error(`Persisted wallet read failed: ${response.status()}`);
    return (await response.json()).wallet.availableTotal;
  });
}
// Register the real bootstrap before navigation, then verify the new document
// and rendered wallet. Unrelated images/fonts need not finish loading first.
async function navigateGuest(page, url, reload = false) {
  const previousDocument = await page.evaluate(() => performance.timeOrigin);
  const loaded = page.waitForResponse(response =>
    response.url() === `${origin}/api/platform/bootstrap`
    && response.request().method() === 'GET'
    && response.frame() === page.mainFrame(), { timeout: readBudgetTimeout });
  if (reload) await page.reload({ waitUntil: 'domcontentloaded' });
  else await page.goto(url, { waitUntil: 'domcontentloaded' });
  const canonicalUrl = new URL(url);
  // PlatformExperience skips solo preparation (including URL cleanup) for
  // spectators. DOT WAVE's standalone controller removes start in both roles.
  // Neither URL behavior authorizes a play; spectator cases below verify real
  // accounting stays untouched even when start=1 remains in the address bar.
  if (canonicalUrl.searchParams.get('watch') !== '1'
    || canonicalUrl.searchParams.get('game') === 'dot-wave') {
    canonicalUrl.searchParams.delete('start');
  }
  await expect(page).toHaveURL(canonicalUrl.href);
  expect(await page.evaluate(() => performance.timeOrigin)).not.toBe(previousDocument);
  expect(await page.evaluate(() => document.readyState)).not.toBe('loading');
  const response = await loaded;
  expect(response.ok()).toBe(true);
  const account = await response.json();
  await expect(page.locator('.platform-credit-badge')).toHaveText(String(account.wallet.availableTotal));
  return account;
}
async function prepareGuest(page) {
  // Reuse the application's initial real bootstrap instead of requesting it again.
  const account = await navigateGuest(page, `${origin}/`);
  const decline = page.getByRole('button', { name: '拒否する', exact: true });
  if (await decline.isVisible()) await decline.click();
  if (!account.welcomeCreditGranted) {
    return claimWelcomeAndRefresh(page);
  }
  return account.wallet;
}
async function phase(page, game) {
  return page.evaluate(async game => game === 'dot-wave'
    ? document.querySelector('main.dot-wave[data-phase]')?.dataset.phase
    : (await import('/src/features/sharing/share-service.ts')).liveSharing.getSnapshot()?.phase, game);
}
// Observe real cabinet connections, including connections opened before exit.
const cabinetSockets = new WeakMap();
test.afterEach(async ({ context }) => { await finishReadBudget(context); });
test.beforeEach(async ({ page, context }, testInfo) => {
  testInfo.setTimeout(testInfo.timeout + readBudgetTimeout);
  await respectReadBudget(context, testInfo);
  const sockets = new Set();
  cabinetSockets.set(page, sockets);
  page.on('websocket', socket => {
    // Vite's HMR connection stays open across client-side navigation. Only
    // cabinet connections belong to the game lifetime under test.
    if (!/^\/api\/cabinets\/[^/]+\/ws$/.test(new URL(socket.url()).pathname)) return;
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
});
// Keep real accounting APIs and sockets: this helper only operates existing UI.
async function leaveToDirectory(page, gameId, selector = null) {
  // The browser route is /cabinets/<id>; the real socket uses /api/cabinets/<id>/ws.
  const cabinetPath = `/api${new URL(page.url()).pathname}/ws`;
  await expect.poll(() => [...cabinetSockets.get(page)]
    .filter(socket => new URL(socket.url()).pathname === cabinetPath).length).toBe(1);
  const sockets = [...cabinetSockets.get(page)];
  const dialogs = [];
  const onDialog = async dialog => { dialogs.push(dialog.message()); await dialog.dismiss(); };
  page.on('dialog', onDialog);
  try {
    if (!selector && gameId !== 'dot-wave') await page.keyboard.press('Escape');
    const leave = selector ? page.locator(selector)
      : gameId === 'dot-wave' ? page.getByRole('link', { name: 'ゲーム一覧へ', exact: true })
      : gameId === 'graze-duel' && await page.locator('.buzz-pause-leave').isVisible() ? page.locator('.buzz-pause-leave')
      : page.locator('#game-back-to-arcade');
    await expect(leave).toBeVisible();
    // DOT WAVE remounts PlatformExperience on return. Subscribe before exit:
    // the real read may need the full bounded Retry-After budget even though
    // the directory URL and game teardown have already finished.
    const loaded = page.waitForResponse(response =>
      response.url() === `${origin}/api/platform/bootstrap`
      && response.request().method() === 'GET'
      && response.frame() === page.mainFrame(), { timeout: readBudgetTimeout });
    // Native clicks in one task exercise duplicate input on the same control.
    const beforeExit = await phase(page, gameId);
    const player = await page.evaluate(async () =>
      (await import('/src/features/sharing/share-service.ts')).liveSharing.getSnapshot()?.role === 'player');
    await leave.evaluate(button => { button.click(); button.click(); });
    const exit = page.getByRole('dialog', { name: '別のゲームを選びますか？', exact: true });
    if (player && ['playing', 'paused', 'countdown', 'impact'].includes(beforeExit)) {
      await expect(exit).toBeVisible();
      await expect(exit).toHaveCount(1);
      await test.info().attach('leave-confirmation-open', { body: await page.screenshot(), contentType: 'image/png' });
      await expect(exit).toContainText('今のプレイは終了し、使用したクレジットは戻りません。');
      await exit.getByRole('button', { name: 'キャンセル', exact: true }).click();
      await expect(exit).not.toBeVisible();
      await expect(page).not.toHaveURL(`${origin}/`);
      await leave.click();
      await expect(exit).toBeVisible();
      await exit.getByRole('button', { name: '別のゲームをする', exact: true }).evaluate(button => { button.click(); button.click(); });
    } else {
      await expect(exit).toBeHidden();
    }
    const response = await loaded;
    expect(response.ok()).toBe(true);
    const account = await response.json();
    await expect(page.locator('.platform-credit-badge')).toHaveText(String(account.wallet.availableTotal));
    await expect(page).toHaveURL(`${origin}/`);
    await expect(page.locator('#game-screen, main.dot-wave')).toHaveCount(0);
    await expect.poll(() => page.evaluate(async () => (await import('/src/features/sharing/share-service.ts')).liveSharing.getSnapshot())).toBeNull();
    await expect.poll(() => page.evaluate(() => ({
      fixed: document.body.style.position === 'fixed',
      hidden: document.body.style.overflow === 'hidden',
      inert: document.querySelectorAll('[inert]').length,
      fullscreen: Boolean(document.fullscreenElement),
    }))).toEqual({ fixed: false, hidden: false, inert: 0, fullscreen: false });
    await expect.poll(() => sockets.filter(socket => cabinetSockets.get(page).has(socket)).length).toBe(0);
    await wallet(page);
    expect(dialogs).toEqual([]);
  } finally {
    page.off('dialog', onDialog);
  }
}
for (const game of games) {
  test(`${game.id}: unpaid ready exits immediately and another game remains unpaid`, async ({ page }) => {
    await prepareGuest(page);
    const balance = await wallet(page);
    const writes = [];
    page.on('request', request => {
      if (request.method() === 'POST' && request.url().includes('/credit-reservations')) writes.push(request.url());
    });
    for (const id of [game.id, games[(games.indexOf(game) + 1) % games.length].id]) {
      await navigateGuest(page, `${origin}/cabinets/${randomUUID()}?game=${id}`);
      await expect.poll(() => phase(page, id)).toBe(id === 'dot-wave' ? 'intro' : 'ready');
      await leaveToDirectory(page, id);
      expect(await persistedWallet(page)).toBe(balance);
      expect(writes).toHaveLength(0);
    }
  });
  test(`${game.id}: reload remains unpaid and ready`, async ({ page, isMobile }) => {
    await prepareGuest(page);
    const writes = [];
    page.on('request', request => {
      if (request.method() === 'POST' && request.url().includes('/api/platform/credit-reservations')) writes.push(request.url());
    });
    const cabinet = `${origin}/cabinets/${randomUUID()}?game=${game.id}&start=1`;
    const ready = game.id === 'dot-wave' ? 'intro' : 'ready';
    const start = page.getByRole('button', { name: game.button, exact: true });
    await navigateGuest(page, cabinet);
    const balance = await wallet(page);
    await expect.poll(() => phase(page, game.id)).toBe(ready);
    await navigateGuest(page, cabinet, true);
    if (isMobile || game.id === 'dot-wave') await expect(start).toBeVisible();
    await expect.poll(() => phase(page, game.id)).toBe(ready);
    await expect(page.getByRole('dialog', { name: 'ゲームを開始しますか？' })).toBeHidden();
    expect(await persistedWallet(page)).toBe(balance);
    expect(writes).toHaveLength(0);
    await leaveToDirectory(page, game.id);
  });
  for (const input of ['primary', 'keyboard']) {
    test(`${game.id}: ${input}, ready, cancel, delayed duplicate and authorized start`, async ({ page, isMobile }, testInfo) => {
      // This case includes cancellation, real accounting, exit and
      // re-entry (plus mobile layout checks). Keep individual assertions at
      // their normal timeout while allowing the full sequence to finish.
      // Extend the existing budget: beforeEach has already reserved time for
      // real Retry-After reads, and respectReadBudget may extend it further.
      // Resetting it to 60s can cut off the directory bootstrap during exit.
      testInfo.setTimeout(testInfo.timeout + 30000);
      // Only the disposable local guest and the real welcome-credit API are used.
      await test.step('初期guest: 実bootstrapと財布', () => prepareGuest(page));
      const writes = [];
      page.on('request', request => {
        if (request.method() === 'POST' && request.url().includes('/api/platform/credit-reservations')) writes.push(request.url());
      });
      const cabinet = `${origin}/cabinets/${randomUUID()}?game=${game.id}&start=1`;
      const start = page.getByRole('button', { name: game.button, exact: true });
      const ready = game.id === 'dot-wave' ? 'intro' : 'ready';
      await test.step('初回ready: 新document・bootstrap・phase', async () => {
        await navigateGuest(page, cabinet);
        if (isMobile || game.id === 'dot-wave') { await expect(start).toBeVisible(); await expect(start).toBeEnabled(); }
        await expect.poll(() => phase(page, game.id)).toBe(ready);
        await expect(page.getByRole('dialog', { name: 'ゲームを開始しますか？' })).toBeHidden();
        expect(writes).toHaveLength(0);
      });
      const balance = await wallet(page);
      if (game.id === 'graze-duel' && isMobile) {
        await expect(page.locator('#touch-pause')).toBeHidden();
        await expect(page.locator('.game-share-button')).toHaveCount(0);
        await page.getByRole('button', { name: '観戦に招待', exact: true }).tap();
        const share = page.getByRole('dialog', { name: '観戦リンクを共有', exact: true });
        await expect(share).toBeVisible();
        await expect.poll(() => phase(page, game.id)).toBe(ready);
        expect(writes).toHaveLength(0);
        await share.getByRole('button', { name: '× 閉じる' }).tap();
      }
      const intent = async () => {
        if (input === 'primary' && isMobile) await start.tap();
        else if (input === 'primary' && game.id === 'dot-wave') await start.click();
        else { await page.locator('body').click({ position: { x: 2, y: 2 } }); await page.keyboard.press(game.key); }
      };
      const dialog = page.getByRole('dialog', { name: 'ゲームを開始しますか？', exact: true });
      await test.step('取消: キー抑止・再入力・財布不変', async () => {
        await intent();
        await expect(dialog).toBeVisible();
        await testInfo.attach('start-confirmation-open', {
          body: await page.screenshot({ fullPage: true }), contentType: 'image/png',
        });
        {
          const invite = dialog.getByRole('button', { name: '観戦用画面を共有' });
          const confirm = dialog.getByRole('button', { name: '1クレジットで開始' });
          const inviteBox = await invite.boundingBox();
          const confirmBox = await confirm.boundingBox();
          expect(inviteBox.y + inviteBox.height).toBeLessThan(confirmBox.y);
          expect(confirmBox.x + confirmBox.width).toBeCloseTo(inviteBox.x + inviteBox.width, 0);
          if (isMobile) await invite.tap(); else await invite.click();
          const sharing = page.getByRole('dialog', { name: '観戦リンクを共有' });
          for (const name of ['Xに投稿', 'Facebookに投稿', '投稿文とリンクをコピー']) {
            const action = sharing.getByRole('button', { name, exact: true });
            await expect(action).toBeVisible();
            await expect(action.locator('svg')).toBeVisible();
          }
          await expect(sharing.locator('textarea, .social-preview, .share-url')).toHaveCount(0);
          await page.evaluate(() => {
            window.startShareLinks = [];
            window.open = url => { window.startShareLinks.push(String(url)); return null; };
            Object.defineProperty(navigator, 'clipboard', {
              configurable: true, value: { writeText: async text => { window.startShareCopied = text; } },
            });
          });
          const postX = sharing.getByRole('button', { name: 'Xに投稿' });
          if (isMobile) await postX.tap(); else await postX.click();
          const postFacebook = sharing.getByRole('button', { name: 'Facebookに投稿' });
          if (isMobile) await postFacebook.tap(); else await postFacebook.click();
          const copyPost = sharing.getByRole('button', { name: '投稿文とリンクをコピー' });
          if (isMobile) await copyPost.tap(); else await copyPost.click();
          await expect(sharing.getByText('コピーしました。')).toBeVisible();
          const { links, copied } = await page.evaluate(() => ({ links: window.startShareLinks, copied: window.startShareCopied }));
          const [x, facebook] = links.map(url => new URL(url));
          expect(x.origin + x.pathname).toBe('https://x.com/intent/tweet');
          expect(facebook.origin + facebook.pathname).toBe('https://www.facebook.com/sharer/sharer.php');
          const watchUrl = x.searchParams.get('url');
          expect(new URL(watchUrl).searchParams.get('watch')).toBe('1');
          expect(facebook.searchParams.get('u')).toBe(watchUrl);
          expect(copied).toBe(x.searchParams.get('text') + '\n' + watchUrl);
          await page.keyboard.press('Escape');
          await expect(sharing).toBeHidden();
          await expect(invite).toBeFocused();
          await invite.blur();
          if (game.id === 'dot-wave') await dialog.getByRole('button', { name: 'キャンセル', exact: true }).focus();
          expect(await wallet(page)).toBe(balance);
          if (isMobile || game.id === 'dot-wave') await start.evaluate(button => {
            for (const pointerId of [1, 2]) button.dispatchEvent(new PointerEvent('pointerdown', { pointerId, bubbles: true }));
            button.click(); button.click();
          });
          expect(writes).toHaveLength(0);
        }
        await page.evaluate(code => window.dispatchEvent(new KeyboardEvent('keydown', { code, repeat: true, bubbles: true })), game.key === 'p' ? 'KeyP' : 'Space');
        await expect.poll(() => phase(page, game.id)).toBe(ready);
        expect(writes).toHaveLength(0);
        // A document listener sees real game keys only after the window capture guard.
        await page.evaluate(() => {
          window.dialogKeysAtDocument = [];
          document.addEventListener('keydown', event => window.dialogKeysAtDocument.push(event.code));
        });
        // DOT WAVE focuses Cancel: Space there is a native button activation.
        // F is also a real game input, but must stay inside the local dialog.
        if (game.id === 'dot-wave') await expect(dialog.getByRole('button', { name: 'キャンセル', exact: true })).toBeFocused();
        await page.keyboard.press(game.id === 'dot-wave' ? 'f' : game.key);
        await expect(dialog).toBeVisible();
        await page.keyboard.press('Escape');
        expect(await page.evaluate(() => window.dialogKeysAtDocument)).toEqual([]);
        await expect(dialog).toBeHidden();
        expect(await wallet(page)).toBe(balance);
        await page.keyboard.press('Shift');
        expect(await page.evaluate(() => window.dialogKeysAtDocument)).toContain('ShiftLeft');
        if (game.id === 'dot-wave') {
          for (const key of ['Space', 'Enter']) {
            await intent();
            const cancel = dialog.getByRole('button', { name: 'キャンセル', exact: true });
            await expect(cancel).toBeFocused();
            await page.keyboard.press(key);
            await expect(dialog).toBeHidden();
            await expect.poll(() => phase(page, game.id)).toBe(ready);
            expect(await wallet(page)).toBe(balance);
            expect(writes).toHaveLength(0);
          }
        }
        await intent();
        await dialog.getByRole('button', { name: 'キャンセル', exact: true }).click();
        await expect(dialog).toBeHidden();
        await expect.poll(() => phase(page, game.id)).toBe(ready);
        expect(await wallet(page)).toBe(balance);
      });
      await test.step('承認・遅延重複入力: 実予約とcapture', async () => {
        await intent();
        expect(await persistedWallet(page)).toBe(balance);
        // Delay the real request, without replacing credit or authorization responses.
        await page.route('**/api/platform/credit-reservations', async route => {
          await new Promise(resolve => setTimeout(resolve, 250));
          await route.continue();
        });
        // Observe actual accounting responses; never replace reservation or capture.
        const reserved = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/credit-reservations'));
        const captured = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/capture'));
        const approve = dialog.getByRole('button', { name: '1クレジットで開始', exact: true });
        if (game.id === 'dot-wave') {
          await approve.focus();
          await expect(approve).toBeFocused();
          // Repeated Enter normally activates a focused button on keydown.
          // It must neither authorize play nor create a reservation.
          for (const key of ['Space', 'Enter']) {
            expect(await approve.evaluate((button, code) => button.dispatchEvent(new KeyboardEvent('keydown', { code, key: code === 'Space' ? ' ' : code, repeat: true, bubbles: true, cancelable: true })), key)).toBe(false);
          }
          await expect(dialog).toBeVisible();
          expect(writes).toHaveLength(0);
          expect(await wallet(page)).toBe(balance);
          await expect.poll(() => phase(page, game.id)).toBe(ready);
          const key = input === 'primary' ? 'Space' : 'Enter';
          await page.keyboard.press(key);
          await page.keyboard.press(key);
        } else {
          await approve.evaluate(button => { button.click(); button.click(); });
        }
        await page.keyboard.press(game.key);
        await expect.poll(async () => ['playing', 'countdown', 'paused'].includes(await phase(page, game.id))).toBe(true);
        await expect(dialog).toBeHidden();
        const reservationResponse = await reserved;
        const captureResponse = await captured;
        expect(reservationResponse.ok()).toBe(true);
        expect(captureResponse.ok()).toBe(true);
        const reservation = await reservationResponse.json();
        const capture = await captureResponse.json();
        await test.step('会計検証: 1回だけ消費・releaseなし', async () => {
          expect(reservation.wallet.availableTotal).toBe(balance - 1);
          expect(capture.status).toBe('captured');
          expect(capture.wallet.availableTotal).toBe(balance - 1);
          expect(capture.wallet.reservedFree + capture.wallet.reservedPurchased).toBe(0);
          await expect(page.locator('.platform-credit-badge')).toHaveText(String(balance - 1));
          expect(await persistedWallet(page)).toBe(balance - 1);
          expect(writes.filter(url => url.endsWith('/credit-reservations'))).toHaveLength(1);
          expect(writes.filter(url => url.endsWith('/capture'))).toHaveLength(1);
          expect(writes.filter(url => url.endsWith('/release'))).toHaveLength(0);
        });
      });
      if (game.id === 'graze-duel' && isMobile) {
        const screen = page.locator('#game-screen');
        const pause = screen.locator('#touch-pause');
        await expect(screen).toHaveAttribute('data-mobile-play', 'true');
        await expect(screen.getByRole('button', { name: '通常表示に戻る' })).toHaveCount(0);
        const pauseRect = await pause.boundingBox();
        expect(await pause.evaluate((button, rect) => button === document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2), pauseRect)).toBe(true);
        await page.evaluate(() => {
          window.pauseCanvasInputs = 0;
          document.querySelector('#game').addEventListener('pointerdown', () => window.pauseCanvasInputs++);
        });
        await expect(pause).toHaveAccessibleName('一時停止');
        await pause.tap();
        expect(await page.evaluate(() => window.pauseCanvasInputs)).toBe(0);
        await expect.poll(() => phase(page, game.id)).toBe('paused');
        await expect(pause).toHaveText('再開');
        await expect(screen.getByRole('button', { name: '別のゲームをする', exact: true }).filter({ visible: true })).toBeVisible();
        await expect(page.locator('.notification-center')).not.toContainText('1クレジットを使用しました。', { timeout: 7000 });
        for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 568 }, { width: 844, height: 390 }]) {
          await page.setViewportSize(viewport);
          const frame = await screen.locator('.game-frame').boundingBox();
          const control = await pause.boundingBox();
          expect(control.width).toBeGreaterThanOrEqual(44);
          expect(control.height).toBeGreaterThanOrEqual(44);
          expect(control.x + control.width).toBeLessThanOrEqual(viewport.width);
          expect(frame.y).toBeCloseTo(control.y, 0);
          const status = screen.locator('.buzz-mobile-status');
          await expect(status).toContainText('LV');
          await expect(status).toContainText('♥');
          const cells = await status.locator('span').evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().toJSON()));
          for (let i = 1; i < cells.length; i++) expect(cells[i].x).toBeGreaterThanOrEqual(cells[i - 1].right);
          expect(cells.at(-1).right).toBeLessThanOrEqual(control.x);

          expect(frame.height).toBeGreaterThanOrEqual(Math.min(viewport.width / .65, viewport.height - 132) - 2);
          expect(frame.y + frame.height).toBeLessThanOrEqual(viewport.height);
          expect(frame.width / frame.height).toBeCloseTo(416 / 640, 2);
          const panel = screen.getByRole('region', { name: '一時停止', exact: true });
          await expect(panel).toBeVisible();
          await expect(panel.getByRole('heading', { name: 'PAUSED', exact: true })).toBeVisible();
          await expect(panel.locator('.buzz-pause-hint')).toHaveText('右上の「▶」をタップして再開');
          await expect(panel.locator('li')).toHaveText(['移動: ゲーム画面をスライド', 'ボス攻撃: 無敵シールドを当てる']);
          // Check the actual rendered text lines, not just their wrapping boxes.
          // Grid min-content sizing used to push these beyond the narrow board.
          const textBounds = await panel.locator('h2, .buzz-pause-hint, li').evaluateAll(nodes => nodes.map(node => {
            const range = document.createRange();
            range.selectNodeContents(node);
            return {
              box: node.getBoundingClientRect().toJSON(),
              lines: [...range.getClientRects()].map(rect => rect.toJSON()),
              overflows: node.scrollWidth > node.clientWidth,
            };
          }));
          for (const { box, lines, overflows } of textBounds) {
            expect(overflows).toBe(false);
            expect(lines.length).toBeGreaterThan(0);
            for (const rect of [box, ...lines]) {
              expect(rect.left).toBeGreaterThanOrEqual(frame.x - 1);
              expect(rect.right).toBeLessThanOrEqual(frame.x + frame.width + 1);
            }
          }
          const actions = await screen.locator('.buzz-pause-actions').boundingBox();
          expect(actions.y).toBeGreaterThanOrEqual(frame.y + frame.height - 1);
          expect(actions.y + actions.height).toBeLessThanOrEqual(viewport.height);
          await testInfo.attach(`buzz-paused-${viewport.width}`, { body: await page.screenshot(), contentType: 'image/png' });
        }
        await screen.getByRole('button', { name: '観戦URLをシェア', exact: true }).click();
        const pausedShare = page.getByRole('dialog', { name: '観戦リンクを共有', exact: true });
        await expect(pausedShare).toBeVisible();
        for (const name of ['Xに投稿', 'Facebookに投稿', '投稿文とリンクをコピー']) await expect(pausedShare.getByRole('button', { name, exact: true })).toBeVisible();
        const closeShare = pausedShare.getByRole('button', { name: '× 閉じる' });
        // Visibility alone does not catch the fullscreen cabinet covering the
        // share overlay. Check the actual pointer target as well.
        expect(await closeShare.evaluate(button => {
          const rect = button.getBoundingClientRect();
          return button.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
        })).toBe(true);
        expect(await page.evaluate(async () => (await import('/src/features/sharing/share-service.ts')).sharePanel.getSnapshot().text.split('\n')[0])).toBe('バズバリアに挑戦中。');
        await testInfo.attach('paused-share-open', { body: await page.screenshot(), contentType: 'image/png' });
        await page.keyboard.press('Escape');
        await expect(pausedShare).toBeHidden();
        await expect(screen).toHaveAttribute('data-mobile-play', 'true');
        // Reopening and closing by pointer must restore the same paused view.
        await screen.getByRole('button', { name: '観戦URLをシェア', exact: true }).click();
        await expect(pausedShare).toBeVisible();
        await pausedShare.getByRole('button', { name: '× 閉じる' }).click();
        await expect(pausedShare).toBeHidden();
        await expect(screen).toHaveAttribute('data-mobile-play', 'true');
        await expect.poll(() => phase(page, game.id)).toBe('paused');
        expect(await wallet(page)).toBe(balance - 1);
        await expect(pause).toHaveAccessibleName('再開');
        await pause.focus();
        await page.keyboard.press('Enter');
        await expect.poll(() => phase(page, game.id)).toBe('playing');
        await expect(pause).toHaveText('一時停止');
        await expect(screen.locator('.buzz-pause-actions .buzz-pause-leave')).toHaveCount(0);
        expect(await wallet(page)).toBe(balance - 1);
        await pause.tap();
        await expect.poll(() => phase(page, game.id)).toBe('paused');
      }
      await test.step('直接退出・連打: 消費済み残高と表示復帰', async () => {
        await leaveToDirectory(page, game.id, isMobile && game.id === 'graze-duel' ? '.buzz-pause-actions .buzz-pause-leave' : null);
        expect(await persistedWallet(page)).toBe(balance - 1);
        expect(writes.filter(url => url.endsWith('/credit-reservations'))).toHaveLength(1);
        expect(writes.filter(url => url.endsWith('/capture'))).toHaveLength(1);
        expect(writes.filter(url => url.endsWith('/release'))).toHaveLength(0);
        // A new visit must be unpaid and ready; leaving it cannot refund the old run.
        await navigateGuest(page, cabinet);
        await expect.poll(() => phase(page, game.id)).toBe(ready);
        await leaveToDirectory(page, game.id);
        expect(await persistedWallet(page)).toBe(balance - 1);
        expect(writes.filter(url => url.endsWith('/credit-reservations'))).toHaveLength(1);
      });
    });
  }
  test(`${game.id}: failed capture keeps play stopped and releases the unused reservation`, async ({ page, isMobile }) => {
    await prepareGuest(page);
    await navigateGuest(page, `${origin}/cabinets/${randomUUID()}?game=${game.id}`);
    const start = page.getByRole('button', { name: game.button, exact: true });
    if (isMobile || game.id === 'dot-wave') { await expect(start).toBeVisible(); await expect(start).toBeEnabled(); }
    await expect.poll(() => phase(page, game.id)).toBe(game.id === 'dot-wave' ? 'intro' : 'ready');
    const balance = await wallet(page);
    await page.route('**/api/platform/credit-reservations/*/capture', route => route.abort());
    if (isMobile) await start.tap();
    else { await page.locator('body').click({ position: { x: 2, y: 2 } }); await page.keyboard.press(game.key); }
    const released = page.waitForResponse(response => response.url().endsWith('/release') && response.ok());
    await page.getByRole('dialog', { name: 'ゲームを開始しますか？', exact: true })
      .getByRole('button', { name: '1クレジットで開始', exact: true }).click();
    const releaseResponse = await released;
    expect((await releaseResponse.json()).wallet.availableTotal).toBe(balance);
    await expect.poll(() => phase(page, game.id)).toBe(game.id === 'dot-wave' ? 'intro' : 'ready');
    expect(await wallet(page)).toBe(balance);
    expect(await persistedWallet(page)).toBe(balance);
  });
  for (const { occupied, delayedExit } of [
    { occupied: false, delayedExit: false },
    { occupied: true, delayedExit: false },
    ...(game.id === 'dot-wave' ? [{ occupied: true, delayedExit: true }] : []),
  ]) {
    test(`${game.id}: spectator never requests a start (${occupied ? 'live player' : 'empty cabinet'}${delayedExit ? ', exit read backpressure' : ''})`, async ({ page, context, browser, isMobile }, testInfo) => {
      const cabinet = `${origin}/cabinets/${randomUUID()}?game=${game.id}`;
      const playerContext = occupied ? await browser.newContext() : null;
      // Isolate the whole delayed-exit case, including setup and post-exit reads.
      // Each role keeps one local IP across its reads; cookies/player limits and
      // every accounting write still use the unmodified real Worker behavior.
      let readPhase = 'setup';
      const identity = label => ({
        address: `fd00:${randomUUID().replaceAll('-', '').match(/.{4}/g).slice(0, 7).join(':')}`,
        label, phase: () => readPhase,
      });
      const spectatorReads = delayedExit ? identity('spectator') : undefined;
      const playerReads = delayedExit ? identity('player') : undefined;
      if (delayedExit) {
        await finishReadBudget(context);
        await respectReadBudget(context, testInfo, spectatorReads);
      }
      const playerEvents = [];
      const playerWrites = [];
      let player;
      try {
        if (playerContext) {
          // Extra contexts need the same local-only network boundary as the fixture.
          await playerContext.route('**/*', route => localUiUrl(route.request().url()) ? route.continue() : route.abort());
          await playerContext.routeWebSocket('**/*', socket => localUiUrl(socket.url()) ? socket.connectToServer() : socket.close());
          await respectReadBudget(playerContext, testInfo, playerReads);
          player = await playerContext.newPage();
          // Record local accounting and connection transitions for failed CI diagnosis.
          player.on('request', request => {
            if (request.method() === 'POST' && request.url().includes('/api/platform/credit-reservations')) {
              playerWrites.push(request.url());
              playerEvents.push({ type: 'request', path: new URL(request.url()).pathname });
            }
          });
          player.on('response', response => {
            if (response.url().includes('/api/platform/credit-reservations')) {
              playerEvents.push({ type: 'response', path: new URL(response.url()).pathname, status: response.status() });
            }
          });
          player.on('websocket', socket => {
            playerEvents.push({ type: 'socket-open' });
            socket.on('close', () => playerEvents.push({ type: 'socket-close' }));
            socket.on('framereceived', ({ payload }) => {
              try {
                const message = JSON.parse(String(payload));
                // Keep only protocol event names, never guest/session payloads.
                if (['joinedCabinet', 'roleChanged', 'dotWaveSoloStarted', 'error'].includes(message.type)) {
                  playerEvents.push({ type: message.type });
                }
              } catch { /* Binary/non-JSON frames carry no diagnostic event. */ }
            });
          });
          await prepareGuest(player);
          await navigateGuest(player, cabinet);
          await expect.poll(() => phase(player, game.id)).toBe(game.id === 'dot-wave' ? 'intro' : 'ready');
          if (game.id === 'dot-wave') {
            // intro renders before the socket's joinedCabinet assigns the seat.
            await expect(player.locator('.dot-cabinet-bar > span')).toContainText('あなたの筐体');
            const start = player.getByRole('button', { name: game.button, exact: true });
            await expect(start).toBeVisible();
            await expect(start).toBeEnabled();
          }
          readPhase = 'player-start-and-wallet';
          const playerBalance = await wallet(player);
          // Register both real accounting responses before any start operation.
          const reserved = player.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/credit-reservations'));
          const captured = player.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/capture'));
          // DOT WAVE dispatches wallet-changed after capture; PlatformExperience
          // reloads bootstrap asynchronously, potentially waiting Retry-After.
          const refreshed = game.id === 'dot-wave' ? player.waitForResponse(response =>
            response.url() === `${origin}/api/platform/bootstrap`
            && response.request().method() === 'GET'
            && response.frame() === player.mainFrame(), { timeout: readBudgetTimeout }) : null;
          if (game.id === 'dot-wave') {
            // Space on keydown opens a dialog that autofocuses Cancel; use the
            // rendered primary control here. Dedicated cases above cover keys.
            await player.getByRole('button', { name: game.button, exact: true }).click();
          } else {
            await player.locator('body').click({ position: { x: 2, y: 2 } });
            await player.keyboard.press(game.key);
          }
          const confirmation = player.getByRole('dialog', { name: 'ゲームを開始しますか？', exact: true });
          await expect(confirmation).toBeVisible();
          await confirmation.getByRole('button', { name: '1クレジットで開始', exact: true }).click();
          const reservationResponse = await reserved;
          expect(reservationResponse.ok()).toBe(true);
          expect((await reservationResponse.json()).wallet.availableTotal).toBe(playerBalance - 1);
          await expect.poll(async () => ['playing', 'countdown', 'paused'].includes(await phase(player, game.id))).toBe(true);
          const captureResponse = await captured;
          expect(captureResponse.ok()).toBe(true);
          const capture = await captureResponse.json();
          expect(capture.status).toBe('captured');
          expect(capture.wallet.availableTotal).toBe(playerBalance - 1);
          expect(capture.wallet.reservedFree + capture.wallet.reservedPurchased).toBe(0);
          await expect(confirmation).toBeHidden();
          expect(playerWrites.filter(url => url.endsWith('/credit-reservations'))).toHaveLength(1);
          expect(playerWrites.filter(url => url.endsWith('/capture'))).toHaveLength(1);
          expect(playerWrites.filter(url => url.endsWith('/release'))).toHaveLength(0);
          if (game.id === 'dot-wave') expect(playerEvents).toContainEqual({ type: 'dotWaveSoloStarted' });
          playerEvents.push({ type: 'authorized-phase', phase: await phase(player, game.id) });
          if (refreshed) {
            const response = await refreshed;
            expect(response.ok()).toBe(true);
            expect((await response.json()).wallet).toEqual(capture.wallet);
          }
          await expect(player.locator('.platform-credit-badge')).toHaveText(String(playerBalance - 1), { timeout: readBudgetTimeout });
          expect(await persistedWallet(player)).toBe(playerBalance - 1);
        }
        readPhase = 'spectator-setup';
        const balance = (await prepareGuest(page)).availableTotal;
        const writes = [];
        page.on('request', request => { if (request.method() === 'POST' && request.url().includes('credit-reservations')) writes.push(request.url()); });
        await navigateGuest(page, `${cabinet}&watch=1&start=1`);
        const waiting = page.getByRole('region', { name: 'プレイの開始待ち・終了', exact: true });
        if (!occupied) {
          await expect(waiting).toBeVisible();
          await expect(page.locator('.spectator-offline')).toBeAttached();
        } else {
          await expect(waiting).toBeHidden();
          if (game.id === 'dot-wave') await expect(page.locator('.dot-cabinet-bar > span')).toContainText('観戦中');
          else await expect(page.locator('#spectator-banner')).toBeVisible();
        }
        const start = page.getByRole('button', { name: game.button, exact: true });
        const dialog = page.getByRole('dialog', { name: 'ゲームを開始しますか？' });
        await expect(start).toBeHidden();
        await expect(dialog).toBeHidden();
        await page.locator('body').click({ position: { x: 2, y: 2 } });
        await page.keyboard.press(game.key);
        await page.keyboard.down(game.key);
        await page.keyboard.down(game.key);
        await page.keyboard.up(game.key);
        await expect(start).toBeHidden();
        await expect(dialog).toBeHidden();
        expect(await wallet(page)).toBe(balance);
        expect(await persistedWallet(page)).toBe(balance);
        expect(writes).toHaveLength(0);
        if (!occupied) await expect(waiting).toBeVisible();
        // Exercise the same live spectator → directory path with a genuine
        // Worker fetch on both attempts. Only the first read's status/header
        // are instrumented; cookies, wallet and successful retry stay real.
        const exitProbe = delayedReadProbe('/api/platform/bootstrap');
        let exitScope;
        if (delayedExit) {
          await finishReadBudget(context);
          exitScope = instrument(context, exitProbe.intercept);
          await respectReadBudget(exitScope, testInfo, spectatorReads);
        }
        readPhase = 'spectator-exit';
        try {
          await leaveToDirectory(page, game.id, !occupied
            ? '.spectator-availability .showcase-actions button:last-child'
            : game.id === 'dot-wave' ? null : '#spectator-game-back');
          if (delayedExit) exitProbe.verify();
          readPhase = 'spectator-post-exit-wallet';
          expect(await wallet(page)).toBe(balance);
          expect(await persistedWallet(page)).toBe(balance);
          expect(writes).toHaveLength(0);
        } finally {
          if (exitScope) await finishReadBudget(exitScope);
        }
      } finally {
        if (playerContext) {
          if (player && !player.isClosed()) {
            playerEvents.push({ type: 'final-phase', phase: await phase(player, game.id).catch(() => 'unavailable') });
          }
          await testInfo.attach('local-player-start', { body: JSON.stringify(playerEvents), contentType: 'application/json' });
        }
        if (playerContext) {
          try { await finishReadBudget(playerContext); }
          finally { await playerContext.close(); }
        }
      }
    });
  }
}

// Registration cancellation exercises PlatformExperience's shared pending state:
// BUZZ represents that flow (also used by deep-sea-salvage) on PC and mobile.
// DOT WAVE uses standaloneCredits and its own confirmation, not this welcome flow.
// Keep the three-game start/accounting/spectator coverage above unchanged; the
// real account/consent hook regression is in registration-play-recovery.test.ts.
for (const game of games.filter(game => game.id === 'graze-duel')) {
  for (const closeAt of ['consent', 'registration']) {
    test(`${game.id}: insufficient credit registration cancellation at ${closeAt} recovers without reload`, async ({ page, isMobile }) => {
      // Keep the welcome grant unclaimed so it can fund the final authorized play.
      const initial = await navigateGuest(page, `${origin}/`);
      expect(initial.accountRegistered).toBe(false);
      expect(initial.consent.accepted).toBe(false);
      expect(initial.welcomeCreditGranted).toBe(false);
      const decline = page.getByRole('button', { name: '拒否する', exact: true });
      if (await decline.isVisible()) await decline.click();
      // Exhaust only this disposable guest's local credits with real accounting APIs.
      await page.evaluate(async ({ balance, gameId }) => {
        const api = await import('/src/features/platform/platform-client.ts');
        for (let index = 0; index < balance; index++) {
          const reservation = await api.reservePlayCredit(crypto.randomUUID(), gameId);
          const result = await api.capturePlayCredit(reservation.reservationId);
          if (result.status !== 'captured') throw new Error('Local guest setup capture failed');
        }
      }, { balance: initial.wallet.availableTotal, gameId: game.id });
      await navigateGuest(page, `${origin}/cabinets/${randomUUID()}?game=${game.id}`);
      const ready = game.id === 'dot-wave' ? 'intro' : 'ready';
      await expect.poll(() => phase(page, game.id)).toBe(ready);
      expect(await wallet(page)).toBe(0);
      const writes = [];
      page.on('request', request => {
        if (request.method() === 'POST' && request.url().includes('/api/platform/credit-reservations')) writes.push(request.url());
      });
      if (game.id === 'graze-duel' && isMobile) {
        await expect(page.locator('#touch-pause')).toBeHidden();
        await expect(page.locator('.game-share-button')).toHaveCount(0);
        await page.getByRole('button', { name: '観戦に招待', exact: true }).tap();
        const share = page.getByRole('dialog', { name: '観戦リンクを共有', exact: true });
        await expect(share).toBeVisible();
        await expect.poll(() => phase(page, game.id)).toBe(ready);
        expect(writes).toHaveLength(0);
        await share.getByRole('button', { name: '× 閉じる' }).tap();
      }
      const intent = async () => {
        if (isMobile) await page.getByRole('button', { name: game.button, exact: true }).tap();
        else {
          await page.locator('body').click({ position: { x: 2, y: 2 } });
          await page.keyboard.press(game.key);
        }
      };
      const insufficient = page.getByRole('dialog', { name: 'クレジットが不足しています', exact: true });
      const skipWelcome = async () => {
        const welcome = page.getByRole('dialog', { name: '無料5クレジット', exact: true });
        // Use the real welcome dialog's skip control, leaving the grant untouched.
        await page.getByRole('button', { name: '受け取らない', exact: true }).click();
        await expect(welcome).toBeHidden();
        await expect(insufficient).toBeVisible();
      };
      await intent();
      await skipWelcome();
      await insufficient.getByRole('button', { name: 'ユーザー登録で5枚を受け取る', exact: true }).click();
      const consent = page.getByRole('dialog', { name: 'サービスを利用する前に', exact: true });
      await expect(consent).toBeVisible();
      if (closeAt === 'consent') {
        await consent.getByRole('button', { name: '規約確認を閉じる', exact: true }).click();
      } else {
        await consent.getByRole('button', { name: '同意して続ける', exact: true }).click();
        const account = page.getByRole('dialog', { name: 'ユーザー登録', exact: true });
        await expect(account).toBeVisible();
        await account.getByRole('button', { name: 'ユーザー登録を閉じる', exact: true }).click();
      }
      await expect.poll(() => phase(page, game.id)).toBe(ready);
      expect(await wallet(page)).toBe(0);
      expect(writes).toHaveLength(0);
      // No navigation or reload: the actual game's next intent must work again.
      await intent();
      await skipWelcome();
      await insufficient.getByRole('button', { name: '閉じる', exact: true }).click();
      // Inject a >5s delay unless the Worker supplies its own Retry-After. Reads
      // still reach the local Worker; only backpressure metadata is injected.
      const probe = delayedReadProbe('/api/platform/bootstrap');
      const scope = instrument(page.context(), probe.intercept);
      await respectReadBudget(scope, test.info());
      let grant;
      try {
        grant = await claimWelcomeAndRefresh(page);
        probe.verify();
      } finally {
        await finishReadBudget(scope);
      }
      await intent();
      const confirm = page.getByRole('dialog', { name: 'ゲームを開始しますか？', exact: true });
      await expect(confirm).toBeVisible();
      await expect.poll(() => phase(page, game.id)).toBe(ready);
      expect(writes).toHaveLength(0);
      expect(await wallet(page)).toBe(grant.availableTotal);
      await page.route('**/api/platform/credit-reservations', async route => {
        await new Promise(resolve => setTimeout(resolve, 250));
        await route.continue();
      });
      const captured = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/capture'));
      await confirm.getByRole('button', { name: '1クレジットで開始', exact: true }).evaluate(button => { button.click(); button.click(); });
      await page.keyboard.press(game.key);
      const response = await captured;
      expect(response.ok()).toBe(true);
      const capture = await response.json();
      expect(capture.status).toBe('captured');
      expect(capture.wallet.availableTotal).toBe(grant.availableTotal - 1);
      expect(capture.wallet.reservedFree + capture.wallet.reservedPurchased).toBe(0);
      await expect.poll(async () => ['playing', 'countdown', 'paused'].includes(await phase(page, game.id))).toBe(true);
      await expect(confirm).toBeHidden();
      await expect(page.locator('.platform-credit-badge')).toHaveText(String(grant.availableTotal - 1));
      expect(writes.filter(url => url.endsWith('/credit-reservations'))).toHaveLength(1);
      expect(writes.filter(url => url.endsWith('/capture'))).toHaveLength(1);
    });
  }
}
