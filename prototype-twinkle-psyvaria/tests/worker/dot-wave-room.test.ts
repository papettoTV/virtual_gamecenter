import { env, exports } from "cloudflare:workers";
import { beforeAll, afterEach, expect, it } from "vitest";
import type { ClientMessage, ServerMessage } from "../../src/shared/protocol";

beforeAll(async () => {
  const tables = [
    "CREATE TABLE accounts (id TEXT PRIMARY KEY, display_name TEXT, avatar_url TEXT)",
    "CREATE TABLE players (id TEXT PRIMARY KEY, display_name TEXT, guest_name TEXT UNIQUE, account_id TEXT UNIQUE, updated_at TEXT DEFAULT CURRENT_TIMESTAMP)",
    "CREATE TABLE player_sessions (token_hash TEXT PRIMARY KEY, player_id TEXT, expires_at TEXT, last_seen_at TEXT)",
    "CREATE TABLE consent_records (id TEXT PRIMARY KEY, player_id TEXT, policy_type TEXT, policy_version TEXT)",
    "CREATE TABLE credit_wallets (player_id TEXT PRIMARY KEY, free_balance INTEGER DEFAULT 0, purchased_balance INTEGER DEFAULT 0, updated_at TEXT)",
    "CREATE TABLE credit_ledger_entries (id TEXT PRIMARY KEY, player_id TEXT, balance_type TEXT, entry_type TEXT, amount INTEGER, reference_id TEXT, play_session_id TEXT)",
    "CREATE TRIGGER apply_free AFTER INSERT ON credit_ledger_entries WHEN NEW.balance_type = 'free' BEGIN UPDATE credit_wallets SET free_balance = free_balance + NEW.amount WHERE player_id = NEW.player_id; END",
    "CREATE TABLE device_benefits (device_hash TEXT, benefit_type TEXT, player_id TEXT, granted_at TEXT DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (device_hash, benefit_type))",
    "CREATE TABLE play_sessions (id TEXT PRIMARY KEY, cabinet_id TEXT, game_id TEXT, mode TEXT, status TEXT, host_player_id TEXT, started_at TEXT, ended_at TEXT)",
    "CREATE TABLE credit_reservations (id TEXT PRIMARY KEY, player_id TEXT, play_session_id TEXT, amount INTEGER, balance_type TEXT, status TEXT, expires_at TEXT, updated_at TEXT)",
    "CREATE TABLE cabinet_directory (cabinet_id TEXT PRIMARY KEY, game_id TEXT, status TEXT, player_count INTEGER, spectator_count INTEGER, updated_at INTEGER)",
  ];
  await env.DB.batch(tables.map(sql => env.DB.prepare(sql)));
});

const sockets: WebSocket[] = [];
afterEach(() => { for (const socket of sockets.splice(0)) socket.close(); });

async function player() {
  const response = await exports.default.fetch("http://localhost/api/platform/bootstrap");
  const cookie = response.headers.get("set-cookie")!.split(";", 1)[0]!;
  await exports.default.fetch("http://localhost/api/platform/welcome-credit", { method: "POST", headers: { Cookie: cookie } });
  return cookie;
}
async function reserve(cookie: string, cabinetId: string, purpose: "solo" | "challenge" | "rematch") {
  const response = await exports.default.fetch("http://localhost/api/platform/credit-reservations", { method: "POST", headers: { Cookie: cookie, "Content-Type": "application/json" }, body: JSON.stringify({ cabinetId, gameId: "dot-wave", purpose }) });
  expect(response.status).toBe(200);
  return (await response.json<{ reservationId: string }>()).reservationId;
}
async function capture(cookie: string, id: string) {
  const response = await exports.default.fetch(`http://localhost/api/platform/credit-reservations/${id}/capture`, { method: "POST", headers: { Cookie: cookie } });
  expect(response.status).toBe(200);
}
async function connect(cookie: string, cabinet: string, watch = false) {
  const response = await exports.default.fetch(`http://localhost/api/cabinets/${cabinet}/ws?gameId=dot-wave`, { headers: { Upgrade: "websocket", Cookie: cookie } });
  expect(response.status).toBe(101);
  const socket = response.webSocket!; socket.accept(); sockets.push(socket);
  const messages: ServerMessage[] = [];
  const listeners = new Set<() => void>();
  socket.addEventListener("message", event => { messages.push(JSON.parse(event.data as string)); for (const listener of listeners) listener(); });
  const send = (message: ClientMessage) => socket.send(JSON.stringify(message));
  function next<T extends ServerMessage["type"]>(type: T, predicate: (m: Extract<ServerMessage, { type: T }>) => boolean = () => true): Promise<Extract<ServerMessage, { type: T }>> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { listeners.delete(check); reject(new Error(`waiting for ${type}: ${JSON.stringify(messages)}`)); }, 3000);
      function check() {
        const index = messages.findIndex(message => message.type === type && predicate(message as Extract<ServerMessage, { type: T }>));
        if (index < 0) return;
        clearTimeout(timer); listeners.delete(check); resolve(messages.splice(index, 1)[0] as Extract<ServerMessage, { type: T }>);
      }
      listeners.add(check); check();
    });
  }
  send({ type: "joinCabinet", gameId: "dot-wave", watch });
  await next("joinedCabinet");
  return { socket, send, next, messages };
}

