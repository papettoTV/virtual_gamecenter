import { env, exports } from "cloudflare:workers";
import { afterEach, beforeAll, expect, it } from "vitest";
import { migrateTestDatabase } from "../migrate-test-database";
import { GAME_CATALOG } from "../../src/domain/game";
import { handlePlatformRequest } from "../../src/worker/platform";
import type { ServerMessage } from "../../src/shared/protocol";

beforeAll(migrateTestDatabase);
const sockets: WebSocket[] = [];
afterEach(() => { for (const socket of sockets.splice(0)) socket.close(); });

async function call(path: string, cookie = "", body?: object) {
  return exports.default.fetch(`http://localhost/api/platform/${path}`, {
    method: body ? "POST" : "GET", headers: { Cookie: cookie, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
}
async function player() {
  const response = await call("bootstrap");
  const cookie = response.headers.get("set-cookie")!.split(";", 1)[0]!;
  expect((await response.json<{ availableGameModes: string[] }>()).availableGameModes).toEqual(["solo"]);
  expect((await call("welcome-credit", cookie, {})).status).toBe(200);
  return cookie;
}
async function records(cookie: string) {
  const response = await call("bootstrap", cookie);
  const { playerId, wallet } = await response.json<{ playerId: string; wallet: unknown }>();
  const sessions = await env.DB.prepare("SELECT id, mode, status FROM play_sessions WHERE host_player_id = ? ORDER BY id").bind(playerId).all();
  const reservations = await env.DB.prepare("SELECT id, status FROM credit_reservations WHERE player_id = ? ORDER BY id").bind(playerId).all();
  const ledger = await env.DB.prepare("SELECT id, amount, entry_type FROM credit_ledger_entries WHERE player_id = ? ORDER BY id").bind(playerId).all();
  return { wallet, sessions: sessions.results, reservations: reservations.results, ledger: ledger.results };
}
async function connect(cookie: string, cabinetId: string, gameId: string, watch = false) {
  const response = await exports.default.fetch(`http://localhost/api/cabinets/${cabinetId}/ws?gameId=${gameId}`, { headers: { Upgrade: "websocket", Cookie: cookie } });
  expect(response.status).toBe(101);
  const socket = response.webSocket!;
  socket.accept(); sockets.push(socket);
  const messages: ServerMessage[] = [];
  const listeners = new Set<() => void>();
  socket.addEventListener("message", event => { messages.push(JSON.parse(event.data as string)); for (const listener of listeners) listener(); });
  function next<T extends ServerMessage["type"]>(type: T, predicate: (message: Extract<ServerMessage, { type: T }>) => boolean = () => true): Promise<Extract<ServerMessage, { type: T }>> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { listeners.delete(check); reject(Error(`waiting for ${type}`)); }, 3000);
      function check() {
        const index = messages.findIndex(message => message.type === type && predicate(message as Extract<ServerMessage, { type: T }>));
        if (index < 0) return;
        clearTimeout(timer); listeners.delete(check);
        resolve(messages.splice(index, 1)[0] as Extract<ServerMessage, { type: T }>);
      }
      listeners.add(check); check();
    });
  }
  const send = (message: object) => socket.send(JSON.stringify(message));
  send({ type: "joinCabinet", gameId, watch });
  expect((await next("joinedCabinet")).role).toBe(watch ? "spectator" : "player");
  return { socket, messages, send, next };
}

it.each(GAME_CATALOG)("rejects non-solo HTTP reservations without ledger or reservation changes: $id", async game => {
  const cookie = await player();
  const baseline = await records(cookie);
  for (const body of [{ purpose: "challenge" }, { purpose: "rematch" }, { purpose: "coop" },
    { purpose: "versus" }, { purpose: "solo", mode: "versus" }, { mode: "coop" }]) {
    const response = await call("credit-reservations", cookie, { cabinetId: crypto.randomUUID(), gameId: game.id, ...body });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "game_mode_unavailable" });
  }
  for (const body of [{ purpose: "unknown" }, { mode: "unknown" }, { purpose: null }, { purpose: ["solo"] }, { mode: null }, { purpose: { toString: null } }, { mode: { toString: null } }]) {
    expect((await call("credit-reservations", cookie, { cabinetId: crypto.randomUUID(), gameId: game.id, ...body })).status).toBe(400);
  }
  expect((await call("credit-reservations?mode=coop", cookie, { cabinetId: crypto.randomUUID(), gameId: game.id })).status).toBe(403);
  expect(await records(cookie)).toEqual(baseline);
});

