import { test, expect } from '../../../../ci/ui-fixtures.mjs';

// Presentation-only fixture: real GameScreen, NotificationCenter and stores.
// Start authorization/accounting remain covered by play-confirmation.spec.mjs.
test.use({ hasTouch: true });

async function mount(page, gameId, role = 'player', initialPhase = 'ready') {
  await page.goto('http://127.0.0.1:5174/');
  const screen = page.locator('#presentation-fixture #game-screen');
  // Vite can reload the document while this fixture first imports game modules.
  // Establish the fixture and its initial phase together in the live document.
  await expect.poll(async () => {
    try {
      if (await screen.count()) return true;
      await page.evaluate(async ({ gameId, role, initialPhase }) => {
        // Direct browser imports receive Vite's CommonJS default export; they do
        // not get the named-import interop that Vite applies to source modules.
        const { default: React } = await import('/node_modules/.vite/deps/react.js');
        const { default: ReactDOMClient } = await import('/node_modules/.vite/deps/react-dom_client.js');
        const { GameScreen } = await import('/src/features/game/GameScreen.tsx');
        const { getGameDefinition } = await import('/src/domain/game.ts');
        const { setLiveContext } = await import('/src/features/sharing/share-service.ts');
        if (document.getElementById('presentation-fixture')) return;
        const host = document.createElement('main');
        host.id = 'presentation-fixture'; document.body.append(host);
        ReactDOMClient.createRoot(host).render(React.createElement(GameScreen, { game: getGameDefinition(gameId) }));
        setLiveContext({ gameId, cabinetId: 'presentation-only', role, phase: initialPhase });
      }, { gameId, role, initialPhase });
      return Boolean(await screen.count());
    } catch (error) {
      if (!String(error).includes('Execution context was destroyed')) throw error;
      return false;
    }
  }).toBe(true);
  await screen.evaluate(el => el.classList.remove('is-hidden'));
  return screen;
}
async function phase(page, gameId, phase, role = 'player') {
  await page.evaluate(async context => {
    (await import('/src/features/sharing/share-service.ts')).setLiveContext(context);
  }, { gameId, cabinetId: 'presentation-only', role, phase });
}


async function notify(page) {
  await page.evaluate(async () => {
    const { notifications } = await import('/src/features/notifications/notifications.ts');
    notifications.show({ id: 'close-test', type: 'error', message: '閉じる対象' });
    notifications.show({ id: 'action-test', type: 'error', message: 'アクション対象', action: {
      label: '確認する', run: () => { document.body.dataset.noticeAction = 'done'; },
    } });
  });
}

async function hitTarget(locator) {
  expect(await locator.evaluate(el => {
    const rect = el.getBoundingClientRect();
    return el.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
  })).toBe(true);
}

