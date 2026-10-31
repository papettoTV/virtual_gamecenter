import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GameLifetime } from "../../src/game-sdk/lifetime";
import { mountGame } from "../../src/games/graze-duel/runtime";
import { createInputController } from "../../src/games/graze-duel/input";
import { createGrazeAudio } from "../../src/games/graze-duel/audio";
import { BUZZ_BARRIER } from "../../src/domain/game";
import type { createGameState } from "../../src/games/graze-duel/state";

const mocks = vi.hoisted(() => ({
  leave: vi.fn(), send: vi.fn(), rendererDispose: vi.fn(), requestPlay: vi.fn(),
  setResult: vi.fn(), clearResult: vi.fn(), setLiveContext: vi.fn(), overlay: false,
  state: null as ReturnType<typeof createGameState> | null,
}));
vi.mock("../../src/games/graze-duel/state", async importOriginal => {
  const original = await importOriginal<typeof import("../../src/games/graze-duel/state")>();
  return { ...original, createGameState: (...args: Parameters<typeof original.createGameState>) => {
    mocks.state = original.createGameState(...args);
    return mocks.state;
  } };
});
vi.mock("../../src/features/sharing/result-sharing", () => ({
  resultSharing: { setResult: mocks.setResult, clear: mocks.clearResult },
}));
vi.mock("../../src/features/sharing/share-service", () => ({ setLiveContext: mocks.setLiveContext }));
vi.mock("../../src/realtime/cabinet-client", () => ({
  createCabinetClient: (handlers: { onConnectionChange(value: boolean): void; onMessage(message: unknown): void }) => ({
    join() {
      handlers.onConnectionChange(true);
      handlers.onMessage({ type: "joinedCabinet", role: "player" });
      handlers.onMessage({ type: "cabinetState", state: { status: "occupied", spectatorCount: 0 } });
    },
    leave: mocks.leave,
    send(message: { type: string; reservationId?: string }) {
      mocks.send(message);
      if (message.type === "startSolo") handlers.onMessage({ type: "soloStarted", reservationId: message.reservationId });
      return true;
    },
    getBufferedAmount: () => 0,
  }),
}));
vi.mock("../../src/features/notifications/notifications", () => ({ notifications: { clearScope: vi.fn(), show: vi.fn() } }));
vi.mock("../../src/features/ranking/ranking-client", () => ({ fetchScoreRanking: vi.fn(), loadRankingWithNotice: vi.fn(), submitRankingEntry: vi.fn() }));
vi.mock("../../src/features/platform/platform-client", () => ({ reservePlayCredit: vi.fn(), releasePlayCredit: vi.fn(), capturePlayCredit: vi.fn() }));
vi.mock("../../src/features/engagement/engagement-client", () => ({ recordWatchStarted: vi.fn() }));
vi.mock("../../src/game-sdk/game-host", () => ({ gameHost: { requestPlay: mocks.requestPlay } }));
vi.mock("../../src/games/graze-duel/rendering/canvas-renderer", () => ({ createCanvasRenderer: () => ({ render: vi.fn(), dispose: mocks.rendererDispose }) }));

function keyEvent(code: string) {
  return Object.assign(new Event("keydown", { cancelable: true }), { code, repeat: false });
}

