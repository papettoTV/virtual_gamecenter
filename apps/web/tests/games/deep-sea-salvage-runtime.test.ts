import { afterEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { calculateFinalScore, MAX_HULL } from "../../src/games/deep-sea-salvage/core";
import { createState } from "../../src/games/deep-sea-salvage/state";
import { createSimulation } from "../../src/games/deep-sea-salvage/simulation";
import { createRenderer } from "../../src/games/deep-sea-salvage/renderer";
import { initTerrainEditor } from "../../src/games/deep-sea-salvage/terrain-editor";
import { DeepSeaThreeLayer } from "../../src/games/deep-sea-salvage/three-game-layer";
import { createDefaultTerrain } from "../../src/games/deep-sea-salvage/terrain";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function setup() {
  const state = createState(960, createDefaultTerrain());
  const input = { keys: new Set<string>(), pointer: { active: false, x: 0, y: 0 } };
  const effects = { updateButtons: vi.fn(), onFinish: vi.fn() };
  const simulation = createSimulation(state, {
    initialPower: 100, powerDrain: 1, rareRate2: 0, rareRate3: 0,
    researchScale: 1, bossStart: 4000, bossInterval: 4000,
  }, input, { width: 960, height: 640, horizontalBounds: () => [42, 918] }, effects);
  for (let chunk = 0; chunk < 40; chunk += 1) state.visitedChunks.add(chunk);
  return { state, input, effects, simulation };
}

describe("深海サルベージの分離されたシミュレーション", () => {
  it("状態のコレクションとボスをインスタンス間で共有しない", () => {
    const first = setup(); const second = setup();
    first.state.discovered.add("leviathan"); first.state.boss.active = true;
    expect(second.state.discovered.size).toBe(0);
    expect(second.state.boss.active).toBe(false);
    expect(first.state.fishes).not.toBe(second.state.fishes);
  });

  it("一時停止と図鑑表示では移動せずメッセージタイマーだけ進む", () => {
    const { state, simulation, input } = setup();
    input.keys.add("ArrowRight");
    simulation.startDive(); state.paused = true; simulation.update(.05);
    expect(state.subX).toBe(480); expect(state.elapsed).toBe(0); expect(state.messageTimer).toBe(2.95);
    state.paused = false; state.collectionOpen = true; simulation.update(.05);
    expect(state.subX).toBe(480); expect(state.power).toBe(100);
  });

  it("移動・電力消費の更新式を維持する", () => {
    const { state, simulation, input } = setup();
    input.keys.add("ArrowRight"); input.keys.add("ArrowDown");
    simulation.startDive(); simulation.update(.05);
    expect(state.subVx).toBeCloseTo(225 / Math.SQRT2 * .25);
    expect(state.subVDepth).toBeCloseTo(92 / Math.SQRT2 * .25);
    expect(state.subX).toBeCloseTo(480 + state.subVx * .05);
    expect(state.maxDepth).toBe(state.subDepth);
    expect(state.power).toBe(99.95);
  });

  it("調査完了で図鑑登録・報酬・電力を更新する", () => {
    const { state, simulation } = setup();
    state.power = 50;
    state.fishes.push({ id: 1, speciesId: "sun-sardine", x: 560, depth: 0, baseDepth: 0, vx: 0,
      phase: 0, research: .99, completed: false, flash: 0, completionEffect: 0,
      pattern: "cruise", activated: false, alertTimer: 0, inHollow: false, homeX: 560 });
    simulation.startDive(); simulation.update(.05);
    expect(state.fishes[0]?.completed).toBe(true);
    expect(state.discovered.has("sun-sardine")).toBe(true);
    expect(state.researchCounts.get("sun-sardine")).toBe(1);
    expect(state.earnedScore).toBe(720); expect(state.power).toBeCloseTo(52.15);
    expect(state.targetFishIds.size).toBe(0);
  });

  it("岩壁の衝突で大破し、演出終了後に一度だけ結果通知する", () => {
    const { state, simulation, effects } = setup();
    state.hull = 1;
    state.hazards.push({ id: 1, kind: "rock", x: 0, depth: 0, width: 500, height: 600, phase: 0, dangerous: false, side: -1 });
    simulation.startDive(); simulation.update(.05);
    expect(state.phase).toBe("hull-break"); expect(state.hull).toBe(0);
    simulation.update(3); simulation.update(.05);
    expect(state.phase).toBe("result"); expect(effects.onFinish).toHaveBeenCalledTimes(1);
    expect(effects.onFinish).toHaveBeenCalledWith("船体が大破した", 1);
  });

  it("ボス調査完了演出とスコアを維持する", () => {
    const { state, simulation, effects } = setup();
    state.bossProgress = 99.9; state.boss.active = true; state.boss.x = 480;
    state.invincible = 10; state.earnedScore = 420;
    simulation.startDive(); simulation.update(.05);
    expect(state.phase).toBe("boss-clear"); expect(state.discovered.has("leviathan")).toBe(true);
    simulation.update(5.8);
    const score = calculateFinalScore({ earnedScore: 420, cleared: true, remainingPower: state.power, retryCount: 0 });
    expect(state.finalScore).toBe(score.total); expect(state.cleared).toBe(true);
    expect(effects.onFinish).toHaveBeenCalledTimes(1);
  });

  it("リトライは調査実績を保持し、リセットは実績を消去する", () => {
    const { state, simulation } = setup();
    state.phase = "result"; state.subDepth = 800; state.maxDepth = 900;
    state.discovered.add("sun-sardine"); state.earnedScore = 720; state.power = 0;
    simulation.continueRun();
    expect(state.retryCount).toBe(1); expect(state.hull).toBe(MAX_HULL); expect(state.power).toBe(65);
    expect(state.earnedScore).toBe(720); expect(state.subDepth).toBe(800); expect(state.discovered.size).toBe(1);
    simulation.reset(createDefaultTerrain(), { startDepth: 500, hull: 2, bossProgress: 25, terrainPreview: false });
    expect(state.phase).toBe("ready"); expect(state.subDepth).toBe(500); expect(state.bossProgress).toBe(25);
    expect(state.discovered.size).toBe(0); expect(state.hull).toBe(2); expect(state.hazards.length).toBeGreaterThan(0);
  });
});

describe("深海サルベージのリソース解放", () => {
  it("Three.jsの共有資源・後処理・WebGLコンテキストを一度だけ解放する", () => {
    const geometry = new THREE.BoxGeometry(); const texture = new THREE.Texture();
    const material = new THREE.MeshStandardMaterial({ map: texture });
    const scene = new THREE.Scene(); scene.add(new THREE.Mesh(geometry, material), new THREE.Mesh(geometry, material));
    const geometryDispose = vi.spyOn(geometry, "dispose"); const materialDispose = vi.spyOn(material, "dispose"); const textureDispose = vi.spyOn(texture, "dispose");
    const renderer = { dispose: vi.fn(), forceContextLoss: vi.fn() };
    const pass = { dispose: vi.fn() }; const composer = { passes: [pass], dispose: vi.fn() };
    const layer = Object.assign(Object.create(DeepSeaThreeLayer.prototype), {
      disposed: false, scene, geometries: new Set(), materials: new Set(), textures: new Set(),
      rockMaterial: material, rockEdgeMaterial: material, kelpMaterial: material,
      cautionOutline: { selectedObjects: [] }, dangerOutline: { selectedObjects: [] }, composer, renderer,
      fishMeshes: new Map(), hazardMeshes: new Map(), fishTemplates: new Map(),
    }) as DeepSeaThreeLayer;
    layer.dispose(); layer.dispose();
    for (const spy of [geometryDispose, materialDispose, textureDispose, pass.dispose, composer.dispose, renderer.dispose, renderer.forceContextLoss]) expect(spy).toHaveBeenCalledTimes(1);
    expect(scene.children).toHaveLength(0);
  });

  it("描画器のdispose後に到着したThree.jsレイヤーも解放する", () => {
    const { state, simulation } = setup();
    const canvas = { width: 960, height: 640, getContext: () => ({}) } as unknown as HTMLCanvasElement;
    vi.stubGlobal("document", { createElement: () => ({ getContext: () => ({}) }) });
    vi.stubGlobal("Image", class { src = ""; });
    const renderer = createRenderer(canvas, state, simulation, new URLSearchParams(), () => false);
    const first = { dispose: vi.fn() } as unknown as DeepSeaThreeLayer;
    const late = { dispose: vi.fn() } as unknown as DeepSeaThreeLayer;
    renderer.setThreeLayer(first); renderer.dispose(); renderer.dispose(); renderer.setThreeLayer(late);
    expect(first.dispose).toHaveBeenCalledTimes(1); expect(late.dispose).toHaveBeenCalledTimes(1);
    expect(() => renderer.draw()).not.toThrow();
  });

  it("通常画面でも地形エディタの入口リスナーを解除する", () => {
    const button = new EventTarget(); const assign = vi.fn();
    vi.stubGlobal("document", { querySelector: () => button });
    vi.stubGlobal("window", { location: { href: "https://example.test/", search: "", assign } });
    const cleanup = initTerrainEditor();
    button.dispatchEvent(new Event("click")); expect(assign).toHaveBeenCalledTimes(1);
    cleanup(); cleanup(); button.dispatchEvent(new Event("click")); expect(assign).toHaveBeenCalledTimes(1);
  });

  it("エディタ画面の全リスナーと初期RAFを解除し表示状態を戻す", () => {
    const gradient = { addColorStop: vi.fn() };
    const clearRect = vi.fn();
    const context = new Proxy({ clearRect, createLinearGradient: () => gradient }, {
      get(target, property) { return property in target ? Reflect.get(target, property) : () => {}; },
    });
    const classList = { contains: () => false, add: vi.fn(), toggle: vi.fn() };
    const section = { hidden: true };
    const canvas = Object.assign(new EventTarget(), {
      width: 960, height: 12000, getContext: () => context,
      getBoundingClientRect: () => ({ height: 12000 }),
    });
    const overview = Object.assign(new EventTarget(), { checked: false });
    const preview = Object.assign(new EventTarget(), { value: "0" });
    const reset = new EventTarget();
    const elements = new Map<string, unknown>([
      ["#salvage-terrain-editor", section], ["#terrain-editor-canvas", canvas],
      ["#terrain-editor-json", { value: "" }], ["#terrain-editor-overview", overview],
      ["#terrain-editor-preview-depth", preview], ["#terrain-editor-reset", reset],
      [".terrain-editor-scroll", { scrollTop: 0, clientHeight: 600 }],
    ]);
    vi.stubGlobal("document", { querySelector: (selector: string) => elements.get(selector), querySelectorAll: () => [], body: { classList } });
    vi.stubGlobal("window", { location: { search: "?terrainEditor=1" } });
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 123));
    const cancel = vi.fn(); vi.stubGlobal("cancelAnimationFrame", cancel);
    const cleanup = initTerrainEditor();
    expect(section.hidden).toBe(false);
    reset.dispatchEvent(new Event("click")); expect(clearRect).toHaveBeenCalledTimes(2);
    cleanup(); cleanup(); reset.dispatchEvent(new Event("click")); overview.dispatchEvent(new Event("change"));
    expect(clearRect).toHaveBeenCalledTimes(2); expect(section.hidden).toBe(true);
    expect(cancel).toHaveBeenCalledExactlyOnceWith(123);
    expect(classList.toggle).toHaveBeenCalledWith("is-terrain-editor", false);
  });
});
