import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { CabinetClient } from "../../../realtime/cabinet-client";
import type { ServerMessage } from "../../../shared/protocol";
import { createMatch } from "./core";
import type { Engine } from "./engine";
import { createDotWaveCabinetController, type CabinetTransportFactory } from "./cabinetController";

const sharing = vi.hoisted(() => ({
  setResult: vi.fn(), clear: vi.fn(), shareLive: vi.fn(async () => {}), setLiveContext: vi.fn(),
  recordWatchStarted: vi.fn(), recordPlayStartedFromWatch: vi.fn(),
}));
vi.mock("../../../features/engagement/engagement-client", () => sharing);
vi.mock("../../../features/sharing/result-sharing", () => ({ resultSharing: sharing }));
vi.mock("../../../features/sharing/share-service", () => sharing);
vi.mock("../../../features/notifications/notifications", () => ({
  notifications: { dismiss: vi.fn(), clearScope: vi.fn(), show: vi.fn() },
}));
vi.mock("../../../features/platform/platform-client", () => ({
  fetchPlatformBootstrap: vi.fn(async () => {}),
  reservePlayCredit: vi.fn(async () => ({ reservationId: "credit" })),
  capturePlayCredit: vi.fn(async () => ({ status: "captured" })),
  releasePlayCredit: vi.fn(async () => {}),
  PlatformApiError: class extends Error {},
}));

let controller: ReturnType<typeof createDotWaveCabinetController>;
let receive: (message: ServerMessage) => void;
let windowTarget: EventTarget;

function engine(phase: Engine["phase"] = "playing", mode: Engine["mode"] = "cpu"): Engine {
  return {
    phase, mode, match: createMatch(), selected: 0, exchange: null, seconds: 0,
    outcome: null, impactElapsed: 0, feedback: "", cpu: [], flash: null, inputWarning: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  windowTarget = Object.assign(new EventTarget(), {
    setTimeout: globalThis.setTimeout.bind(globalThis), clearTimeout: globalThis.clearTimeout.bind(globalThis),
    setInterval: globalThis.setInterval.bind(globalThis), clearInterval: globalThis.clearInterval.bind(globalThis),
  });
  vi.stubGlobal("window", windowTarget);
  vi.stubGlobal("location", { href: "https://example.test/cabinets/test?game=dot-wave" });
  const factory: CabinetTransportFactory = handlers => {
    receive = handlers.onMessage;
    handlers.onConnectionChange(true);
    return {
      join: () => receive({ type: "roleChanged", role: "player" }),
      leave: vi.fn(),
      send: (message: { type: string }) => {
        if (message.type === "startSolo") receive({ type: "dotWaveSoloStarted" });
        return true;
      },
    } as unknown as CabinetClient;
  };
  controller = createDotWaveCabinetController(vi.fn(), factory);
  controller.start();
});

afterEach(() => { controller.dispose(); vi.unstubAllGlobals(); });

it("records only the current player's terminal solo result and clears on retry/disposal", async () => {
  await Promise.resolve();
  expect(await controller.network.beforeSolo()).toBe(true);
  const current = engine("finished");
  current.match.winner = 0; current.match.turn = 20; current.match.hp = [64, 0];
  current.elapsedPlayMs = 12000;
  controller.network.publish(current, 0);
  expect(sharing.setResult).not.toHaveBeenCalled();
  controller.network.soloEnded();
  controller.network.publish(current, 0);
  expect(sharing.setLiveContext).toHaveBeenCalledWith(expect.objectContaining({ gameId: "dot-wave", role: "player", phase: "finished" }));
  expect(sharing.setResult).toHaveBeenCalledTimes(1);
  expect(controller.getResultShareDraft()).toMatchObject({
    gameId: "dot-wave", elapsedTimeMs: 12000, cleared: true,
    metrics: { mode: "solo", outcome: "win", turns: 20, remainingHp: 64 },
  });
  controller.network.publish(current, 0);
  expect(sharing.setResult).toHaveBeenCalledTimes(1);
  controller.network.publish(engine("intro"), 0);
  expect(controller.getResultShareDraft()).toBeNull();
  controller.dispose();
  expect(sharing.clear).toHaveBeenCalledWith("dot-wave");
});

it("does not register spectator finishes and shares spectator state honestly", async () => {
  await Promise.resolve();
  receive({ type: "roleChanged", role: "spectator" });
  const current = engine("finished", "online"); current.match.winner = 0;
  controller.network.latest = { engine: current, seq: 1, sentAt: 0, turnStartedAt: 0, streamId: "viewer", matchId: null };
  controller.network.soloEnded();
  controller.network.publish(current, 0);
  expect(sharing.setResult).not.toHaveBeenCalled();
  await controller.share();
  expect(sharing.shareLive).toHaveBeenCalledWith({
    gameId: "dot-wave", cabinetId: "test", role: "spectator", phase: "finished",
  });
  expect(sharing.setLiveContext).toHaveBeenCalledWith(expect.objectContaining({ gameId: "dot-wave", role: "spectator", phase: "finished" }));
});

it("pauses active solo play before opening sharing and never auto-resumes", async () => {
  await Promise.resolve();
  const current = engine();
  const pause = vi.fn(async () => {});
  controller.audio.current = { seconds: 2, pause, stop: vi.fn(), dispose: vi.fn() } as unknown as NonNullable<typeof controller.audio.current>;
  controller.network.publish(current, 0);
  expect(sharing.recordPlayStartedFromWatch).toHaveBeenCalledExactlyOnceWith("dot-wave", "test");
  await controller.share();
  expect(current.phase).toBe("paused");
  expect(pause).toHaveBeenCalledTimes(1);
  expect(sharing.shareLive).toHaveBeenCalledWith({
    gameId: "dot-wave", cabinetId: "test", role: "player", phase: "paused",
  });
  expect(current.phase).toBe("paused");
});

it("blocks live sharing during an online match that cannot safely pause", async () => {
  await Promise.resolve();
  controller.network.matchId = "match";
  controller.network.publish(engine("playing", "online"), 0);
  expect(controller.canShareLive()).toBe(false);
  await controller.share();
  expect(sharing.shareLive).not.toHaveBeenCalled();
});

it("waits for the final replicated frame before recording a challenger's result", async () => {
  await Promise.resolve();
  receive({ type: "roleChanged", role: "spectator" });
  receive({ type: "challengeAccepted", matchId: "match", seat: "challenger" } as ServerMessage);
  await Promise.resolve();
  const current = engine("playing", "online");
  controller.network.latest = { engine: current, seq: 1, sentAt: 0, turnStartedAt: 0, streamId: "viewer", matchId: "match" };
  receive({ type: "versusResult", matchId: "match", winner: "challenger", reason: "finished", host: null, challenger: null });
  expect(sharing.setResult).not.toHaveBeenCalled();
  const finished = engine("impact", "online");
  finished.match.winner = 1; finished.match.turn = 20; finished.match.hp = [0, 34];
  receive({ type: "viewerKeyframe", seq: 2, snapshot: {
    engine: finished, seq: 2, sentAt: 0, turnStartedAt: 0, streamId: "viewer", matchId: "match",
  } } as unknown as ServerMessage);
  expect(controller.getResultShareDraft()).toMatchObject({
    cleared: true, metrics: { mode: "versus", outcome: "win", turns: 20, remainingHp: 34 },
  });
});
