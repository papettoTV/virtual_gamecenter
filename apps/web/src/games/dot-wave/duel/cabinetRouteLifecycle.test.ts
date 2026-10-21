import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { CabinetTransportFactory } from "./cabinetController";
import DotWaveCabinet from "./DotWaveCabinet";
import MochiDuel from "./MochiDuel";
import { DuelAudio } from "./audio";
import { createCabinetState } from "../../../domain/cabinet";

const runtime = vi.hoisted(() => ({
  refs: [] as Array<{ current: unknown }>,
  cursor: 0,
  mounted: false,
  effects: [] as Array<() => (() => void) | void>,
  renders: 0,
}));
const services = vi.hoisted(() => ({
  bootstrap: vi.fn(), reserve: vi.fn(), capture: vi.fn(), release: vi.fn(),
  resume: vi.fn(), dispose: vi.fn(), show: vi.fn(),
}));
vi.mock("react", async importOriginal => ({
  ...await importOriginal<typeof import("react")>(),
  useRef: (current: unknown) => {
    const index = runtime.cursor++;
    runtime.refs[index] ??= { current };
    return runtime.refs[index];
  },
  useReducer: () => [0, () => { runtime.renders++; }],
  useEffect: (effect: () => (() => void) | void) => {
    if (!runtime.mounted) runtime.effects.push(effect);
  },
}));
vi.mock("../../../features/platform/PlatformExperience", () => ({ PlatformExperience: () => null }));
vi.mock("./MochiDuel", () => ({ default: () => null }));
vi.mock("../../../features/platform/platform-client", () => ({
  fetchPlatformBootstrap: services.bootstrap, reservePlayCredit: services.reserve,
  capturePlayCredit: services.capture, releasePlayCredit: services.release,
  PlatformApiError: class extends Error {},
}));
vi.mock("../../../features/notifications/notifications", () => ({
  notifications: { show: services.show, dismiss: vi.fn(), clearScope: vi.fn() },
}));
vi.mock("./audio", () => ({
  DuelAudio: class { resume = services.resume; stop = vi.fn(); dispose = services.dispose; },
}));

type Handlers = Parameters<CabinetTransportFactory>[0];
const sessions: Array<{
  handlers: Handlers;
  client: { join: ReturnType<typeof vi.fn>; leave: ReturnType<typeof vi.fn>; send: ReturnType<typeof vi.fn> };
}> = [];
vi.mock("../../../game-sdk/cabinet-session", () => ({
  createCabinetSession: (handlers: Handlers) => {
    const client = { join: vi.fn(), leave: vi.fn(), send: vi.fn(() => true), getBufferedAmount: () => 0 };
    sessions.push({ handlers, client });
    return client;
  },
}));

