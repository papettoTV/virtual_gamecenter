vi.mock("../src/features/platform/platform-client", () => ({ ensurePlatformSession: vi.fn().mockResolvedValue(undefined) }));
import { afterEach, describe, expect, it, vi } from "vitest";
import { GameLifetime } from "../src/game-sdk/lifetime";
import { GameHost } from "../src/game-sdk/game-host";
import { createCabinetSession } from "../src/game-sdk/cabinet-session";
import { createCabinetState } from "../src/domain/cabinet";
import type { CabinetClientHandlers } from "../src/realtime/cabinet-client";

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("game lifecycle", () => {
  it("stops listeners, animation frames and timers exactly once on disposal", () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", globalThis);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => setTimeout(() => callback(16), 16));
    vi.stubGlobal("cancelAnimationFrame", clearTimeout);
    const lifetime = new GameLifetime();
    const target = new EventTarget();
    const listener = vi.fn(); const work = vi.fn(); const cleanup = vi.fn();
    lifetime.listen(target, "move", listener);
    lifetime.frame(work); lifetime.timeout(work, 20); lifetime.interval(work, 10); lifetime.own(cleanup);
    target.dispatchEvent(new Event("move")); expect(listener).toHaveBeenCalledTimes(1);
    lifetime.dispose(); lifetime.dispose();
    target.dispatchEvent(new Event("move")); vi.advanceTimersByTime(100);
    expect(listener).toHaveBeenCalledTimes(1); expect(work).not.toHaveBeenCalled(); expect(cleanup).toHaveBeenCalledTimes(1);
    lifetime.own(cleanup); expect(cleanup).toHaveBeenCalledTimes(2);
  });

  it("prepares solo without requesting or authorizing a paid start", async () => {
    const host = new GameHost();
    const prepareSolo = vi.fn(); const play = vi.fn(); const requested = vi.fn();
    host.attach({ prepareSolo, play, dispose() {} }); host.subscribe(requested);
    await host.selectSolo();
    expect(prepareSolo).toHaveBeenCalledOnce();
    expect(requested).not.toHaveBeenCalled(); expect(play).not.toHaveBeenCalled();
    host.requestPlay("start"); expect(requested).toHaveBeenCalledExactlyOnceWith("start");
    expect(play).not.toHaveBeenCalled();
  });

  it("rejects a late game-start completion after a game has been replaced", async () => {
    const host = new GameHost();
    let finish: (value: boolean) => void = () => {};
    const detach = host.attach({ play: () => new Promise<boolean>(resolve => { finish = resolve; }), dispose() {} });
    const starting = host.play("start");
    detach(); host.attach({ play: () => true, dispose() {} }); finish(true);
    await expect(starting).resolves.toBe(false);
    await expect(host.play("retry")).resolves.toBe(true);
  });

  it("waits through an earlier watch acknowledgement and requires solo authorization", async () => {
    vi.stubGlobal("window", globalThis);
    let handlers: CabinetClientHandlers = {};
    const send = vi.fn(() => true);
    const session = createCabinetSession({ gameId: "deep-sea-salvage" }, incoming => {
      handlers = incoming;
      return { join() {}, leave() {}, send, getBufferedAmount: () => 0 };
    });
    session.join("cabinet", "deep-sea-salvage", true);
    session.join("cabinet", "deep-sea-salvage");
    const ready = vi.fn();
    const waiting = session.waitForPlayer().then(ready);
    handlers.onMessage?.({ type: "joinedCabinet", clientId: "host", role: "spectator" });
    await Promise.resolve();
    expect(ready).not.toHaveBeenCalled();
    handlers.onMessage?.({ type: "joinedCabinet", clientId: "host", role: "player" });
    await waiting;
    expect(ready).toHaveBeenCalledWith(true);
    const authorized = vi.fn();
    const starting = session.startSolo("reservation").then(authorized);
    expect(send).toHaveBeenCalledExactlyOnceWith({ type: "startSolo", reservationId: "reservation" });
    handlers.onMessage?.({ type: "soloStarted", reservationId: "other" });
    await Promise.resolve();
    expect(authorized).not.toHaveBeenCalled();
    handlers.onMessage?.({ type: "soloStarted", reservationId: "reservation" });
    await starting;
    expect(authorized).toHaveBeenCalledWith(true);
    session.leave();
  });

  it("tracks cabinet role and releases pending starts and transport on exit", async () => {
    vi.stubGlobal("window", globalThis);
    let handlers: CabinetClientHandlers = {};
    const leave = vi.fn(); const join = vi.fn();
    const lifetime = new GameLifetime();
    const session = createCabinetSession({ gameId: "deep-sea-salvage", lifetime }, incoming => {
      handlers = incoming;
      return { join, leave, send: () => true, getBufferedAmount: () => 0 };
    });
    session.join("cabinet", "deep-sea-salvage", true);
    handlers.onMessage?.({ type: "joinedCabinet", clientId: "viewer", role: "spectator" });
    expect(session.role).toBe("spectator");
    const state = createCabinetState("cabinet", "deep-sea-salvage");
    handlers.onMessage?.({ type: "cabinetState", state }); expect(session.state).toEqual(state);
    session.join("cabinet", "deep-sea-salvage");
    const ready = session.waitForPlayer();
    handlers.onMessage?.({ type: "joinedCabinet", clientId: "host", role: "player" });
    await expect(ready).resolves.toBe(true);
    session.join("other", "deep-sea-salvage"); const pending = session.waitForPlayer();
    lifetime.dispose(); await expect(pending).resolves.toBe(false); expect(leave).toHaveBeenCalledTimes(1);
    expect(session.role).toBe("visitor"); expect(session.state).toBeNull();
  });
});
