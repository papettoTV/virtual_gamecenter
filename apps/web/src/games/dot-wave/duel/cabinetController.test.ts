import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createDotWaveCabinetController, type CabinetTransportFactory, type DotWaveCabinetController } from "./cabinetController";
import { freshDuel } from "./campaign";
import { createCabinetState } from "../../../domain/cabinet";
import type { ClientMessage, GameSnapshot } from "../../../shared/protocol";

const services = vi.hoisted(() => ({
  bootstrap: vi.fn(), reserve: vi.fn(), capture: vi.fn(), release: vi.fn(),
  resume: vi.fn(), stop: vi.fn(), dispose: vi.fn(), show: vi.fn(),
}));
vi.mock("../../../features/platform/platform-client", () => ({
  fetchPlatformBootstrap: services.bootstrap, reservePlayCredit: services.reserve,
  capturePlayCredit: services.capture, releasePlayCredit: services.release,
  PlatformApiError: class extends Error {},
}));
vi.mock("../../../features/notifications/notifications", () => ({
  notifications: { show: services.show, dismiss: vi.fn(), clearScope: vi.fn() },
}));
vi.mock("./audio", () => ({
  DuelAudio: class { resume = services.resume; stop = services.stop; dispose = services.dispose; },
}));

let handlers: Parameters<CabinetTransportFactory>[0];
let controller: DotWaveCabinetController;
const client = { join: vi.fn(), leave: vi.fn(), send: vi.fn((_message: ClientMessage | Record<string, unknown>) => true), getBufferedAmount: () => 0 };
const render = vi.fn();
const flush = async () => { for (let tick = 0; tick < 12; tick++) await Promise.resolve(); };

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  services.bootstrap.mockResolvedValue({});
  services.reserve.mockResolvedValue({ reservationId: "credit-1" });
  services.capture.mockResolvedValue({ status: "captured" });
  services.release.mockResolvedValue({});
  services.resume.mockResolvedValue(undefined);
  const location = { href: "http://localhost/cabinets/test?game=dot-wave", origin: "http://localhost" };
  vi.stubGlobal("window", Object.assign(new EventTarget(), { setInterval: globalThis.setInterval.bind(globalThis), setTimeout: globalThis.setTimeout.bind(globalThis) }));
  vi.stubGlobal("location", location);
  vi.stubGlobal("history", { replaceState: vi.fn() });
  controller = createDotWaveCabinetController(render, callbacks => { handlers = callbacks; return client; });
  controller.start();
});
afterEach(() => {
  controller.dispose();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("joins after account bootstrap and does not duplicate its lifecycle", async () => {
  controller.start();
  await flush();
  expect(client.join).toHaveBeenCalledExactlyOnceWith("test", "dot-wave", false);
  expect(handlers.gameId).toBe("dot-wave");
  handlers.onConnectionChange(true);
  expect(client.send).toHaveBeenCalledWith(expect.objectContaining({ type: "clockPing" }));
  expect(vi.getTimerCount()).toBe(1);
});

it("arbitrates solo credit and resolves acknowledgement without a leftover timer", async () => {
  handlers.onConnectionChange(true);
  handlers.onMessage({ type: "roleChanged", role: "player" });
  const started = controller.network.beforeSolo();
  await flush();
  expect(services.capture).toHaveBeenCalledWith("credit-1");
  expect(client.send).toHaveBeenCalledWith({ type: "startSolo", reservationId: "credit-1" });
  handlers.onMessage({ type: "dotWaveSoloStarted" });
  expect(await started).toBe(true);
  expect(controller.network.startCost).toBe(0);
  expect(vi.getTimerCount()).toBe(1);
  controller.network.soloEnded();
  expect(controller.network.startCost).toBe(1);
  expect(client.send).toHaveBeenCalledWith({ type: "stopSolo" });
});

it("keeps the player's seat and transport through a paid solo retry", async () => {
  await flush();
  handlers.onConnectionChange(true);
  handlers.onMessage({ type: "roleChanged", role: "player" });
  const firstStart = controller.network.beforeSolo();
  await flush();
  handlers.onMessage({ type: "dotWaveSoloStarted" });
  expect(await firstStart).toBe(true);
  controller.network.soloEnded();
  const engine = freshDuel("cpu");
  engine.phase = "finished";
  engine.match.winner = 1;
  controller.network.publish(engine, 0);
  handlers.onMessage({ type: "cabinetState", state: { ...createCabinetState("test", "dot-wave"), status: "occupied", playerCount: 1, spectatorCount: 1 } });
  services.reserve.mockResolvedValueOnce({ reservationId: "credit-2" });
  const secondStart = controller.network.beforeSolo();
  await flush();
  expect(controller.network).toMatchObject({ role: "player", side: 0, connected: true });
  expect(client.send).toHaveBeenCalledWith({ type: "startSolo", reservationId: "credit-2" });
  handlers.onMessage({ type: "dotWaveSoloStarted" });
  expect(await secondStart).toBe(true);
  expect(services.reserve).toHaveBeenCalledTimes(2);
  expect(services.capture).toHaveBeenCalledTimes(2);
  expect(client.join).toHaveBeenCalledTimes(1);
  expect(client.leave).not.toHaveBeenCalled();
  expect(controller.network).toMatchObject({ role: "player", side: 0, startCost: 0 });
  expect(vi.getTimerCount()).toBe(1);
});

it("stops transport, audio, profile listener and a pending solo timeout on disposal", async () => {
  handlers.onConnectionChange(true);
  handlers.onMessage({ type: "roleChanged", role: "spectator" });
  await controller.requestChallenge();
  handlers.onMessage({ type: "roleChanged", role: "player" });
  const started = controller.network.beforeSolo();
  await flush();
  expect(vi.getTimerCount()).toBe(2);
  controller.dispose();
  controller.dispose();
  expect(await started).toBe(false);
  expect(vi.getTimerCount()).toBe(0);
  expect(client.leave).toHaveBeenCalledTimes(1);
  expect(services.dispose).toHaveBeenCalledTimes(1);
  const sends = client.send.mock.calls.length;
  const renders = render.mock.calls.length;
  window.dispatchEvent(new Event("platform-profile-changed"));
  handlers.onConnectionChange(true);
  handlers.onMessage({ type: "challengeReceived" });
  controller.network.soloEnded();
  expect(client.send).toHaveBeenCalledTimes(sends);
  expect(render).toHaveBeenCalledTimes(renders);
});

it("does not reopen a socket when bootstrap resolves after disposal", async () => {
  controller.dispose();
  client.join.mockClear();
  let resolveBootstrap!: (value: object) => void;
  services.bootstrap.mockReturnValue(new Promise(resolve => { resolveBootstrap = resolve; }));
  controller = createDotWaveCabinetController(render, callbacks => { handlers = callbacks; return client; });
  controller.start();
  controller.dispose();
  resolveBootstrap({});
  await flush();
  expect(client.join).not.toHaveBeenCalled();
});

it("releases a reservation that resolves after disposal without sending a challenge", async () => {
  let resolveReservation!: (value: { reservationId: string }) => void;
  services.reserve.mockReturnValue(new Promise(resolve => { resolveReservation = resolve; }));
  handlers.onConnectionChange(true);
  handlers.onMessage({ type: "roleChanged", role: "spectator" });
  const challenge = controller.requestChallenge();
  await flush();
  controller.dispose();
  resolveReservation({ reservationId: "late-credit" });
  await challenge;
  expect(services.release).toHaveBeenCalledExactlyOnceWith("late-credit");
  expect(client.send.mock.calls.some(([message]) => message.type === "requestChallenge")).toBe(false);
  expect(services.show).not.toHaveBeenCalled();
});

it("keeps the simulation boundary limited to ordered frames and remote input", () => {
  const engine = freshDuel("online");
  const frame = { engine, turnStartedAt: 1000, sentAt: 1000, matchId: null, seq: 2, streamId: "stream" };
  handlers.onMessage({ type: "roleChanged", role: "spectator" });
  handlers.onMessage({ type: "viewerKeyframe", seq: 2, snapshot: frame as unknown as GameSnapshot });
  handlers.onMessage({ type: "viewerKeyframe", seq: 1, snapshot: { ...frame, seq: 1 } as unknown as GameSnapshot });
  expect(controller.network.latest?.seq).toBe(2);
  controller.network.matchId = "match";
  controller.network.side = 0;
  for (let seq = 0; seq < 70; seq++) handlers.onMessage({
    type: "versusOpponentProgress", matchId: "match", seq,
    progress: { kind: "dotWaveTap", turn: 2, seconds: 1, action: "up" },
  });
  expect(controller.network.inputs).toHaveLength(64);
  expect(controller.network.inputs[0]?.seq).toBe(6);
  controller.network.side = 1;
  controller.network.strike(2, 1, "up");
  expect(client.send).toHaveBeenCalledWith({
    type: "versusProgress", matchId: "match", seq: 1,
    progress: { kind: "dotWaveTap", turn: 2, seconds: 1, action: "up" },
  });
});

it("captures challenge credit before readiness and preserves the winning result until CPU return", async () => {
  handlers.onConnectionChange(true);
  handlers.onMessage({ type: "challengeAccepted", matchId: "match", seat: "host", reservationId: "credit-1" });
  await flush();
  expect(client.send).toHaveBeenCalledWith({ type: "versusReady", matchId: "match" });
  handlers.onMessage({ type: "versusCountdown", matchId: "match", startsAt: 3000 });
  expect(controller.network.startsAt).toBe(3000);
  handlers.onMessage({ type: "versusResult", matchId: "match", winner: "host", reason: "finished", host: null, challenger: null });
  const revision = controller.state.revision;
  handlers.onMessage({ type: "versusEnded", matchId: "match", nextRole: "player", reason: "finished" });
  expect(controller.state.result?.winner).toBe("host");
  expect(controller.state.revision).toBe(revision);
  expect(controller.network.startCost).toBe(0);
  controller.leaveResult();
  expect(controller.state.result).toBeNull();
  expect(controller.state.revision).toBe(revision + 1);
});

it("reserves rematch credit and releases it when the opponent declines", async () => {
  handlers.onConnectionChange(true);
  controller.network.matchId = "match";
  await controller.rematch();
  expect(services.reserve).toHaveBeenCalledWith("test", "dot-wave", "rematch");
  expect(client.send).toHaveBeenCalledWith({ type: "requestRematch", matchId: "match", reservationId: "credit-1" });
  expect(controller.state.rematchRequested).toBe(true);
  handlers.onMessage({ type: "rematchRejected", matchId: "match", reservationId: "credit-1" });
  await flush();
  expect(services.release).toHaveBeenCalledWith("credit-1");
  expect(controller.state.reservation).toBeNull();
  expect(controller.state.rematchRequested).toBe(false);
});
