import { env, exports } from "cloudflare:workers";
import { afterEach, beforeAll, expect, it } from "vitest";
import type { ClientMessage, ServerMessage } from "../../src/shared/protocol";
import { registerGoogleAccount } from "../../src/worker/google-auth";
import { migrateTestDatabase } from "../migrate-test-database";

beforeAll(migrateTestDatabase);
const sockets: WebSocket[] = [];
afterEach(() => { for (const socket of sockets.splice(0)) socket.close(); });

async function player(registered = false) {
  const response = await exports.default.fetch("http://localhost/api/platform/bootstrap");
  const identity = await response.json<{ playerId: string }>();
  const cookie = response.headers.get("set-cookie")!.split(";", 1)[0]!;
  await exports.default.fetch("http://localhost/api/platform/welcome-credit", { method: "POST", headers: { Cookie: cookie } });
  if (registered) await registerGoogleAccount(env.DB, {
    playerId: identity.playerId, token: cookie.split("=")[1]!, secureCookie: false,
  }, { sub: crypto.randomUUID(), name: "Authorization test" });
  return { cookie, playerId: identity.playerId };
}

async function reserve(cookie: string, cabinetId: string, gameId: string, purpose: string) {
  const response = await exports.default.fetch("http://localhost/api/platform/credit-reservations", {
    method: "POST", headers: { Cookie: cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ cabinetId, gameId, purpose }),
  });
  expect(response.status).toBe(200);
  return (await response.json<{ reservationId: string }>()).reservationId;
}

async function capture(cookie: string, reservationId: string) {
  expect((await exports.default.fetch(`http://localhost/api/platform/credit-reservations/${reservationId}/capture`, {
    method: "POST", headers: { Cookie: cookie },
  })).status).toBe(200);
}

async function connect(cookie: string, cabinetId: string, gameId: string, watch: boolean) {
  const response = await exports.default.fetch(`http://localhost/api/cabinets/${cabinetId}/ws?gameId=${gameId}`, {
    headers: { Cookie: cookie, Upgrade: "websocket" },
  });
  expect(response.status).toBe(101);
  const socket = response.webSocket!;
  socket.accept();
  sockets.push(socket);
  const messages: ServerMessage[] = [];
  const listeners = new Set<() => void>();
  socket.addEventListener("message", event => {
    messages.push(JSON.parse(String(event.data)));
    for (const listener of listeners) listener();
  });
  function next<Type extends ServerMessage["type"]>(type: Type): Promise<Extract<ServerMessage, { type: Type }>> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { listeners.delete(check); reject(Error(`Missing ${type}`)); }, 4000);
      function check() {
        const index = messages.findIndex(message => message.type === type);
        if (index < 0) return;
        clearTimeout(timer);
        listeners.delete(check);
        resolve(messages.splice(index, 1)[0] as Extract<ServerMessage, { type: Type }>);
      }
      listeners.add(check);
      check();
    });
  }
  const send = (message: ClientMessage) => socket.send(JSON.stringify(message));
  send({ type: "joinCabinet", gameId, watch });
  const joined = await next("joinedCabinet");
  return { socket, messages, send, next, clientId: joined.clientId };
}

const status = async (cabinet: string) => (await env.DB.prepare("SELECT status FROM cabinet_directory WHERE cabinet_id = ?").bind(cabinet).first<{ status: string }>())?.status;
const reservationStatus = async (id: string) => (await env.DB.prepare("SELECT status FROM credit_reservations WHERE id = ?").bind(id).first<{ status: string }>())?.status;