for (const gameId of ['buzz-barrier', 'deep-sea-salvage']) {
  for (const viewport of [{ width: 320, height: 740 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
    test(`${gameId}: notification touch, action and restoration ${viewport.width}`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      const screen = await mount(page, gameId);
      await page.getByRole('button', { name: '拒否する', exact: true }).click();
      const background = page.locator('#notification-background');
      await page.evaluate(() => {
        // A sibling in the same wrapper as the real global notification center
        // must stay inert; the center itself must escape all inert ancestors.
        const sibling = document.createElement('button');
        sibling.id = 'notification-background'; sibling.textContent = '背景';
        document.querySelector('.notification-center').parentElement.append(sibling);
        const prior = document.createElement('button'); prior.id = 'previously-inert'; prior.inert = true;
        sibling.parentElement.append(prior);
        sibling.focus();
        document.body.style.overflow = 'auto';
      });
      const originalStyle = await page.evaluate(() => document.body.getAttribute('style'));
      const originalScroll = await page.evaluate(() => ({ x: scrollX, y: scrollY }));
      await phase(page, gameId, 'playing');
      await expect(screen).toHaveAttribute('data-mobile-play', 'true');
      await page.setViewportSize(viewport);
      await notify(page);
      const center = page.getByRole('complementary', { name: '通知', exact: true });
      expect(await center.evaluate(el => el.closest('[inert]') === null)).toBe(true);
      expect(await background.evaluate(el => el.closest('[inert]') !== null)).toBe(true);
      const closeNotice = center.locator('.notification', { hasText: '閉じる対象' });
      const actionNotice = center.locator('.notification', { hasText: 'アクション対象' });
      const close = closeNotice.getByRole('button', { name: '通知を閉じる' });
      const pause = screen.locator('#touch-pause');
      await hitTarget(close);
      await hitTarget(pause);
      await pause.click({ trial: true });
      const a = await center.boundingBox(), b = await pause.boundingBox();
      expect(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y).toBe(true);
      // Unoccupied canvas still receives input, rather than the notice wrapper.
      expect(await screen.locator('#game').evaluate(el => {
        const r = el.getBoundingClientRect();
        return document.elementFromPoint(innerWidth / 2, Math.min(innerHeight * .65, r.bottom - 8)) === el;
      })).toBe(true);
      await close.tap();
      await expect(closeNotice).toHaveCount(0);
      await expect(actionNotice).toBeVisible();
      const action = actionNotice.getByRole('button', { name: '確認する' });
      await hitTarget(action);
      await action.tap();
      await expect(actionNotice).toHaveCount(0);
      await expect(page.locator('body')).toHaveAttribute('data-notice-action', 'done');
      await notify(page);
      const keyboardClose = center.locator('.notification', { hasText: '閉じる対象' }).getByRole('button', { name: '通知を閉じる' });
      await keyboardClose.focus();
      await expect(keyboardClose).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(center).not.toContainText('閉じる対象');
      await page.setViewportSize({ width: viewport.height, height: viewport.width });
      await expect(screen).toHaveAttribute('data-mobile-play', 'true');
      await hitTarget(center.getByRole('button', { name: '確認する' }));
      // Restore the original viewport so document scroll limits also match.
      await page.setViewportSize({ width: 390, height: 844 });
      await page.keyboard.press('Escape');
      await expect(screen).not.toHaveAttribute('data-mobile-play');
      expect(await page.evaluate(() => document.body.getAttribute('style'))).toBe(originalStyle);
      await expect(background).toBeFocused();
      expect(await page.evaluate(() => ({ x: scrollX, y: scrollY }))).toEqual(originalScroll);
      expect(await background.evaluate(el => el.closest('[inert]') === null)).toBe(true);
      expect(await page.locator('#previously-inert').evaluate(el => el.inert)).toBe(true);
    });
  }
}

test('spectator notifications remain interactive without mobile isolation', async ({ page }) => {
  const screen = await mount(page, 'buzz-barrier', 'spectator', 'playing');
  await notify(page);
  await expect(screen).not.toHaveAttribute('data-mobile-play');
  const close = page.locator('.notification', { hasText: '閉じる対象' }).getByRole('button', { name: '通知を閉じる' });
  await hitTarget(close);
  await close.tap();
  await expect(page.locator('.notification-center')).not.toContainText('閉じる対象');
});


test.describe('desktop notifications', () => {
  test.use({ hasTouch: false, isMobile: false, viewport: { width: 1280, height: 900 } });
  test('player keeps normal layout and keyboard notification actions', async ({ page }) => {
    const screen = await mount(page, 'buzz-barrier');
    await phase(page, 'buzz-barrier', 'playing');
    await expect(screen).not.toHaveAttribute('data-mobile-play');
    await notify(page);
    const center = page.getByRole('complementary', { name: '通知', exact: true });
    const action = center.getByRole('button', { name: '確認する' });
    await hitTarget(action);
    await action.focus();
    await page.keyboard.press('Enter');
    await expect(center).not.toContainText('アクション対象');
    const close = center.getByRole('button', { name: '通知を閉じる' });
    await close.click();
    await expect(center.locator('.notification')).toHaveCount(0);
  });
});