it("keeps a watch link in spectator mode even when the cabinet is empty", async () => {
  const viewer = await connect(await player(), crypto.randomUUID(), true);
  const state = await viewer.next("cabinetState", m => m.state.spectatorCount === 1);
  expect(state.state.playerCount).toBe(0);
  viewer.send({ type: "startSolo" });
  viewer.send({ type: "clockPing", sentAt: 1 });
  await viewer.next("clockPong");
  expect(viewer.messages.some(m => m.type === "dotWaveSoloStarted")).toBe(false);
});

it("releases a rejected challenge and prevents unpaid or reused solo credit", async () => {
  const cabinet = crypto.randomUUID(), hostCookie = await player(), guestCookie = await player();
  const host = await connect(hostCookie, cabinet), guest = await connect(guestCookie, cabinet, true);
  host.send({ type: "startSolo" }); await host.next("error");
  const id = await reserve(hostCookie, cabinet, "solo"); await capture(hostCookie, id);
  host.send({ type: "startSolo", reservationId: id }); await host.next("dotWaveSoloStarted");
  const challenge = await reserve(guestCookie, cabinet, "challenge");
  guest.send({ type: "requestChallenge", reservationId: challenge }); await host.next("challengeReceived");
  host.send({ type: "respondChallenge", accept: false }); await guest.next("challengeRejected");
  // Use a following server response as a barrier for the asynchronous release.
  host.send({ type: "clockPing", sentAt: 2 }); await host.next("clockPong");
  await expect.poll(async () => (await env.DB.prepare("SELECT status FROM credit_reservations WHERE id = ?").bind(challenge).first<{ status: string }>())?.status).toBe("released");
  host.send({ type: "stopSolo" }); await host.next("cabinetState", m => m.state.status === "occupied");
  host.send({ type: "startSolo", reservationId: id }); await host.next("error");
});

