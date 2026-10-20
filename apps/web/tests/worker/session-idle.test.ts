import { env, exports } from "cloudflare:workers";
import { runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { hashIdentifier } from "../../src/worker/identity-hash";
import { migrateTestDatabase } from "../migrate-test-database";
import { SESSION_SWEEP_INTERVAL_MS } from "../../src/worker/cabinet-room";

beforeAll(migrateTestDatabase);
const sockets: WebSocket[] = [];
afterEach(() => { for (const socket of sockets.splice(0)) socket.close(); vi.restoreAllMocks(); });

async function fixture(gameId: string) {
  const bootstrap = await exports.default.fetch("http://localhost/api/platform/bootstrap");
  const { playerId } = await bootstrap.json<{ playerId: string }>();
  const cookie = bootstrap.headers.get("set-cookie")!.split(";", 1)[0]!;
  const hash = await hashIdentifier(cookie.split("=")[1]!);
  const other = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO player_sessions (token_hash, player_id, expires_at) VALUES (?, ?, datetime('now', '+1 hour'))")
    .bind(await hashIdentifier(other), playerId).run();
  const room = env.CABINET_ROOMS.getByName(crypto.randomUUID());
  async function connect(session: string) {
    const response = await room.fetch(new Request(`http://localhost/api/cabinets/idle-${crypto.randomUUID()}/ws?gameId=${gameId}`, { headers: { Upgrade: "websocket", Cookie: session } }));
    const socket = response.webSocket!; socket.accept(); sockets.push(socket);
    let closed = 0;
    socket.addEventListener("close", event => { closed = event.code; });
    return { socket, code: () => closed };
  }
  return { room, playerId, hash, old: await connect(cookie), valid: await connect(`vgc_session=${other}`), anonymous: await connect("") };
}

it.each(["graze-duel", "dot-wave", "deep-sea-salvage"].flatMap(gameId => ["deleted", "expired", "account-deletion"].map(reason => ({ gameId, reason }))))(
  "alarm closes idle $gameId on $reason without any client message", async ({ gameId, reason }) => {
    const current = await fixture(gameId);
    if (reason === "deleted") await env.DB.prepare("DELETE FROM player_sessions WHERE token_hash = ?").bind(current.hash).run();
    if (reason === "expired") await env.DB.prepare("UPDATE player_sessions SET expires_at = '2000-01-01' WHERE token_hash = ?").bind(current.hash).run();
    if (reason === "account-deletion") await env.DB.prepare("UPDATE players SET deletion_requested_at = CURRENT_TIMESTAMP WHERE id = ?").bind(current.playerId).run();
    await runInDurableObject(current.room, async (_instance, state) => {
      expect((await state.storage.getAlarm())! - Date.now()).toBeLessThanOrEqual(SESSION_SWEEP_INTERVAL_MS);
    });
    expect(await runDurableObjectAlarm(current.room)).toBe(true);
    await expect.poll(current.old.code).toBe(1008);
    if (reason === "account-deletion") await expect.poll(current.valid.code).toBe(1008);
    else expect(current.valid.code()).toBe(0);
    expect(current.anonymous.code()).toBe(0);
  },
);

it("fails closed on a D1 check failure, preserves anonymous viewing, and schedules future work", async () => {
  const current = await fixture("graze-duel");
  vi.spyOn(console, "warn").mockImplementation(() => {});
  await runInDurableObject(current.room, instance => {
    const original = Reflect.get(instance, "env") as Env;
    Reflect.set(instance, "env", { ...original, DB: new Proxy(original.DB, { get(target, key) {
      if (key === "prepare") return (query: string) => query.startsWith("SELECT token_hash, player_id FROM player_sessions")
        ? { bind: () => ({ all: async () => { throw Error("private D1 failure"); } }) } : target.prepare(query);
      const value = Reflect.get(target, key, target); return typeof value === "function" ? value.bind(target) : value;
    } }) });
  });
  await runDurableObjectAlarm(current.room);
  await expect.poll(current.old.code).toBe(1008);
  await expect.poll(current.valid.code).toBe(1008);
  expect(current.anonymous.code()).toBe(0);
  await runInDurableObject(current.room, async (_instance, state) => { expect(await state.storage.getAlarm()).not.toBeNull(); });
});

it("does not postpone an existing security alarm when state is persisted repeatedly", async () => {
  const current = await fixture("dot-wave");
  await runInDurableObject(current.room, async (instance, state) => {
    const previous = await state.storage.getAlarm();
    await instance.activateSessionSweep();
    await Reflect.apply(Reflect.get(instance, "persistState"), instance, []);
    expect(await state.storage.getAlarm()).toBe(previous);
  });
});

it.each(["marked-revoked", "missing-hash"])("closes an abandoned idle attachment: %s", async reason => {
  const current = await fixture("graze-duel");
  await runInDurableObject(current.room, async (instance, state) => {
    const socket = state.getWebSockets().find(candidate => candidate.deserializeAttachment()?.sessionHash === current.hash)!;
    const attachment = socket.deserializeAttachment();
    socket.serializeAttachment(reason === "marked-revoked" ? { ...attachment, revoked: true } : { ...attachment, sessionHash: undefined });
    await instance.activateSessionSweep();
  });
  await runDurableObjectAlarm(current.room);
  await expect.poll(current.old.code).toBe(1008);
  expect(current.valid.code()).toBe(0);
  expect(current.anonymous.code()).toBe(0);
});
