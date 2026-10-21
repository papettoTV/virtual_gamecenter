import { afterEach, expect, it, vi } from "vitest";
import * as THREE from "three";
import { drawLevelUpLightning, drawPlayerShield, lightningFrame, shieldAppearance } from "../../src/games/graze-duel/rendering/player-effects";
import { createPlayerEffects } from "../../src/games/graze-duel/rendering/three-player-effects";
import type { PlayerRenderState } from "../../src/games/graze-duel/rendering/scene-renderer";

function brush() {
  return {
    globalAlpha: 1, fillStyle: "", strokeStyle: "", lineWidth: 1, shadowBlur: 0, shadowColor: "",
    save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), arc: vi.fn(), fill: vi.fn(), stroke: vi.fn(),
    moveTo: vi.fn(), lineTo: vi.fn(), translate: vi.fn(), rect: vi.fn(), clip: vi.fn(),
    createRadialGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
  };
}
const asContext = (context: ReturnType<typeof brush>) => context as unknown as CanvasRenderingContext2D;
const player: PlayerRenderState = {
  fieldX: 0, x: 100, y: 100, color: "#69f7ff", tilt: 0, invincible: 1,
  levelUpInvincible: 1, barrierRatio: 1, levelUpFlash: 0.42, bullets: [],
};
afterEach(() => vi.unstubAllGlobals());

it("稲妻のフレーム上下限・10本各7節・決定性・終了を維持する", () => {
  expect([2, 0.42, 0.21, 0.001, 0, -1].map(lightningFrame)).toEqual([0, 0, 13, 25, 25, 25]);
  const a = brush();
  const b = brush();
  drawLevelUpLightning(asContext(a), 128, 128, player.color, 0.3);
  drawLevelUpLightning(asContext(b), 128, 128, player.color, 0.3);
  expect(a.moveTo).toHaveBeenCalledTimes(10);
  expect(a.lineTo).toHaveBeenCalledTimes(70);
  expect(a.lineTo.mock.calls).toEqual(b.lineTo.mock.calls);
  expect(a.stroke).toHaveBeenCalledTimes(11);
  expect(a.arc).toHaveBeenCalledTimes(2);
  const empty = brush();
  for (const remaining of [0, -1]) drawLevelUpLightning(asContext(empty), 0, 0, player.color, remaining);
  expect(empty.save).not.toHaveBeenCalled();
});

it("共有シールドは透明膜だけを描き縮小と透明点滅を維持する", () => {
  const context = brush();
  drawPlayerShield(asContext(context), 0, 0, 46);
  expect(context.createRadialGradient.mock.results[0]!.value.addColorStop.mock.calls).toEqual([
    [0, "rgba(105, 247, 255, 0.46)"], [0.48, "rgba(105, 247, 255, 0.28)"], [1, "rgba(105, 247, 255, 0.12)"],
  ]);
  expect(context.stroke).not.toHaveBeenCalled();
  expect(shieldAppearance(1, 1, 0).radius - shieldAppearance(0, 1, 0).radius).toBe(28);
  expect(shieldAppearance(0, 0.5, 0).opacity).toBe(0.28);
  expect(shieldAppearance(0, 0.5, 1 / 18).opacity).toBe(1);
  expect(shieldAppearance(0, 0.51, 0).opacity).toBe(1);
});

it("Three.jsは共有Canvasアトラスを再利用してUV更新し色変更・終了・破棄時に解放する", () => {
  const contexts: ReturnType<typeof brush>[] = [];
  const canvases: { width: number; height: number; getContext: () => ReturnType<typeof brush> }[] = [];
  vi.stubGlobal("document", { createElement: () => {
    const context = brush();
    contexts.push(context);
    const canvas = { width: 0, height: 0, getContext: () => context };
    canvases.push(canvas);
    return canvas;
  } });
  const effects = createPlayerEffects();
  expect(contexts[0]!.createRadialGradient).toHaveBeenCalledOnce();
  effects.update(player, 0);
  const lightning = effects.root.children[1] as THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  const texture = lightning.material.map!;
  expect(canvases[1]).toMatchObject({ width: 1536, height: 1280 });
  expect(contexts[1]!.moveTo).toHaveBeenCalledTimes(260);
  expect(contexts[1]!.lineTo).toHaveBeenCalledTimes(1820);
  expect(lightning.renderOrder).toBe(3.5);
  expect(effects.shield.renderOrder).toBe(3);
  expect(lightning.material.blending).toBe(THREE.NormalBlending);
  expect(effects.shield.material.blending).toBe(THREE.NormalBlending);
  expect(texture.colorSpace).toBe(THREE.SRGBColorSpace);
  expect(effects.shield.material.map!.colorSpace).toBe(THREE.SRGBColorSpace);
  expect(texture.offset.toArray()).toEqual([0, 0.8]);
  const version = texture.version;
  const disposeTexture = vi.spyOn(texture, "dispose");
  const disposeMaterial = vi.spyOn(lightning.material, "dispose");
  const disposeGeometry = vi.spyOn(lightning.geometry, "dispose");
  effects.update({ ...player, levelUpFlash: 0.001 }, 0.1);
  expect(texture.offset.toArray()).toEqual([1 / 6, 0]);
  expect(texture.version).toBe(version);
  expect(canvases).toHaveLength(2);
  expect(contexts[1]!.moveTo).toHaveBeenCalledTimes(260);
  effects.update({ ...player, color: "#ff3355" }, 0.2);
  for (const spy of [disposeTexture, disposeMaterial, disposeGeometry]) expect(spy).toHaveBeenCalledOnce();
  const replacement = effects.root.children[1] as typeof lightning;
  const endTexture = vi.spyOn(replacement.material.map!, "dispose");
  const endMaterial = vi.spyOn(replacement.material, "dispose");
  const endGeometry = vi.spyOn(replacement.geometry, "dispose");
  effects.update({ ...player, levelUpFlash: 0, levelUpInvincible: 0.1, barrierRatio: 0 }, 0);
  expect(effects.root.children).toHaveLength(1);
  expect(effects.shield.visible).toBe(true);
  expect(effects.shield.scale.x).toBe(shieldAppearance(0, 0.1, 0).radius);
  expect(effects.shield.material.opacity).toBe(0.28);
  for (const spy of [endTexture, endMaterial, endGeometry]) expect(spy).toHaveBeenCalledOnce();
  effects.update({ ...player, levelUpFlash: -1, levelUpInvincible: 0 }, 0);
  expect(effects.shield.visible).toBe(false);
  effects.update(player, 0);
  const final = effects.root.children[1] as typeof lightning;
  const finalTexture = vi.spyOn(final.material.map!, "dispose");
  const shieldTexture = vi.spyOn(effects.shield.material.map!, "dispose");
  effects.dispose();
  expect(finalTexture).toHaveBeenCalledOnce();
  expect(shieldTexture).toHaveBeenCalledOnce();
  expect(effects.root.children).toHaveLength(0);
});