it("shares the arena, gates participant input by match, and moves the winning challenger into the seat", async () => {
  const cabinet = crypto.randomUUID(), hostCookie = await player(), guestCookie = await player();
  const host = await connect(hostCookie, cabinet), guest = await connect(guestCookie, cabinet, true), watcher = await connect(await player(), cabinet, true);
  const solo = await reserve(hostCookie, cabinet, "solo"); await capture(hostCookie, solo);
  host.send({ type: "startSolo", reservationId: solo }); await host.next("dotWaveSoloStarted");
  host.send({ type: "gameKeyframe", seq: 1, snapshot: { turn: 8 } });
  expect((await watcher.next("viewerKeyframe")).snapshot).toEqual({ turn: 8 });
  const challenge = await reserve(guestCookie, cabinet, "challenge");
  guest.send({ type: "requestChallenge", reservationId: challenge }); await host.next("challengeReceived");
  host.send({ type: "respondChallenge", accept: true });
  const accepted = await host.next("challengeAccepted");
  expect((await guest.next("challengeAccepted")).seat).toBe("challenger");
  const matchId = accepted.matchId;
  await capture(guestCookie, challenge);
  host.send({ type: "versusReady", matchId }); guest.send({ type: "versusReady", matchId });
  const start = await host.next("versusCountdown");
  expect((await guest.next("versusCountdown")).startsAt).toBe(start.startsAt);
  guest.send({ type: "versusProgress", matchId, seq: 3, progress: { kind: "dotWaveTap", turn: 0, seconds: 2.2 } });
  expect((await host.next("versusOpponentProgress")).progress.turn).toBe(0);
  guest.send({ type: "versusProgress", matchId, seq: 4, progress: { kind: "dotWaveTap", turn: 0, seconds: 2.4, action: "up" } });
  expect((await host.next("versusOpponentProgress")).progress).toEqual({ kind: "dotWaveTap", turn: 0, seconds: 2.4, action: "up" });
  watcher.send({ type: "versusProgress", matchId, seq: 99, progress: { kind: "dotWaveTap" } });
  watcher.send({ type: "dotWaveResult", matchId, hp: [0, 100], turn: 1 });
  watcher.send({ type: "clockPing", sentAt: 3 }); await watcher.next("clockPong");
  expect(host.messages.some(m => m.type === "versusOpponentProgress" && m.seq === 99)).toBe(false);
  expect(host.messages.some(m => m.type === "versusResult")).toBe(false);
  host.send({ type: "dotWaveResult", matchId, hp: [0, 60], turn: 3 });
  expect((await guest.next("versusResult")).winner).toBe("challenger");
  guest.send({ type: "dotWaveReturn", matchId });
  expect((await guest.next("versusEnded")).nextRole).toBe("player");
  expect((await host.next("versusEnded")).nextRole).toBe("spectator");
  guest.send({ type: "startSolo" }); await guest.next("dotWaveSoloStarted");
});

it("cancels reservations and releases an unstarted match when a participant disconnects", async () => {
  const cabinet = crypto.randomUUID(), hostCookie = await player(), guestCookie = await player();
  const host = await connect(hostCookie, cabinet), guest = await connect(guestCookie, cabinet, true);
  const solo = await reserve(hostCookie, cabinet, "solo"); await capture(hostCookie, solo);
  host.send({ type: "startSolo", reservationId: solo }); await host.next("dotWaveSoloStarted");
  const cancelled = await reserve(guestCookie, cabinet, "challenge");
  guest.send({ type: "requestChallenge", reservationId: cancelled }); await host.next("challengeReceived");
  guest.send({ type: "cancelChallenge" }); await guest.next("challengeRejected");
  await expect.poll(async () => (await env.DB.prepare("SELECT status FROM credit_reservations WHERE id = ?").bind(cancelled).first<{ status: string }>())?.status).toBe("released");
  const challenge = await reserve(guestCookie, cabinet, "challenge");
  guest.send({ type: "requestChallenge", reservationId: challenge }); await host.next("challengeReceived");
  guest.send({ type: "requestChallenge", reservationId: challenge });
  guest.send({ type: "clockPing", sentAt: 4 }); await guest.next("clockPong");
  expect((await env.DB.prepare("SELECT status FROM credit_reservations WHERE id = ?").bind(challenge).first<{ status: string }>())?.status).toBe("active");
  host.send({ type: "respondChallenge", accept: true }); await host.next("challengeAccepted");
  guest.socket.close();
  expect((await host.next("versusEnded")).nextRole).toBe("player");
  await expect.poll(async () => (await env.DB.prepare("SELECT status FROM credit_reservations WHERE id = ?").bind(challenge).first<{ status: string }>())?.status).toBe("released");
});