it.each(["active", "captured"])("blocks capture of an old versus reservation (%s), while allowing release", async status => {
  const cookie = await player();
  const local = { APP_ENV: "local", LOCAL_MULTIPLAYER_ENABLED: "true" };
  const request = (path: string, body: object) => new Request(`http://localhost/api/platform/${path}`, { method: "POST", headers: { Cookie: cookie, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const response = (await handlePlatformRequest(request("credit-reservations", { cabinetId: crypto.randomUUID(), gameId: "dot-wave", purpose: "challenge" }), env.DB, local))!;
  expect(response.status).toBe(200);
  const { reservationId } = await response.json<{ reservationId: string }>();
  if (status === "captured") expect((await handlePlatformRequest(request(`credit-reservations/${reservationId}/capture`, {}), env.DB, local))!.status).toBe(200);
  const baseline = await records(cookie);
  expect((await call(`credit-reservations/${reservationId}/capture`, cookie, {})).status).toBe(403);
  expect(await records(cookie)).toEqual(baseline);
  const released = await call(`credit-reservations/${reservationId}/release`, cookie, {});
  expect(released.status).toBe(200);
  expect(await released.json()).toMatchObject({ status: "released", wallet: { availableTotal: 5 } });
});

it.each(["staging", "production"])("never enables multiplayer through a local opt-in in %s", async APP_ENV => {
  const cookie = await player();
  const baseline = await records(cookie);
  const response = await handlePlatformRequest(new Request("http://localhost/api/platform/credit-reservations", {
    method: "POST", headers: { Cookie: cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ cabinetId: crypto.randomUUID(), gameId: "dot-wave", purpose: "challenge" }),
  }), env.DB, { APP_ENV, LOCAL_MULTIPLAYER_ENABLED: "true" });
  expect(response!.status).toBe(403);
  expect(await records(cookie)).toEqual(baseline);
});

it.each(GAME_CATALOG)("rejects multiplayer WebSocket commands and preserves solo/spectating: $id", async game => {
  const hostCookie = await player(), viewerCookie = await player();
  const cabinetId = crypto.randomUUID();
  const host = await connect(hostCookie, cabinetId, game.id);
  const viewer = await connect(viewerCookie, cabinetId, game.id, true);
  const reservation = await call("credit-reservations", hostCookie, { cabinetId, gameId: game.id, purpose: "solo" });
  expect(reservation.status).toBe(200);
  const { reservationId } = await reservation.json<{ reservationId: string }>();
  expect((await call(`credit-reservations/${reservationId}/capture`, hostCookie, {})).status).toBe(200);
  host.send({ type: "startSolo", reservationId });
  await host.next("soloStarted");
  await viewer.next("cabinetState", message => message.state.status === "soloPlaying");
  const baseline = await records(hostCookie), viewerBaseline = await records(viewerCookie);
  host.messages.length = 0; viewer.messages.length = 0;
  for (const type of ["requestChallenge", "respondChallenge", "versusReady", "versusProgress", "versusAttack", "versusTerminal", "requestRematch", "respondRematch", "dotWaveResult", "dotWaveReturn", "startVersus", "startCoop", "requestCoop", "joinCoop"]) {
    viewer.send({ type, reservationId, matchId: "forged", accept: true, mode: type.includes("Coop") ? "coop" : "versus" });
    expect((await viewer.next("error")).code).toBe("game_mode_unavailable");
  }
  host.send({ type: "startSolo", mode: "coop", reservationId });
  expect((await host.next("error")).code).toBe("game_mode_unavailable");
  host.send({ type: "startSolo", purpose: "coop", reservationId });
  expect((await host.next("error")).code).toBe("game_mode_unavailable");
  viewer.send({ type: "clockPing", sentAt: 1 }); await viewer.next("clockPong");
  expect(await records(hostCookie)).toEqual(baseline);
  expect(await records(viewerCookie)).toEqual(viewerBaseline);
  expect(host.messages.some(message => ["challengeReceived", "challengeAccepted", "versusCountdown", "roleChanged"].includes(message.type))).toBe(false);
  host.send({ type: "gameKeyframe", seq: 1, snapshot: { phase: "playing" } });
  expect((await viewer.next("viewerKeyframe")).snapshot).toEqual({ phase: "playing" });
  host.send({ type: "stopSolo" });
  expect((await viewer.next("cabinetState", message => message.state.status === "occupied")).state).toMatchObject({ playerCount: 1, spectatorCount: 1 });
});

it("rejects WebSocket mode query bypasses before creating a connection", async () => {
  for (const mode of ["versus", "coop", "unknown"]) {
    const response = await exports.default.fetch(`http://localhost/api/cabinets/${crypto.randomUUID()}/ws?gameId=dot-wave&mode=${mode}`, { headers: { Upgrade: "websocket" } });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "game_mode_unavailable" });
    expect(response.webSocket).toBeNull();
  }
});
