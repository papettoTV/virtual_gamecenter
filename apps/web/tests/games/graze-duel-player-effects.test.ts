import { afterEach, expect, it, vi } from "vitest";
import * as THREE from "three";
import { createLightningPaths, drawLevelUpLightning, drawPlayerShield, LEVEL_UP_FLASH_DURATION, LIGHTNING_PATTERNS, lightningOpacity, pickLightningPattern, shieldAppearance } from "../../src/games/graze-duel/rendering/player-effects";
import { createPlayerEffects } from "../../src/games/graze-duel/rendering/three-player-effects";
import type { PlayerRenderState } from "../../src/games/graze-duel/rendering/scene-renderer";

function brush() {
  return {
    globalAlpha: 1, fillStyle: "", strokeStyle: "", lineWidth: 1, shadowBlur: 0, shadowColor: "",
    save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), closePath: vi.fn(), arc: vi.fn(), fill: vi.fn(), stroke: vi.fn(),
    moveTo: vi.fn(), lineTo: vi.fn(), translate: vi.fn(), rect: vi.fn(), clip: vi.fn(),
    createRadialGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
  };
}
const asContext = (context: ReturnType<typeof brush>) => context as unknown as CanvasRenderingContext2D;
const player: PlayerRenderState = {
  fieldX: 0, x: 100, y: 100, color: "#69f7ff", tilt: 0, invincible: 1,
  levelUpInvincible: 1, barrierRatio: 1, levelUpFlash: LEVEL_UP_FLASH_DURATION, bullets: [],
};
const field = { left: 0, right: 390, top: 0, bottom: 500 };
afterEach(() => vi.unstubAllGlobals());

it("3方向に伸び、約30msでプレイ領域の端に到達して消える", () => {
  const local = { left: -100, right: 290, top: -100, bottom: 400 };
  const opening = createLightningPaths(local, LEVEL_UP_FLASH_DURATION).filter(path => path.length > 4);
  const peak = createLightningPaths(local, LEVEL_UP_FLASH_DURATION - 0.04).filter(path => path.length > 4);
  expect(opening).toHaveLength(3);
  expect(peak).toHaveLength(3);
  for (const path of peak) expect(Math.hypot(path[0]!.x, path[0]!.y)).toBe(0);
  expect(peak[0]!.at(-1)!.y).toBeLessThan(local.top);
  expect(peak[1]!.at(-1)!.x).toBeGreaterThan(local.right);
  expect(peak[2]!.at(-1)!.x).toBeLessThan(local.left);
  expect(opening[1]!.at(-1)!.x).toBeLessThan(local.right);
  expect(lightningOpacity(LEVEL_UP_FLASH_DURATION - 0.1)).toBe(1);
  expect(lightningOpacity(0.02)).toBeLessThan(0.05);
  expect(createLightningPaths(local, 0)).toEqual([]);
  const active = brush();
  drawLevelUpLightning(asContext(active), 100, 100, field, LEVEL_UP_FLASH_DURATION - 0.04);
  expect(active.rect).toHaveBeenCalledWith(0, 0, 390, 500);
  expect(active.clip).toHaveBeenCalledOnce();
  expect(active.fill).toHaveBeenCalled();
  const inactive = brush();
  drawLevelUpLightning(asContext(inactive), 100, 100, field, 0);
  expect(inactive.fill).not.toHaveBeenCalled();
});

it("稲妻10パターンの3方向は互いに離れ、一部のパターンは短い枝ではなく短い主雷を持つ", () => {
  expect(LIGHTNING_PATTERNS).toHaveLength(10);
  const bounds = { left: -200, right: 200, top: -200, bottom: 200 };
  let mixedLengths = 0;
  for (const [index, pattern] of LIGHTNING_PATTERNS.entries()) {
    const main = createLightningPaths(bounds, LEVEL_UP_FLASH_DURATION - 0.04, index).filter(path => path.length > 4);
    expect(main).toHaveLength(3);
    const angles = main.map(path => {
      const point = path.at(-1)!;
      return Math.atan2(point.y, point.x) * 180 / Math.PI;
    });
    for (const [bolt, angle] of angles.entries()) {
      const gap = (angles[(bolt + 1) % 3]! - angle + 360) % 360;
      expect(gap).toBeGreaterThanOrEqual(75);
      const tip = main[bolt]!.at(-1)!;
      const extent = Math.max(Math.abs(tip.x), Math.abs(tip.y));
      if (pattern[bolt]![1] === 1) expect(extent).toBeGreaterThan(200);
      else expect(extent).toBeLessThan(160);
    }
    if (pattern.some(([, ratio]) => ratio < 1)) mixedLengths += 1;
  }
  expect(mixedLengths).toBe(4);
  expect(createLightningPaths(bounds, 0.25, 99)).toEqual(createLightningPaths(bounds, 0.25, 0));
});