it.each(["graze-duel", "dot-wave", "deep-sea-salvage"])("keeps a current match and rematch isolated from authenticated nonparticipants: %s", async gameId => {
  const cabinet = crypto.randomUUID();
  const owner = await player(true), challenger = await player(), outsider = await player(true);
  const host = await connect(owner.cookie, cabinet, gameId, false);
  const guest = await connect(challenger.cookie, cabinet, gameId, true);
  const strangers = [
    await connect(outsider.cookie, cabinet, gameId, true),
    await connect(owner.cookie, cabinet, gameId, true),
  ];
  const inject = async (attempts: ClientMessage[]) => {
    for (const peer of strangers) {
      for (const attempt of attempts) peer.socket.send(JSON.stringify({
        ...attempt, clientId: host.clientId, playerId: owner.playerId, role: "player",
      }));
      peer.send({ type: "clockPing", sentAt: 1 });
      await peer.next("clockPong");
    }
  };
  const expectNoControl = () => {
    const forbidden = ["versusCountdown", "versusOpponentProgress", "versusAttack", "versusResult", "versusEnded", "challengeAccepted", "rematchRequested"];
    for (const peer of [host, guest]) expect(peer.messages.filter(message => forbidden.includes(message.type))).toEqual([]);
  };
  const clear = () => { host.messages.length = 0; guest.messages.length = 0; };
  const solo = await reserve(owner.cookie, cabinet, gameId, "solo");
  await capture(owner.cookie, solo);
  host.send({ type: "startSolo", reservationId: solo });
  await host.next("soloStarted");
  const challenge = await reserve(challenger.cookie, cabinet, gameId, "challenge");
  guest.send({ type: "requestChallenge", reservationId: challenge });
  await host.next("challengeReceived");
  await inject([{ type: "respondChallenge", accept: true }, { type: "respondChallenge", accept: false }, { type: "cancelChallenge" }]);
  expect(await status(cabinet)).toBe("challengePending");
  expect(await reservationStatus(challenge)).toBe("active");
  host.send({ type: "respondChallenge", accept: true });
  const first = await host.next("challengeAccepted");
  await guest.next("challengeAccepted");
  clear();
  await inject([{ type: "versusReady", matchId: first.matchId }, { type: "startSolo", reservationId: solo }]);
  expect(await status(cabinet)).toBe("versusReady");
  expect(await reservationStatus(challenge)).toBe("active");
  expectNoControl();
  await capture(challenger.cookie, challenge);
  host.send({ type: "versusReady", matchId: first.matchId });
  expect(await host.next("versusReadyState")).toMatchObject({ hostReady: true, challengerReady: false });
  guest.send({ type: "versusReady", matchId: first.matchId });
  await host.next("versusCountdown");
  await guest.next("versusCountdown");
  clear();
  await inject([
    { type: "versusProgress", matchId: first.matchId, seq: 999, progress: { injected: true } },
    { type: "versusAttack", matchId: first.matchId, attackId: "injected", level: 999, bossAttack: true },
    { type: "versusTerminal", matchId: first.matchId, report: { reason: "lifeLost", score: 0, clearTimeMs: null, matchElapsedMs: 1 } },
    { type: "dotWaveResult", matchId: first.matchId, hp: [0, 100], turn: 1 },
    { type: "dotWaveReturn", matchId: first.matchId },
    { type: "stopSolo" },
  ]);
  expect(await status(cabinet)).toBe("versusPlaying");
  expectNoControl();
  guest.send({ type: "versusProgress", matchId: first.matchId, seq: 7, progress: { authorized: true } });
  expect(await host.next("versusOpponentProgress")).toMatchObject({ seq: 7, progress: { authorized: true } });
  if (gameId === "dot-wave") host.send({ type: "dotWaveResult", matchId: first.matchId, hp: [90, 0], turn: 1 });
  else guest.send({ type: "versusTerminal", matchId: first.matchId, report: { reason: "lifeLost", score: 0, clearTimeMs: null, matchElapsedMs: 1000 } });
  expect(await host.next("versusResult")).toMatchObject({ winner: "host" });
  await guest.next("versusResult");
  clear();
  const rematch = await reserve(challenger.cookie, cabinet, gameId, "rematch");
  await inject([
    { type: "requestRematch", matchId: first.matchId, reservationId: rematch },
    { type: "respondRematch", matchId: first.matchId, accept: true },
    { type: "declineRematch", matchId: first.matchId },
    { type: "dotWaveReturn", matchId: first.matchId },
  ]);
  expect(await status(cabinet)).toBe("result");
  expect(await reservationStatus(rematch)).toBe("active");
  expectNoControl();
  guest.send({ type: "requestRematch", matchId: first.matchId, reservationId: rematch });
  await host.next("rematchRequested");
  await inject([{ type: "respondRematch", matchId: first.matchId, accept: true }, { type: "respondRematch", matchId: first.matchId, accept: false }]);
  expect(await status(cabinet)).toBe("result");
  expect(await reservationStatus(rematch)).toBe("active");
  expectNoControl();
  host.send({ type: "respondRematch", matchId: first.matchId, accept: true });
  const second = await host.next("challengeAccepted");
  await guest.next("challengeAccepted");
  expect(second.matchId).not.toBe(first.matchId);
  clear();
  guest.send({ type: "versusTerminal", matchId: first.matchId, report: { reason: "lifeLost", score: 0, clearTimeMs: null, matchElapsedMs: 1000 } });
  guest.send({ type: "clockPing", sentAt: 2 });
  await guest.next("clockPong");
  expect(await status(cabinet)).toBe("versusReady");
  expectNoControl();
  await capture(challenger.cookie, rematch);
  host.send({ type: "versusReady", matchId: second.matchId });
  guest.send({ type: "versusReady", matchId: second.matchId });
  expect((await host.next("versusCountdown")).matchId).toBe(second.matchId);
  await guest.next("versusCountdown");
}, 15_000);
