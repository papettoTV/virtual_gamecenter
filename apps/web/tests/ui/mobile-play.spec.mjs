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

// Local rendering/input fixtures use production renderers, simulation and input
// conversion. They do not pretend to cover authenticated start or cabinet APIs.
for (const gameId of ['graze-duel', 'deep-sea-salvage']) {
  test(`real rendering and canvas input in portrait and landscape: ${gameId}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const screen = await mount(page, gameId);
    await phase(page, gameId, 'playing');
    await expect(screen).toHaveAttribute('data-mobile-play', 'true');
    await page.evaluate(async gameId => {
      const canvas = document.querySelector('#presentation-fixture #game');
      if (gameId === 'graze-duel') {
        const { createThreeGameRenderer } = await import('/src/games/graze-duel/rendering/three-game-renderer.ts');
        const renderer = createThreeGameRenderer(960, 640);
        renderer.mount(canvas.parentElement, canvas);
        const player = { fieldX: 0, x: 240, y: 420, color: '#00ffff', tilt: 0, invincible: 0,
          levelUpInvincible: 0, barrierRatio: 0, levelUpFlash: 0,
          bullets: [{ id: 1, x: 240, y: 250, vx: 0, vy: 0, radius: 18,
            color: '#ff0000', age: 0, type: 'normal', shape: 'circle' }] };
        const boss = { active: false, phaseIndex: 0, x: 0, y: 0, radius: 0, hp: 0,
          flash: 0, encounterState: '', arrivalProgress: 0 };
        window.renderFixture = () => {
          const ctx = canvas.getContext('2d');
          ctx.clearRect(0, 0, 960, 640);
          // Crosshair in the base image and bullet in the real WebGL layer
          // must share a display transform, including letterbox margins.
          ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2;
          ctx.strokeRect(215, 225, 50, 50);
          renderer.render({ players: [player], boss, opponentBoss: boss, particles: [] }, 1,
            { compact: false, selectedPlayerIndex: 0, fieldTop: 0, fieldBottom: 640,
              fieldWidth: 480, gpuReplay: false, revision: 1 });
          const overlay = canvas.parentElement.querySelector('[data-three-game-renderer]');
          const copy = document.createElement('canvas'); copy.width = 960; copy.height = 640;
          const pixels = copy.getContext('2d'); pixels.drawImage(overlay, 0, 0);
          const pixel = [...pixels.getImageData(240, 250, 1, 1).data];
          return { pixel, baseFit: getComputedStyle(canvas).objectFit,
            overlayFit: getComputedStyle(overlay).objectFit,
            baseRect: canvas.getBoundingClientRect().toJSON(),
            overlayRect: overlay.getBoundingClientRect().toJSON() };
        };
      } else {
        const { createState } = await import('/src/games/deep-sea-salvage/state.ts');
        const { createDefaultTerrain } = await import('/src/games/deep-sea-salvage/terrain.ts');
        const { createSimulation } = await import('/src/games/deep-sea-salvage/simulation.ts');
        const { createRenderer } = await import('/src/games/deep-sea-salvage/renderer.ts');
        const { updateCanvasPointer } = await import('/src/games/deep-sea-salvage/canvas-pointer.ts');
        const state = createState(960, createDefaultTerrain());
        const input = { keys: new Set(), pointer: { active: false, x: 0, y: 0 } };
        const simulation = createSimulation(state, { initialPower: 100, powerDrain: 1,
          rareRate2: 0, rareRate3: 0, researchScale: 1, bossStart: 4000, bossInterval: 4000 },
          input, { width: 960, height: 640, horizontalBounds: () => [42, 918] },
          { updateButtons() {}, onFinish() {} });
        const renderer = createRenderer(canvas, state, simulation, new URLSearchParams(), () => false);
        canvas.addEventListener('pointerdown', event => updateCanvasPointer(canvas, input.pointer, event, true));
        canvas.addEventListener('pointermove', event => {
          if (input.pointer.active) updateCanvasPointer(canvas, input.pointer, event);
        });
        window.addEventListener('pointerup', () => { input.pointer.active = false; });
        simulation.startDive();
        window.renderFixture = () => {
          const before = { x: state.subX, depth: state.subDepth };
          simulation.update(.05); renderer.draw();
          return { pointer: { ...input.pointer }, before, x: state.subX, depth: state.subDepth };
        };
      }
    }, gameId);
    for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
      await page.setViewportSize(viewport);
      await expect(screen).toHaveAttribute('data-mobile-play', 'true');
      if (gameId === 'graze-duel') {
        const result = await page.evaluate(() => window.renderFixture());
        expect(result.pixel[0]).toBeGreaterThan(100);
        expect(result.pixel[3]).toBeGreaterThan(0);
        expect(result.baseFit).toBe('contain');
        expect(result.overlayFit).toBe(result.baseFit);
        for (const key of ['x', 'y', 'width', 'height']) {
          expect(result.overlayRect[key]).toBeCloseTo(result.baseRect[key], 0);
        }
      } else {
        const rect = await screen.locator('#game').boundingBox();
        const scale = Math.min(rect.width / 960, rect.height / 640);
        const left = rect.x + (rect.width - 960 * scale) / 2;
        const top = rect.y + (rect.height - 640 * scale) / 2;
        // The same image point must steer down and right in either orientation.
        await page.mouse.move(left + 480 * scale, top + 365 * scale);
        await page.mouse.down();
        await page.mouse.move(left + 560 * scale, top + 440 * scale);
        const result = await page.evaluate(() => window.renderFixture());
        expect(result.pointer.active).toBe(true);
        expect(result.pointer.x).toBeCloseTo(560, 0);
        expect(result.pointer.y).toBeCloseTo(440, 0);
        expect(result.x).toBeGreaterThan(result.before.x);
        expect(result.depth).toBeGreaterThan(result.before.depth);
        await page.mouse.up();
        const released = await page.evaluate(() => window.renderFixture());
        expect(released.pointer.active).toBe(false);
        // Letterbox taps must not activate movement.
        await page.mouse.move(rect.x + 1, rect.y + 1);
        await page.mouse.down();
        expect((await page.evaluate(() => window.renderFixture())).pointer.active).toBe(false);
        await page.mouse.up();
      }
      await testInfo.attach(`${gameId}-${viewport.width}-playing`, {
        body: await page.screenshot(), contentType: 'image/png',
      });
    }
    await screen.getByRole('button', { name: '通常表示に戻る' }).click();
    await expect(screen).not.toHaveAttribute('data-mobile-play');
  });
}