describe("BUZZ BARRIER instance lifecycle", () => {
  let keyboard: EventTarget;
  let canvas: HTMLCanvasElement;
  let bodyClasses: Set<string>;
  let frames: Map<number, FrameRequestCallback>;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.overlay = false; mocks.state = null;
    frames = new Map();
    let nextFrame = 1;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      const handle = nextFrame++;
      frames.set(handle, callback);
      return handle;
    });
    vi.stubGlobal("cancelAnimationFrame", (handle: number) => frames.delete(handle));
    keyboard = new EventTarget();
    Object.assign(keyboard, {
      innerWidth: 390,
      location: { search: "?renderer=canvas", pathname: "/", hostname: "localhost", protocol: "http:", href: "http://localhost/?renderer=canvas" },
      sessionStorage: { getItem: () => null, removeItem: vi.fn() },
      setTimeout, clearTimeout, setInterval, clearInterval,
    });
    vi.stubGlobal("window", keyboard);
    bodyClasses = new Set(["is-arcade-screen"]);
    const classList = {
      add: (...names: string[]) => names.forEach(name => bodyClasses.add(name)),
      remove: (...names: string[]) => names.forEach(name => bodyClasses.delete(name)),
      toggle: (name: string, enabled: boolean) => enabled ? bodyClasses.add(name) : bodyClasses.delete(name),
    };
    canvas = Object.assign(new EventTarget(), {
      width: 960, height: 720, clientWidth: 390, clientHeight: 720,
      getContext: () => ({}), closest: () => null,
      setPointerCapture: vi.fn(), hasPointerCapture: () => true, releasePointerCapture: vi.fn(),
    }) as unknown as HTMLCanvasElement;
    vi.stubGlobal("document", { querySelector: (selector: string) => selector === "#game" ? canvas : selector === ".share-overlay" && mocks.overlay ? {} : null, body: { classList } });
    vi.stubGlobal("history", { pushState: vi.fn() });
  });

  afterEach(() => vi.unstubAllGlobals());

  it("prepares, plays, removes listeners and releases render/session/RAF resources", async () => {
    const lifetime = new GameLifetime();
    const instance = mountGame({ game: BUZZ_BARRIER, lifetime });
    expect(mocks.send).not.toHaveBeenCalledWith({ type: "startSolo" });
    await instance.prepareSolo?.();
    expect(await instance.play("start", "reservation")).toBe(true);
    const joins = vi.mocked(history.pushState).mock.calls.length;
    await instance.prepareSolo?.();
    expect(vi.mocked(history.pushState).mock.calls.length).toBe(joins);
    keyboard.dispatchEvent(keyEvent("KeyR"));
    expect(mocks.requestPlay).toHaveBeenCalledWith("retry");
    expect(frames.size).toBe(1);
    keyboard.dispatchEvent(keyEvent("Space"));
    const [handle, callback] = [...frames.entries()][0]!;
    frames.delete(handle);
    expect(() => callback(performance.now() + 16)).not.toThrow();
    expect(frames.size).toBe(1);
    instance.dispose();
    instance.dispose();
    lifetime.dispose();
    expect(frames.size).toBe(0);
    expect(mocks.leave).toHaveBeenCalledTimes(1);
    expect(mocks.rendererDispose).toHaveBeenCalledTimes(1);
    expect(bodyClasses.has("is-arcade-screen")).toBe(false);
    expect(bodyClasses.has("is-game-screen")).toBe(false);
    keyboard.dispatchEvent(keyEvent("KeyR"));
    expect(mocks.requestPlay).toHaveBeenCalledTimes(1);
    expect(await instance.play("retry", "reservation")).toBe(false);
  });

  it("parent disposal prevents old input from reaching a remounted instance", async () => {
    const oldLifetime = new GameLifetime();
    mountGame({ game: BUZZ_BARRIER, lifetime: oldLifetime });
    oldLifetime.dispose();
    const lifetime = new GameLifetime();
    const instance = mountGame({ game: BUZZ_BARRIER, lifetime });
    await instance.prepareSolo?.();
    await instance.play("start", "reservation");
    keyboard.dispatchEvent(keyEvent("KeyR"));
    expect(mocks.requestPlay).toHaveBeenCalledTimes(1);
    instance.dispose();
    expect(frames.size).toBe(0);
  });

  it("records legitimate zero-score game over without ranking and clears on retry/disposal", async () => {
    const lifetime = new GameLifetime();
    const instance = mountGame({ game: BUZZ_BARRIER, lifetime });
    await instance.prepareSolo?.(); await instance.play("start", "reservation");
    expect(mocks.setResult).not.toHaveBeenCalled();
    keyboard.dispatchEvent(keyEvent("Space"));
    mocks.state!.players[0]!.lives = 0;
    mocks.state!.players[0]!.level = 7;
    let time = performance.now();
    for (let frame = 0; frame < 66; frame++) {
      const [handle, callback] = [...frames.entries()][0]!;
      frames.delete(handle); time += 34; callback(time);
    }
    expect(mocks.setResult).toHaveBeenCalledTimes(1);
    expect(mocks.setResult.mock.calls[0]![0]).toMatchObject({
      gameId: BUZZ_BARRIER.id, cleared: false, score: 0, metrics: { maxLevel: 7, defeatedBossCount: 0 },
    });
    expect(mocks.setResult.mock.calls[0]![0].elapsedTimeMs).toBeGreaterThan(0);
    expect(mocks.setLiveContext).toHaveBeenCalledWith(expect.objectContaining({ gameId: BUZZ_BARRIER.id, role: "player", phase: "finished" }));
    mocks.clearResult.mockClear();
    await instance.play("retry", "reservation");
    expect(mocks.clearResult).toHaveBeenCalledWith(BUZZ_BARRIER.id);
    instance.dispose();
    expect(mocks.clearResult).toHaveBeenCalledWith(BUZZ_BARRIER.id);
    expect(mocks.setLiveContext).toHaveBeenLastCalledWith(null);
  });

  it("does not consume textarea spaces or retry shortcuts while sharing is open", async () => {
    const lifetime = new GameLifetime();
    const instance = mountGame({ game: BUZZ_BARRIER, lifetime });
    await instance.prepareSolo?.(); await instance.play("start", "reservation");
    mocks.overlay = true;
    const space = keyEvent("Space");
    keyboard.dispatchEvent(space); keyboard.dispatchEvent(keyEvent("KeyR"));
    expect(space.defaultPrevented).toBe(false);
    expect(mocks.requestPlay).not.toHaveBeenCalled();
    mocks.overlay = false;
    keyboard.dispatchEvent(keyEvent("KeyR"));
    expect(mocks.requestPlay).toHaveBeenCalledTimes(1);
    instance.dispose();
  });

  it("keeps keyboard and touch behavior and clears input on disposal", () => {
    const lifetime = new GameLifetime();
    const movePlayer = vi.fn();
    const input = createInputController({ lifetime, canvas, keyboardTarget: keyboard,
      getState: () => ({ spectator: false, versusParticipant: false, compact: true, screen: "game", gameOver: false }),
      togglePause: vi.fn(), requestRetry: vi.fn(), movePlayer });
    keyboard.dispatchEvent(keyEvent("KeyD"));
    keyboard.dispatchEvent(keyEvent("ShiftLeft"));
    canvas.dispatchEvent(Object.assign(new Event("pointerdown", { cancelable: true }), { pointerId: 7, clientX: 100, clientY: 100 }));
    canvas.dispatchEvent(Object.assign(new Event("pointermove", { cancelable: true }), { clientX: 172, clientY: 100 }));
    const player = {};
    input.updateHuman(player, 0.016);
    expect(movePlayer).toHaveBeenCalledWith(player, 2, 0, true, 0.016);
    lifetime.dispose();
    expect(input.touchMove.active).toBe(false);
    expect(canvas.releasePointerCapture).toHaveBeenCalledWith(7);
    input.updateHuman(player, 0.016);
    expect(movePlayer).toHaveBeenCalledTimes(1);
  });

  it("keeps real drag input after fullscreen rotates beyond the legacy compact width", () => {
    const lifetime = new GameLifetime();
    const movePlayer = vi.fn();
    let fullscreen = true;
    Object.assign(canvas, { closest: (selector: string) => selector === '[data-mobile-play="true"]' && fullscreen ? canvas : null });
    const input = createInputController({ lifetime, canvas, keyboardTarget: keyboard,
      getState: () => ({ spectator: false, versusParticipant: false, compact: window.innerWidth <= 720, screen: "game", gameOver: false }),
      togglePause: vi.fn(), requestRetry: vi.fn(), movePlayer });
    const player = {};
    for (const width of [390, 844]) {
      Object.assign(keyboard, { innerWidth: width });
      canvas.dispatchEvent(Object.assign(new Event("pointerdown", { cancelable: true }), { pointerId: 8, clientX: 100, clientY: 100 }));
      canvas.dispatchEvent(Object.assign(new Event("pointermove", { cancelable: true }), { clientX: 172, clientY: 100 }));
      input.updateHuman(player, 0.016);
      expect(movePlayer).toHaveBeenLastCalledWith(player, 1, 0, false, 0.016);
      canvas.dispatchEvent(new Event("pointerup"));
      expect(input.touchMove.active).toBe(false);
    }
    fullscreen = false;
    canvas.dispatchEvent(Object.assign(new Event("pointerdown", { cancelable: true }), { pointerId: 9, clientX: 100, clientY: 100 }));
    canvas.dispatchEvent(Object.assign(new Event("pointermove", { cancelable: true }), { clientX: 172, clientY: 100 }));
    input.updateHuman(player, 0.016);
    expect(movePlayer).toHaveBeenLastCalledWith(player, 0, 0, false, 0.016);
    keyboard.dispatchEvent(keyEvent("KeyD"));
    input.updateHuman(player, 0.016);
    expect(movePlayer).toHaveBeenLastCalledWith(player, 1, 0, false, 0.016);
    const calls = movePlayer.mock.calls.length;
    lifetime.dispose();
    expect(input.touchMove.active).toBe(false);
    input.updateHuman(player, 0.016);
    expect(movePlayer).toHaveBeenCalledTimes(calls);
  });

  it.each([false, true])("preserves spectator versus-participation checks in fullscreen: %s", versusParticipant => {
    const lifetime = new GameLifetime();
    const movePlayer = vi.fn();
    Object.assign(canvas, { closest: () => canvas });
    const input = createInputController({ lifetime, canvas, keyboardTarget: keyboard,
      getState: () => ({ spectator: true, versusParticipant, compact: false, screen: "game", gameOver: false }),
      togglePause: vi.fn(), requestRetry: vi.fn(), movePlayer });
    canvas.dispatchEvent(Object.assign(new Event("pointerdown", { cancelable: true }), { pointerId: 10, clientX: 100, clientY: 100 }));
    canvas.dispatchEvent(Object.assign(new Event("pointermove", { cancelable: true }), { clientX: 172, clientY: 100 }));
    const player = {};
    input.updateHuman(player, 0.016);
    expect(movePlayer).toHaveBeenCalledWith(player, versusParticipant ? 1 : 0, 0, false, 0.016);
    lifetime.dispose();
  });

  it("closes audio once and never recreates it after disposal", () => {
    const close = vi.fn().mockResolvedValue(undefined);
    const createOscillator = vi.fn(() => ({ type: "", frequency: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, start() {}, stop() {} }));
    const audioConstructor = vi.fn(function () {
      return { state: "running", currentTime: 0, destination: {}, close, createOscillator,
        createGain: () => ({ gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} }) };
    });
    Object.assign(keyboard, { AudioContext: audioConstructor });
    const audio = createGrazeAudio();
    audio.playAttackSound();
    audio.dispose();
    audio.dispose();
    audio.playAttackSound();
    expect(close).toHaveBeenCalledTimes(1);
    expect(audioConstructor).toHaveBeenCalledTimes(1);
    expect(createOscillator).toHaveBeenCalledTimes(1);
  });
});