it("初回は10通り、次のレベルアップは直前以外の9通りから選ぶ", () => {
  const options = (previous: number | null) => Array.from({ length: previous === null ? 10 : 9 },
    (_, index) => pickLightningPattern(previous, (index + 0.5) / (previous === null ? 10 : 9)));
  expect(options(null)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  for (const previous of options(null)) {
    expect(options(previous)).toEqual(options(null).filter(index => index !== previous));
  }
});

it("共有シールドは外側ほど透明になる単一の膜だけを描き縮小と透明点滅を維持する", () => {
  const context = brush();
  drawPlayerShield(asContext(context), 0, 0, 46);
  expect(context.createRadialGradient.mock.results[0]!.value.addColorStop.mock.calls).toEqual([
    [0, "rgba(255, 253, 255, 1)"], [0.36, "rgba(248, 241, 255, 0.98)"],
    [0.62, "rgba(185, 146, 255, 0.93)"], [0.81, "rgba(126, 84, 255, 0.72)"],
    [0.94, "rgba(106, 69, 255, 0.32)"], [1, "rgba(106, 69, 255, 0)"],
  ]);
  expect(context.createRadialGradient).toHaveBeenCalledOnce();
  expect(context.fill).toHaveBeenCalledOnce();
  expect(context.arc).toHaveBeenCalledWith(0, 0, 46, 0, Math.PI * 2);
  expect(context.moveTo).not.toHaveBeenCalled();
  expect(context.stroke).not.toHaveBeenCalled();
  expect(shieldAppearance(1, 1, 0).radius - shieldAppearance(0, 1, 0).radius).toBe(28);
  expect(shieldAppearance(0, 0.5, 0).opacity).toBe(0.28);
  expect(shieldAppearance(0, 0.5, 1 / 18).opacity).toBe(1);
  expect(shieldAppearance(0, 0.51, 0).opacity).toBe(1);
});

it("Three.js は描画バッファを再利用し、稲妻が消えた後もシールドを維持する", () => {
  const canvas = brush();
  const createElement = vi.fn(() => ({ getContext: () => canvas }));
  vi.stubGlobal("document", { createElement });
  const effects = createPlayerEffects();
  const ship = new THREE.Group();
  ship.position.set(-200, 150, 0);
  ship.scale.setScalar(0.9);
  ship.add(effects.root);
  const lightning = effects.root.children.slice(1) as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>[];
  const meshes = lightning.map(mesh => mesh.geometry.getAttribute("position"));
  expect(lightning).toHaveLength(3);
  expect(effects.shield.renderOrder).toBeGreaterThan(4);
  expect(lightning.every(mesh => !mesh.visible)).toBe(true);
  effects.update(player, 0, 390, 0, 500);
  expect(lightning.every(mesh => mesh.visible && mesh.geometry.drawRange.count > 0)).toBe(true);
  expect(lightning[2]!.material.clippingPlanes?.map(plane => plane.constant)).toEqual([290, 61, 240, 210]);
  expect(lightning[2]!.material.color.getHexString()).toBe("fffaff");
  effects.update({ ...player, levelUpFlash: 0.02 }, 0.1, 390, 0, 500);
  expect(lightning[2]!.material.opacity).toBeLessThan(0.05);
  expect(lightning.map(mesh => mesh.geometry.getAttribute("position"))).toEqual(meshes);
  expect(createElement).toHaveBeenCalledOnce();
  effects.update({ ...player, levelUpFlash: 0, levelUpInvincible: 0.1, barrierRatio: 0 }, 0, 390, 0, 500);
  expect(lightning.every(mesh => !mesh.visible)).toBe(true);
  expect(effects.shield.visible).toBe(true);
  expect(effects.shield.scale.x).toBe(shieldAppearance(0, 0.1, 0).radius);
  expect(effects.shield.material.opacity).toBe(0.28);
  const disposeGeometry = vi.spyOn(lightning[0]!.geometry, "dispose");
  const shieldTexture = vi.spyOn(effects.shield.material.map!, "dispose");
  effects.dispose();
  expect(disposeGeometry).toHaveBeenCalledOnce();
  expect(shieldTexture).toHaveBeenCalledOnce();
  expect(effects.root.children).toHaveLength(0);
});