for (const winner of ["host", "challenger"] as const) it(`charges only the losing ${winner === "host" ? "challenger" : "host"} for an approved rematch and synchronizes its countdown`, async () => {
  const cabinet = crypto.randomUUID(), hostCookie = await player(), guestCookie = await player();
  const host = await connect(hostCookie, cabinet), guest = await connect(guestCookie, cabinet, true);
  const solo = await reserve(hostCookie, cabinet, "solo"); await capture(hostCookie, solo);
  host.send({ type: "startSolo", reservationId: solo }); await host.next("dotWaveSoloStarted");
  const challenge = await reserve(guestCookie, cabinet, "challenge");
  guest.send({ type: "requestChallenge", reservationId: challenge }); await host.next("challengeReceived");
  host.send({ type: "respondChallenge", accept: true });
  const first = await host.next("challengeAccepted"); await guest.next("challengeAccepted");
  await capture(guestCookie, challenge);
  host.send({ type: "versusReady", matchId: first.matchId }); guest.send({ type: "versusReady", matchId: first.matchId });
  await host.next("versusCountdown"); await guest.next("versusCountdown");
  host.send({ type: "dotWaveResult", matchId: first.matchId, hp: winner === "host" ? [90, 0] : [0, 90], turn: 2 });
  await host.next("versusResult"); await guest.next("versusResult");
  const loser = winner === "host" ? guest : host, victor = winner === "host" ? host : guest;
  const cookie = winner === "host" ? guestCookie : hostCookie;
  const reservationId = await reserve(cookie, cabinet, "rematch");
  loser.send({ type: "requestRematch", matchId: first.matchId, reservationId });
  await victor.next("rematchRequested");
  victor.send({ type: "respondRematch", matchId: first.matchId, accept: true });
  const paid = await loser.next("challengeAccepted"), free = await victor.next("challengeAccepted");
  expect(paid.reservationId).toBe(reservationId); expect(free.reservationId).toBeNull();
  expect(paid.matchId).not.toBe(first.matchId);
  victor.send({ type: "versusReady", matchId: paid.matchId });
  loser.send({ type: "versusReady", matchId: paid.matchId });
  loser.send({ type: "clockPing", sentAt: 9 }); await loser.next("clockPong");
  expect(loser.messages.some(m => m.type === "versusCountdown")).toBe(false);
  await capture(cookie, reservationId);
  const before = Date.now();
  loser.send({ type: "versusReady", matchId: paid.matchId });
  const countdown = await loser.next("versusCountdown");
  expect(countdown.startsAt).toBeGreaterThanOrEqual(before + 3000);
  expect((await victor.next("versusCountdown")).startsAt).toBe(countdown.startsAt);
});

it("accepts a challenge from the solo score screen without starting the next solo game", async () => {
  const cabinet = crypto.randomUUID(), hostCookie = await player(), guestCookie = await player();
  const host = await connect(hostCookie, cabinet), guest = await connect(guestCookie, cabinet, true);
  const solo = await reserve(hostCookie, cabinet, "solo"); await capture(hostCookie, solo);
  host.send({ type: "startSolo", reservationId: solo }); await host.next("dotWaveSoloStarted");
  host.send({ type: "stopSolo" }); await host.next("cabinetState", m => m.state.status === "occupied");
  host.send({ type: "gameKeyframe", seq: 1, snapshot: { engine: { phase: "finished" } } });
  expect((await guest.next("viewerKeyframe")).snapshot.engine).toEqual({ phase: "finished" });
  const reservationId = await reserve(guestCookie, cabinet, "challenge");
  guest.send({ type: "requestChallenge", reservationId });
  await host.next("challengeReceived"); await guest.next("challengePending");
  host.send({ type: "respondChallenge", accept: true });
  const accepted = await host.next("challengeAccepted"); await guest.next("challengeAccepted");
  await capture(guestCookie, reservationId);
  host.send({ type: "versusReady", matchId: accepted.matchId });
  guest.send({ type: "versusReady", matchId: accepted.matchId });
  const countdown = await host.next("versusCountdown");
  expect((await guest.next("versusCountdown")).startsAt).toBe(countdown.startsAt);
});

