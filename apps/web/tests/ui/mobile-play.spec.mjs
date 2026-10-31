import { test, expect } from '../../../../ci/ui-fixtures.mjs';

// Exercise the real UI and sharing store without replacing authentication,
// credits, or game-start APIs. Actual game input still needs device acceptance.
async function mount(page, gameId, role = 'player') {
  await page.goto('http://127.0.0.1:5174/');
  await page.evaluate(async ({ gameId, role }) => {
    // Direct browser imports receive Vite's CommonJS default export; they do
    // not get the named-import interop that Vite applies to source modules.
    const { default: React } = await import('/node_modules/.vite/deps/react.js');
    const { default: ReactDOMClient } = await import('/node_modules/.vite/deps/react-dom_client.js');
    const { GameScreen } = await import('/src/features/game/GameScreen.tsx');
    const { getGameDefinition } = await import('/src/domain/game.ts');
    const { setLiveContext } = await import('/src/features/sharing/share-service.ts');
    const host = document.createElement('main');
    host.id = 'presentation-fixture'; document.body.append(host);
    ReactDOMClient.createRoot(host).render(React.createElement(GameScreen, { game: getGameDefinition(gameId) }));
    setLiveContext({ gameId, cabinetId: 'presentation-only', role, phase: 'ready' });
  }, { gameId, role });
  const screen = page.locator('#presentation-fixture #game-screen');
  await expect(screen).toBeAttached();
  await screen.evaluate(el => el.classList.remove('is-hidden'));
  return screen;
}
async function phase(page, gameId, phase, role = 'player') {
  await page.evaluate(async context => {
    (await import('/src/features/sharing/share-service.ts')).setLiveContext(context);
  }, { gameId, cabinetId: 'presentation-only', role, phase });
}

for (const viewport of [{ width: 390, height: 844 }, { width: 412, height: 915 }]) {
  test(`mobile viewport, invitation, rotation and restoration ${viewport.width}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const screen = await mount(page, 'graze-duel');
    const invite = screen.getByRole('button', { name: '観戦に招待', exact: true });
    const frame = await screen.locator('.game-frame').boundingBox();
    await expect(invite).toBeVisible();
    expect((await invite.boundingBox()).y).toBeGreaterThanOrEqual(frame.y + frame.height);
    await invite.click();
    await expect(page.getByRole('dialog', { name: '観戦に招待', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '× 閉じる' }).click();
    await phase(page, 'graze-duel', 'playing');
    await expect(screen).toHaveAttribute('data-mobile-play', 'true');
    await expect(screen.locator('.ranking-panel')).toBeHidden();
    const rect = await screen.boundingBox();
    expect(rect.x).toBe(0); expect(rect.y).toBe(0);
    expect(rect.width).toBe(viewport.width); expect(rect.height).toBe(viewport.height);
    expect(await screen.evaluate(el => getComputedStyle(el).userSelect)).toBe('none');
    expect(await screen.evaluate(el => !el.dispatchEvent(new MouseEvent('contextmenu', { cancelable: true })))).toBe(true);
    const scroll = await page.evaluate(() => scrollY);
    await page.mouse.move(100, 200); await page.mouse.wheel(0, 400);
    expect(await page.evaluate(() => scrollY)).toBe(scroll);
    await page.setViewportSize({ width: viewport.height, height: viewport.width });
    await expect(screen).toHaveAttribute('data-mobile-play', 'true');
    const canvas = await screen.locator('#game').boundingBox();
    const exit = screen.getByRole('button', { name: '通常表示に戻る' });
    await expect(exit).toBeVisible();
    expect(canvas.height).toBeGreaterThan(0);
    expect(canvas.y + canvas.height).toBeLessThanOrEqual((await exit.boundingBox()).y);
    await exit.click();
    await expect(screen).not.toHaveAttribute('data-mobile-play');
    expect(await page.evaluate(() => document.body.style.position)).not.toBe('fixed');
    // Return to portrait to offer mobile entry again on fine-pointer projects.
    // The rotated presentation and its exit were verified above.
    await page.setViewportSize(viewport);
    await phase(page, 'graze-duel', 'paused'); await phase(page, 'graze-duel', 'playing');
    await expect(screen).not.toHaveAttribute('data-mobile-play');
    await screen.getByRole('button', { name: '全画面でプレイ' }).click();
    await page.keyboard.press('Escape');
    await expect(screen).not.toHaveAttribute('data-mobile-play');
    await screen.getByRole('button', { name: '全画面でプレイ' }).click();
    await phase(page, 'graze-duel', 'finished');
    await expect(screen).not.toHaveAttribute('data-mobile-play');
    await expect(screen.locator('.ranking-panel')).toBeVisible();
    expect(await page.evaluate(() => document.querySelector('#root')?.inert ?? false)).toBe(false);
  });
}

test('desktop and spectator keep the regular page', async ({ page, isMobile }) => {
  test.skip(isMobile, 'PCのポインター条件で確認する');
  await page.setViewportSize({ width: 1280, height: 900 });
  const screen = await mount(page, 'graze-duel');
  await phase(page, 'graze-duel', 'playing');
  await expect(screen).not.toHaveAttribute('data-mobile-play');
  await phase(page, 'graze-duel', 'playing', 'spectator');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(screen).not.toHaveAttribute('data-mobile-play');
});
for (const gameId of ['deep-sea-salvage']) {
  test(`shared presentation restores on leaving ${gameId}`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const screen = await mount(page, gameId);
    await phase(page, gameId, 'playing');
    await expect(screen).toHaveAttribute('data-mobile-play', 'true');
    await page.evaluate(async () => (await import('/src/features/sharing/share-service.ts')).setLiveContext(null));
    await expect(screen).not.toHaveAttribute('data-mobile-play');
    expect(await page.evaluate(() => document.body.style.position)).not.toBe('fixed');
  });
}
