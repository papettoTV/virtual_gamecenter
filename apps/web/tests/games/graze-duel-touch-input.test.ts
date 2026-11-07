import { afterEach, describe, expect, it, vi } from "vitest";
import { GameLifetime } from "../../src/game-sdk/lifetime";
import { createInputController } from "../../src/games/graze-duel/input";

function fixture() {
  const lifetime = new GameLifetime();
  const canvas = Object.assign(new EventTarget(), {
    ontouchstart: null, setPointerCapture: vi.fn(), hasPointerCapture: vi.fn(() => true), releasePointerCapture: vi.fn(),
  }) as unknown as HTMLCanvasElement;
  const listeners = vi.spyOn(canvas, "addEventListener");
  const state = { spectator: false, versusParticipant: false, compact: true, screen: "game", gameOver: false, waitingForStart: false };
  let overlay = false;
  vi.stubGlobal("document", { querySelector: () => overlay ? {} : null });
  const movePlayer = vi.fn();
  const input = createInputController({ lifetime, canvas, keyboardTarget: new EventTarget(), getState: () => state,
    togglePause: vi.fn(), requestRetry: vi.fn(), movePlayer });
  return { lifetime, canvas, listeners, state, movePlayer, input, setOverlay: (value: boolean) => { overlay = value; } };
}

function touchEvent(type: string, ...touches: Array<{ identifier: number; clientX: number; clientY: number }>) {
  return Object.assign(new Event(type, { cancelable: true }), { changedTouches: touches });
}

const finger = (identifier: number, clientX = 100, clientY = 100) => ({ identifier, clientX, clientY });

afterEach(() => vi.unstubAllGlobals());

describe("BUZZ BARRIER low-latency touch input", () => {
  it("uses the first one-pixel touch movement without waiting for pointermove or a timer", () => {
    const { canvas, input, movePlayer, listeners, lifetime } = fixture();
    const start = touchEvent("touchstart", finger(1));
    canvas.dispatchEvent(start);
    expect(start.defaultPrevented).toBe(true);
    expect(input.touchMove.x).toBe(0);
    const move = touchEvent("touchmove", finger(1, 101));
    canvas.dispatchEvent(move);
    expect(move.defaultPrevented).toBe(true);
    input.updateHuman({}, 0.016);
    expect(movePlayer).toHaveBeenLastCalledWith({}, 1 / 72, 0, false, 0.016);
    expect(listeners).toHaveBeenCalledWith("touchmove", expect.any(Function), { passive: false });
    lifetime.dispose();
  });

  it("does not let a second finger or duplicate pointer events change the active drag", () => {
    const { canvas, input, lifetime } = fixture();
    canvas.dispatchEvent(Object.assign(new Event("pointerdown"), { pointerType: "touch", pointerId: 1, clientX: 10, clientY: 10 }));
    expect(input.touchMove.active).toBe(false);
    canvas.dispatchEvent(touchEvent("touchstart", finger(1)));
    canvas.dispatchEvent(touchEvent("touchstart", finger(2, 300)));
    canvas.dispatchEvent(touchEvent("touchmove", finger(2, 400)));
    expect(input.touchMove.x).toBe(0);
    canvas.dispatchEvent(touchEvent("touchmove", finger(1, 172)));
    canvas.dispatchEvent(Object.assign(new Event("pointermove"), { pointerType: "touch", pointerId: 1, clientX: 10, clientY: 100 }));
    canvas.dispatchEvent(touchEvent("touchend", finger(2)));
    expect(input.touchMove.x).toBe(1);
    expect(input.touchMove.active).toBe(true);
    lifetime.dispose();
  });

  it.each(["touchend", "touchcancel"])("clears the active finger on %s and allows a fresh anchor", type => {
    const { canvas, input, lifetime } = fixture();
    canvas.dispatchEvent(touchEvent("touchstart", finger(1)));
    canvas.dispatchEvent(touchEvent("touchmove", finger(1, 172)));
    canvas.dispatchEvent(touchEvent(type, finger(1)));
    expect(input.touchMove.active).toBe(false);
    expect(input.touchMove.x).toBe(0);
    canvas.dispatchEvent(touchEvent("touchstart", finger(2, 200)));
    expect(input.touchMove.startX).toBe(200);
    expect(input.touchMove.x).toBe(0);
    lifetime.dispose();
    canvas.dispatchEvent(touchEvent("touchstart", finger(3)));
    expect(input.touchMove.active).toBe(false);
  });

  it("preserves spectator scrolling, READY and overlay input guards", () => {
    const { canvas, state, input, lifetime, setOverlay } = fixture();
    state.spectator = true;
    const spectatorTouch = touchEvent("touchstart", finger(1));
    canvas.dispatchEvent(spectatorTouch);
    expect(spectatorTouch.defaultPrevented).toBe(false);
    expect(input.touchMove.active).toBe(false);
    state.spectator = false;
    state.waitingForStart = true;
    canvas.dispatchEvent(touchEvent("touchstart", finger(1)));
    expect(input.touchMove.active).toBe(false);
    state.waitingForStart = false;
    setOverlay(true);
    canvas.dispatchEvent(touchEvent("touchstart", finger(1)));
    expect(input.touchMove.active).toBe(false);
    lifetime.dispose();
  });

  it("keeps pen input and releases capture on cancellation", () => {
    const { canvas, input, lifetime } = fixture();
    canvas.dispatchEvent(Object.assign(new Event("pointerdown"), { pointerType: "pen", pointerId: 4, clientX: 100, clientY: 100 }));
    canvas.dispatchEvent(Object.assign(new Event("pointermove"), { pointerId: 5, clientX: 172, clientY: 100 }));
    expect(input.touchMove.x).toBe(0);
    canvas.dispatchEvent(Object.assign(new Event("pointermove"), { pointerId: 4, clientX: 172, clientY: 100 }));
    expect(input.touchMove.x).toBe(1);
    canvas.dispatchEvent(Object.assign(new Event("pointercancel"), { pointerId: 4 }));
    expect(input.touchMove.active).toBe(false);
    expect(canvas.releasePointerCapture).toHaveBeenCalledWith(4);
    lifetime.dispose();
  });
});
