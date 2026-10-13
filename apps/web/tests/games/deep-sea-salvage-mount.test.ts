import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GameLifetime } from "../../src/game-sdk/lifetime";
import { gameHost } from "../../src/game-sdk/game-host";
import { DEEP_SEA_SALVAGE } from "../../src/domain/game";
import { mountGame } from "../../src/games/deep-sea-salvage/runtime";
import type { createState } from "../../src/games/deep-sea-salvage/state";
import { SPECIES } from "../../src/games/deep-sea-salvage/species";

const mocks = vi.hoisted(() => ({
  sessions: [] as Array<{ role: string; join: ReturnType<typeof vi.fn>; leave: ReturnType<typeof vi.fn>; send: ReturnType<typeof vi.fn>; startSolo: ReturnType<typeof vi.fn>; waitForPlayer: ReturnType<typeof vi.fn> }>,
  rendererDispose: vi.fn(), draw: vi.fn(), reset: vi.fn(), startDive: vi.fn(), continueRun: vi.fn(),
  editorCleanup: vi.fn(), renderers: [] as Array<{ dispose: ReturnType<typeof vi.fn>; setThreeLayer: ReturnType<typeof vi.fn> }>,
  createThreeLayer: vi.fn(), fetchRanking: vi.fn(async () => []),
  states: [] as Array<ReturnType<typeof createState>>,
  finishes: [] as Array<(title: string, multiplier: number) => void>,
  messages: [] as Array<(message: unknown) => void>,
  setResult: vi.fn(), clearResult: vi.fn(), setLiveContext: vi.fn(),
}));

vi.mock("../../src/game-sdk/cabinet-session", () => ({
  createCabinetSession: (options: { lifetime: GameLifetime; onMessage: (message: unknown) => void }) => {
    const session = {
      role: "visitor", join: vi.fn(), leave: vi.fn(), send: vi.fn(() => true), getBufferedAmount: () => 0,
      startSolo: vi.fn(async () => true),
      waitForPlayer: vi.fn(async () => { session.role = "player"; options.onMessage({ type: "joinedCabinet", role: "player" }); return true; }),
    };
    mocks.messages.push(options.onMessage);
    options.lifetime.own(session.leave); mocks.sessions.push(session); return session;
  },
}));
vi.mock("../../src/games/deep-sea-salvage/renderer", () => ({
  createRenderer: () => {
    let disposed = false;
    const renderer = {
      draw: mocks.draw, drawOverlay: vi.fn(), drawSpeciesPortrait: vi.fn(),
      dispose: vi.fn(() => { disposed = true; mocks.rendererDispose(); }),
      setThreeLayer: vi.fn((layer: { dispose: () => void }) => { if (disposed) layer.dispose(); }),
    };
    mocks.renderers.push(renderer); return renderer;
  },
}));
vi.mock("../../src/games/deep-sea-salvage/simulation", () => ({
  createSimulation: (state: ReturnType<typeof createState>, _config: unknown, _input: unknown, _geometry: unknown, hooks: { onFinish: (title: string, multiplier: number) => void }) => {
    mocks.states.push(state);
    mocks.finishes.push(hooks.onFinish);
    return { reset: mocks.reset, update: vi.fn(), ensureChunks: vi.fn(), startDive: mocks.startDive, continueRun: mocks.continueRun, setMessage: vi.fn() };
  },
}));
vi.mock("../../src/games/deep-sea-salvage/terrain-editor", () => ({ initTerrainEditor: () => mocks.editorCleanup }));
vi.mock("../../src/games/deep-sea-salvage/three-game-layer", () => ({ DeepSeaThreeLayer: { create: mocks.createThreeLayer } }));
vi.mock("../../src/features/notifications/notifications", () => ({ notifications: { show: vi.fn(), clearScope: vi.fn() } }));
vi.mock("../../src/features/notifications/share", () => ({ copySharedText: vi.fn() }));
vi.mock("../../src/features/sharing/result-sharing", () => ({
  resultSharing: { setResult: mocks.setResult, clear: mocks.clearResult },
}));
vi.mock("../../src/features/sharing/share-service", () => ({ setLiveContext: mocks.setLiveContext }));
vi.mock("../../src/features/engagement/engagement-client", () => ({ recordWatchStarted: vi.fn() }));
vi.mock("../../src/features/ranking/ranking-client", () => ({
  loadRankingWithNotice: async (_gameId: string, load: () => Promise<void>) => load(),
  fetchScoreRanking: mocks.fetchRanking, submitRankingEntry: vi.fn(),
}));

let windowTarget: EventTarget;
let canvas: EventTarget;
let frames: Map<number, FrameRequestCallback>;
let lifetime: GameLifetime;
let selectors: Map<string, unknown>;