it('shares names and champion streaks, preserves draws, transfers the crown and clears an empty seat', async () => {
  const cabinet = crypto.randomUUID(), hostCookie = await player(), guestCookie = await player();
  const identity = await (await exports.default.fetch('http://localhost/api/platform/bootstrap', {headers:{Cookie:hostCookie}})).json<{playerId:string}>();
  await env.DB.prepare('UPDATE players SET guest_name = ? WHERE id = ?').bind('チャンピオンテスト', identity.playerId).run();
  const host = await connect(hostCookie,cabinet), guest = await connect(guestCookie,cabinet,true);
  const watcher = await connect(await player(),cabinet,true);
  expect((await watcher.next('cabinetState',m=>m.state.dotWavePlayers?.[0]?.name==='チャンピオンテスト')).state.dotWavePlayers).toEqual([{name:'チャンピオンテスト',wins:0},null]);
  const solo = await reserve(hostCookie,cabinet,'solo'); await capture(hostCookie,solo);
  host.send({type:'startSolo',reservationId:solo}); await host.next('dotWaveSoloStarted');
  async function battle(hp:[number,number]) {
    const reservationId = await reserve(guestCookie,cabinet,'challenge');
    guest.send({type:'requestChallenge',reservationId}); await host.next('challengeReceived');
    host.send({type:'respondChallenge',accept:true});
    const {matchId}=await host.next('challengeAccepted'); await guest.next('challengeAccepted');
    await capture(guestCookie,reservationId);
    host.send({type:'versusReady',matchId}); guest.send({type:'versusReady',matchId});
    await host.next('versusCountdown'); await guest.next('versusCountdown');
    host.send({type:'dotWaveResult',matchId,hp,turn:20});
    await host.next('versusResult'); await guest.next('versusResult');
    const result = await watcher.next('cabinetState',m=>m.state.status==='result');
    // Repeated results cannot add wins.
    host.send({type:'dotWaveResult',matchId,hp,turn:20});
    host.send({type:'clockPing',sentAt:123}); await host.next('clockPong');
    guest.send({type:'dotWaveReturn',matchId});
    await host.next('versusEnded'); await guest.next('versusEnded');
    const after = await watcher.next('cabinetState',m=>m.state.status==='soloPlaying' && m.state.dotWavePlayers?.[0]?.wins===(hp[0]>hp[1]?result.state.dotWavePlayers![0]!.wins:hp[0]===hp[1]?2:1));
    return {result:result.state.dotWavePlayers!,after:after.state.dotWavePlayers!};
  }
  expect((await battle([90,0])).after[0]!.wins).toBe(1);
  expect((await battle([90,0])).after[0]!.wins).toBe(2);
  expect((await battle([50,50])).after[0]!.wins).toBe(2);
  watcher.messages.splice(0); // Discard the initial occupied-seat broadcast before testing the new transition.
  host.send({type:'stopSolo'});
  expect((await watcher.next('cabinetState',m=>m.state.status==='occupied')).state.dotWavePlayers![0]!.wins).toBe(2);
  const anotherSolo=await reserve(hostCookie,cabinet,'solo'); await capture(hostCookie,anotherSolo);
  host.send({type:'startSolo',reservationId:anotherSolo}); await host.next('dotWaveSoloStarted');
  // Profile edits do not reset the streak; public data contains only the display name and wins.
  await env.DB.prepare('UPDATE players SET guest_name = ? WHERE id = ?').bind('名前変更テスト',identity.playerId).run();
  host.send({type:'refreshDotWaveProfile'});
  expect((await watcher.next('cabinetState',m=>m.state.dotWavePlayers?.[0]?.name==='名前変更テスト')).state.dotWavePlayers![0]).toEqual({name:'名前変更テスト',wins:2});
  const last = await battle([0,80]);
  expect(last.result.map(p=>p?.wins)).toEqual([0,1]);
  expect(last.after[0]).toEqual(last.result[1]);
  // A late spectator sees the same champion without requiring a game frame.
  const late = await connect(await player(),cabinet,true);
  const lateState=(await late.next('cabinetState',m=>m.state.dotWavePlayers?.[0]?.wins===1)).state;
  expect(lateState.dotWavePlayers![0]).toEqual(last.after[0]);
  expect(lateState.dotWaveResultPlayers).toEqual(last.result);
  guest.send({type:'leaveCabinet'});
  expect((await watcher.next('cabinetState',m=>m.state.status==='empty')).state.dotWavePlayers).toEqual([null,null]);
  guest.send({type:'joinCabinet',gameId:'dot-wave'}); await guest.next('joinedCabinet');
  expect((await watcher.next('cabinetState',m=>m.state.status==='occupied'&&m.state.dotWavePlayers?.[0]?.name===last.after[0]!.name)).state.dotWavePlayers![0]!.wins).toBe(0);
});
