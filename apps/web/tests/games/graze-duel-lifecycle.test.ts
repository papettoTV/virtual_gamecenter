import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GameLifetime } from "../../src/game-sdk/lifetime";
import { mountGame } from "../../src/games/graze-duel/runtime";
import { createInputController } from "../../src/games/graze-duel/input";
import { createGrazeAudio } from "../../src/games/graze-duel/audio";
import { BUZZ_BARRIER } from "../../src/domain/game";

const mocks = vi.hoisted(() => ({ leave: vi.fn(), send: vi.fn(), rendererDispose: vi.fn(), requestPlay: vi.fn() }));
vi.mock("../../src/realtime/cabinet-client", () => ({
  createCabinetClient: (handlers: { onConnectionChange(value: boolean): void; onMessage(message: unknown): void }) => ({
    join() {
      handlers.onConnectionChange(true);
      handlers.onMessage({ type: "joinedCabinet", role: "player" });
      handlers.onMessage({ type: "cabinetState", state: { status: "occupied", spectatorCount: 0 } });
    },
    leave: mocks.leave,
    send: mocks.send,
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
    vi.stubGlobal("document", { querySelector: (selector: string) => selector === "#game" ? canvas : null, body: { classList } });
    vi.stubGlobal("history", { pushState: vi.fn() });
  });

  afterEach(() => vi.unstubAllGlobals());

  it("prepares, plays, removes listeners and releases render/session/RAF resources", async () => {
    const lifetime = new GameLifetime();
    const instance = mountGame({ game: BUZZ_BARRIER, lifetime });
    expect(mocks.send).not.toHaveBeenCalledWith({ type: "startSolo" });
    await instance.prepareSolo?.();
    expect(await instance.play("start")).toBe(true);
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
    expect(await instance.play("retry")).toBe(false);
  });

  it("parent disposal prevents old input from reaching a remounted instance", async () => {
    const oldLifetime = new GameLifetime();
    mountGame({ game: BUZZ_BARRIER, lifetime: oldLifetime });
    oldLifetime.dispose();
    const lifetime = new GameLifetime();
    const instance = mountGame({ game: BUZZ_BARRIER, lifetime });
    await instance.prepareSolo?.();
    await instance.play("start");
    keyboard.dispatchEvent(keyEvent("KeyR"));
    expect(mocks.requestPlay).toHaveBeenCalledTimes(1);
    instance.dispose();
    expect(frames.size).toBe(0);
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