beforeEach(() => {
  vi.clearAllMocks(); mocks.sessions.length = 0; mocks.renderers.length = 0; mocks.states.length = 0;
  mocks.finishes.length = 0; mocks.messages.length = 0;
  lifetime = new GameLifetime(); frames = new Map(); let nextFrame = 1;
  const classList = { toggle: vi.fn(), add: vi.fn(), remove: vi.fn() };
  canvas = Object.assign(new EventTarget(), { width: 960, height: 640, getContext: () => ({}), getBoundingClientRect: () => ({ width: 960, height: 640 }) });
  const cabinetScreen = { classList }; const rankingList = { innerHTML: "" };
  selectors = new Map<string, unknown>([["#game", canvas], ["#cabinet-screen", cabinetScreen], ["#ranking-list", rankingList]]);
  windowTarget = Object.assign(new EventTarget(), {
    location: { pathname: "/cabinets/current", search: "?renderer=2d", href: "https://example.test/cabinets/current" },
    setTimeout, clearTimeout, setInterval, clearInterval,
  });
  vi.stubGlobal("window", windowTarget);
  vi.stubGlobal("document", Object.assign(new EventTarget(), { hidden: false, querySelector: (selector: string) => selectors.get(selector) ?? null, body: { classList } }));
  vi.stubGlobal("history", { pushState: vi.fn() });
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { const id = nextFrame++; frames.set(id, callback); return id; });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
});
afterEach(() => { lifetime.dispose(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("深海サルベージのmount契約", () => {
  it("registers zero-score completed runs without ranking and uses a new ID after continue", async () => {
    const instance = mountGame({ game: DEEP_SEA_SALVAGE, lifetime });
    await instance.play("start", "reservation");
    const state = mocks.states[0]!;
    state.phase = "result"; state.elapsed = 0; state.finalScore = 0;
    state.maxDepth = 123; state.discovered = new Set([SPECIES[0]!.id]);
    mocks.finishes[0]!("Finished", 1);
    const first = mocks.setResult.mock.calls[0]![0];
    expect(first).toMatchObject({
      gameId: DEEP_SEA_SALVAGE.id, elapsedTimeMs: 1, score: 0, cleared: false,
      metrics: { maxDepth: 123, discoveredCount: 1, totalSpeciesCount: SPECIES.length, speciesIds: SPECIES[0]!.id },
    });
    mocks.clearResult.mockClear();
    await instance.play("retry", "reservation");
    expect(mocks.clearResult).toHaveBeenCalledWith(DEEP_SEA_SALVAGE.id);
    expect(mocks.clearResult.mock.invocationCallOrder[0]).toBeLessThan(mocks.continueRun.mock.invocationCallOrder[0]!);
    state.phase = "result";
    mocks.finishes[0]!("Finished again", 1);
    expect(mocks.setResult.mock.calls[1]![0].id).not.toBe(first.id);
    await instance.play("start", "reservation");
    expect(mocks.clearResult).toHaveBeenCalledWith(DEEP_SEA_SALVAGE.id);
    instance.dispose();
    expect(mocks.setLiveContext).toHaveBeenLastCalledWith(null);
    mocks.finishes[0]!("Stale", 1);
    expect(mocks.setResult).toHaveBeenCalledTimes(2);
  });

  it("clears on losing the seat and never attributes spectator state to the player", async () => {
    const instance = mountGame({ game: DEEP_SEA_SALVAGE, lifetime });
    await instance.play("start", "reservation");
    const state = mocks.states[0]!; state.phase = "result";
    mocks.finishes[0]!("Finished", 1);
    expect(mocks.setResult).toHaveBeenCalledTimes(1);
    mocks.messages[0]!({ type: "roleChanged", role: "spectator" });
    expect(mocks.clearResult).toHaveBeenCalledWith(DEEP_SEA_SALVAGE.id);
    mocks.finishes[0]!("Spectator result", 1);
    expect(mocks.setResult).toHaveBeenCalledTimes(1);
  });

  it("pauses before live sharing and suppresses game shortcuts inside the common share overlay", async () => {
    const instance = mountGame({ game: DEEP_SEA_SALVAGE, lifetime });
    await instance.play("start", "reservation");
    const state = mocks.states[0]!; state.phase = "dive"; state.paused = false;
    windowTarget.dispatchEvent(new Event("before-live-share"));
    expect(state.paused).toBe(true);
    selectors.set(".share-overlay", {});
    windowTarget.dispatchEvent(Object.assign(new Event("keydown"), { code: "KeyP" }));
    expect(state.paused).toBe(true);
    selectors.delete(".share-overlay");
    windowTarget.dispatchEvent(Object.assign(new Event("keydown"), { code: "KeyP" }));
    expect(state.paused).toBe(false);
  });

  it("importでは起動せず、mount後のdisposeでRAF・エディタ・描画・通信を解放する", () => {
    expect(mocks.sessions).toHaveLength(0);
    const instance = mountGame({ game: DEEP_SEA_SALVAGE, lifetime });
    expect(frames.size).toBe(1); expect(mocks.sessions[0]?.join).toHaveBeenCalledWith("current", DEEP_SEA_SALVAGE.id, true);
    instance.dispose(); instance.dispose();
    expect(frames.size).toBe(0); expect(mocks.rendererDispose).toHaveBeenCalledTimes(1);
    expect(mocks.editorCleanup).toHaveBeenCalledTimes(1); expect(mocks.sessions[0]?.leave).toHaveBeenCalledTimes(1);
    windowTarget.dispatchEvent(new Event("keydown"));
  });

  it("既存player筐体でprepareSoloを繰り返してもUUIDやjoinを増やさない", async () => {
    const instance = mountGame({ game: DEEP_SEA_SALVAGE, lifetime });
    const session = mocks.sessions[0]!; session.role = "player";
    await instance.prepareSolo?.(); await instance.prepareSolo?.();
    expect(session.join).toHaveBeenCalledTimes(1); expect(history.pushState).not.toHaveBeenCalled();
    expect(await instance.play("start", "reservation")).toBe(true); expect(session.startSolo).toHaveBeenCalledWith("reservation");
  });

  it("player確定前のdisposeはplayをfalseにしてゲームを開始しない", async () => {
    const instance = mountGame({ game: DEEP_SEA_SALVAGE, lifetime });
    let resolveReady!: (value: boolean) => void;
    mocks.sessions[0]!.waitForPlayer.mockImplementation(() => new Promise<boolean>(resolve => { resolveReady = resolve; }));
    const pending = instance.play("start", "reservation"); instance.dispose(); resolveReady(true);
    expect(await pending).toBe(false); expect(mocks.sessions[0]?.send).not.toHaveBeenCalled();
    expect(await instance.play("retry", "reservation")).toBe(false);
  });

  it("旧ネイティブソロ・リトライイベントではゲームを開始しない", () => {
    const startButton = new EventTarget(); const retryButton = new EventTarget();
    selectors.set("#start-solo", startButton); selectors.set("#ranking-retry", retryButton);
    mountGame({ game: DEEP_SEA_SALVAGE, lifetime });
    startButton.dispatchEvent(new Event("click")); retryButton.dispatchEvent(new Event("click"));
    windowTarget.dispatchEvent(new Event("platform-play-approved")); windowTarget.dispatchEvent(new Event("create-solo-cabinet"));
    expect(mocks.sessions[0]?.send).not.toHaveBeenCalled(); expect(mocks.continueRun).not.toHaveBeenCalled();
  });

  it("KeyRは親GameHostにリトライを要求し、dispose後は要求しない", () => {
    const instance = mountGame({ game: DEEP_SEA_SALVAGE, lifetime });
    const request = vi.spyOn(gameHost, "requestPlay"); mocks.states[0]!.phase = "result";
    const press = () => windowTarget.dispatchEvent(Object.assign(new Event("keydown"), { code: "KeyR" }));
    press(); expect(request).toHaveBeenCalledExactlyOnceWith("retry");
    expect(mocks.continueRun).not.toHaveBeenCalled(); instance.dispose(); press(); expect(request).toHaveBeenCalledTimes(1);
  });

  it("筐体IDのない経路だけ新しいUUIDを用意し、playでは再joinしない", async () => {
    (windowTarget as unknown as { location: { pathname: string } }).location.pathname = "/";
    const instance = mountGame({ game: DEEP_SEA_SALVAGE, lifetime }); await instance.prepareSolo?.();
    expect(history.pushState).toHaveBeenCalledTimes(1); expect(mocks.sessions[0]?.join).toHaveBeenCalledTimes(1);
    expect(await instance.play("start", "reservation")).toBe(true); expect(mocks.sessions[0]?.join).toHaveBeenCalledTimes(1);
  });

  it("dispose後の非同期Three.jsロード結果を解放する", async () => {
    (windowTarget as unknown as { location: { search: string } }).location.search = "";
    let finishLoad!: (layer: { dispose: ReturnType<typeof vi.fn> }) => void;
    mocks.createThreeLayer.mockImplementation(() => new Promise(resolve => { finishLoad = resolve; }));
    const instance = mountGame({ game: DEEP_SEA_SALVAGE, lifetime });
    await vi.waitFor(() => expect(mocks.createThreeLayer).toHaveBeenCalled());
    instance.dispose(); const layer = { dispose: vi.fn() }; finishLoad(layer);
    await vi.waitFor(() => expect(layer.dispose).toHaveBeenCalledTimes(1));
  });

  it("dispose後のランキング応答で古いDOMを書き換えない", async () => {
    let finishRanking!: (entries: []) => void;
    mocks.fetchRanking.mockImplementationOnce(() => new Promise(resolve => { finishRanking = resolve; }));
    const instance = mountGame({ game: DEEP_SEA_SALVAGE, lifetime }); instance.dispose(); finishRanking([]);
    await Promise.resolve(); await Promise.resolve();
    expect((selectors.get("#ranking-list") as { innerHTML: string }).innerHTML).toBe("");
  });
});