let cleanups: Array<() => void> = [];
const flush = async () => { for (let tick = 0; tick < 12; tick++) await Promise.resolve(); };
function renderRoute() {
  runtime.cursor = 0;
  return DotWaveCabinet();
}
function mountRoute() {
  runtime.refs = [];
  runtime.effects = [];
  runtime.mounted = false;
  expect(renderRoute()).toBeNull();
  cleanups = runtime.effects.map(effect => effect()).filter((cleanup): cleanup is () => void => typeof cleanup === "function");
  runtime.mounted = true;
  return renderRoute();
}
function unmountRoute() {
  for (const cleanup of cleanups) cleanup();
  cleanups = [];
  runtime.mounted = false;
}
function gameElement() {
  const route = renderRoute() as ReactElement<{ children: ReactElement[] }>;
  return route.props.children.find(child => child.type === MochiDuel)! as ReactElement<{
    network: import("./network").DuelLink;
    sharedAudio: { current: unknown };
    boardNotice: ReactElement;
  }>;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  sessions.length = 0;
  runtime.renders = 0;
  services.bootstrap.mockResolvedValue({});
  services.reserve.mockResolvedValue({ reservationId: "credit-1" });
  services.capture.mockResolvedValue({ status: "captured" });
  services.release.mockResolvedValue({});
  services.resume.mockResolvedValue(undefined);
  vi.stubGlobal("window", Object.assign(new EventTarget(), { setInterval, setTimeout }));
  vi.stubGlobal("location", { href: "http://localhost/cabinets/route-test?game=dot-wave", origin: "http://localhost" });
  vi.stubGlobal("history", { replaceState: vi.fn() });
});
afterEach(() => {
  unmountRoute();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("does not cover the start confirmation with a duplicate share overlay", async () => {
  mountRoute();
  await flush();
  sessions[0]!.handlers.onConnectionChange(true);
  sessions[0]!.handlers.onMessage({ type: "roleChanged", role: "player" });
  expect(renderToStaticMarkup(gameElement().props.boardNotice)).toBe("");
  expect(services.reserve).not.toHaveBeenCalled();
});

it("keeps live sharing but hides the beta spectator challenge entry", async () => {
  mountRoute();
  await flush();
  sessions[0]!.handlers.onConnectionChange(true);
  sessions[0]!.handlers.onMessage({ type: "roleChanged", role: "spectator" });
  sessions[0]!.handlers.onMessage({ type: "cabinetState", state: {
    ...createCabinetState("route-test", "dot-wave"), status: "soloPlaying", playerCount: 1, spectatorCount: 1,
  } });
  const html = renderToStaticMarkup(renderRoute());
  expect(html).toContain("観戦中");
  expect(html).toContain("ライブを共有");
  expect(html).not.toContain("1クレジットで対戦");
});

it("leaves the DOT route and returns with fresh network/audio state and only one active session", async () => {
  mountRoute();
  await flush();
  const first = sessions[0]!;
  first.handlers.onConnectionChange(true);
  first.handlers.onMessage({ type: "roleChanged", role: "player" });
  const oldGame = gameElement();
  oldGame.props.sharedAudio.current = new DuelAudio();
  const admission = oldGame.props.network.beforeSolo();
  await flush();
  first.handlers.onMessage({ type: "dotWaveSoloStarted" });
  expect(await admission).toBe(true);
  first.handlers.onMessage({ type: "challengeAccepted", matchId: "old-match", seat: "host", reservationId: null });
  first.handlers.onMessage({ type: "versusResult", matchId: "old-match", winner: "host", reason: "finished", host: null, challenger: null });
  await flush();
  unmountRoute();
  expect(first.client.leave).toHaveBeenCalledTimes(1);
  expect(services.dispose).toHaveBeenCalledTimes(1);
  expect(oldGame.props.sharedAudio.current).toBeNull();
  expect(vi.getTimerCount()).toBe(0);

  mountRoute();
  await flush();
  const second = sessions[1]!;
  const newGame = gameElement();
  expect(second.client.join).toHaveBeenCalledExactlyOnceWith("route-test", "dot-wave", false);
  expect(newGame.props.network).not.toBe(oldGame.props.network);
  expect(newGame.props.sharedAudio).not.toBe(oldGame.props.sharedAudio);
  expect(newGame.props.network).toMatchObject({ role: "visitor", connected: false, matchId: null, latest: null, inputs: [], startCost: 1 });
  expect(newGame.key).toBe("0");
  expect(vi.getTimerCount()).toBe(1);
  const renders = runtime.renders;
  first.handlers.onConnectionChange(true);
  first.handlers.onMessage({ type: "challengeReceived" });
  expect(runtime.renders).toBe(renders);
  window.dispatchEvent(new Event("platform-profile-changed"));
  expect(second.client.send).toHaveBeenCalledExactlyOnceWith({ type: "refreshDotWaveProfile" });
  second.handlers.onConnectionChange(true);
  second.handlers.onMessage({ type: "roleChanged", role: "player" });
  expect(gameElement().props.network.connected).toBe(true);
  const restarted = newGame.props.network.beforeSolo();
  await flush();
  second.handlers.onMessage({ type: "dotWaveSoloStarted" });
  expect(await restarted).toBe(true);
  expect(services.capture).toHaveBeenCalledTimes(2);
});

it("ignores the previous route's late reservation after remount and releases only that reservation", async () => {
  let finishReservation!: (value: { reservationId: string }) => void;
  services.reserve.mockReturnValueOnce(new Promise(resolve => { finishReservation = resolve; }));
  mountRoute();
  await flush();
  const first = sessions[0]!;
  first.handlers.onConnectionChange(true);
  first.handlers.onMessage({ type: "roleChanged", role: "player" });
  const admission = gameElement().props.network.beforeSolo();
  await flush();
  unmountRoute();
  mountRoute();
  await flush();
  const renders = runtime.renders;
  finishReservation({ reservationId: "old-credit" });
  expect(await admission).toBe(false);
  expect(services.release).toHaveBeenCalledExactlyOnceWith("old-credit");
  expect(services.capture).not.toHaveBeenCalled();
  expect(services.show).not.toHaveBeenCalled();
  expect(runtime.renders).toBe(renders);
  expect(sessions[1]!.client.send).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(1);
});
