import { env, exports } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { afterEach, beforeAll, expect, it } from "vitest";
import { hashIdentifier } from "../../src/worker/identity-hash";
import { migrateTestDatabase } from "../migrate-test-database";

beforeAll(migrateTestDatabase);
const sockets: WebSocket[] = [];
afterEach(() => { for (const socket of sockets.splice(0)) socket.close(); });

async function fixture(gameId: string) {
  const bootstrap = await exports.default.fetch("http://localhost/api/platform/bootstrap");
  const { playerId } = await bootstrap.json<{ playerId: string }>();
  const cookie = bootstrap.headers.get("set-cookie")!.split(";", 1)[0]!;
  const sessionHash = await hashIdentifier(cookie.split("=")[1]!);
  const api = (path: string, body?: unknown) => exports.default.fetch(`http://localhost/api/platform/${path}`, {
    method: "POST", headers: { Cookie: cookie, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined,
  });
  await api("welcome-credit");
  const cabinet = crypto.randomUUID();
  const reservation = await api("credit-reservations", { cabinetId: cabinet, gameId, purpose: "solo" });
  const { reservationId } = await reservation.json<{ reservationId: string }>();
  expect((await api(`credit-reservations/${reservationId}/capture`)).status).toBe(200);
  const response = await exports.default.fetch(`http://localhost/api/cabinets/${cabinet}/ws?gameId=${gameId}`, { headers: { Upgrade: "websocket", Cookie: cookie } });
  const socket = response.webSocket!; socket.accept(); sockets.push(socket);
  const messages: Array<{ type: string }> = [];
  socket.addEventListener("message", event => { messages.push(JSON.parse(String(event.data))); });
  const send = (message: object) => socket.send(JSON.stringify(message));
  send({ type: "joinCabinet", gameId });
  await expect.poll(() => messages.some(message => message.type === "joinedCabinet")).toBe(true);
  return { room: env.CABINET_ROOMS.getByName(cabinet), playerId, sessionHash, reservationId, socket, messages, send };
}

const cases = ["graze-duel", "dot-wave", "deep-sea-salvage"].flatMap(gameId =>
  ["startSolo", "gameKeyframe", "joinCabinet"].map(operation => ({ gameId, operation })),
);
cases.push({ gameId: "dot-wave", operation: "refreshDotWaveProfile" });

it.each(cases)("does not resurrect $gameId during revoked $operation", async ({ gameId, operation }) => {
  const test = await fixture(gameId);
  if (operation !== "startSolo") {
    test.send({ type: "startSolo", reservationId: test.reservationId });
    await expect.poll(() => test.messages.some(message => message.type === "soloStarted")).toBe(true);
  }
  await runInDurableObject(test.room, instance => {
    const originalEnvironment = Reflect.get(instance, "env") as Env;
    const database = originalEnvironment.DB;
    if (operation === "gameKeyframe") Reflect.get(instance, "state").updatedAt = Date.now() - 6000;
    const fragment = operation === "startSolo" ? "INSERT OR IGNORE INTO credit_reservation_uses"
      : operation === "refreshDotWaveProfile" ? "SELECT p.guest_name" : "INSERT INTO cabinet_directory";
    let fired = false;
    function wrap(statement: D1PreparedStatement, query: string): D1PreparedStatement {
      return new Proxy(statement, {
        get(target, key) {
          if (key === "bind") return (...values: unknown[]) => wrap(target.bind(...values), query);
          if (key === "run" || key === "first") return async (...args: unknown[]) => {
            const result = await Reflect.apply(Reflect.get(target, key), target, args);
            if (!fired && query.includes(fragment)) {
              fired = true;
              await database.prepare("DELETE FROM player_sessions WHERE token_hash = ?").bind(test.sessionHash).run();
              await instance.revokeSession(test.playerId, test.sessionHash);
            }
            return result;
          };
          const value = Reflect.get(target, key, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
    }
    const proxy = new Proxy(database, {
      get(target, key) {
        if (key === "prepare") return (query: string) => wrap(target.prepare(query), query);
        const value = Reflect.get(target, key, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    Reflect.set(instance, "env", { ...originalEnvironment, DB: proxy });
  });
  test.messages.splice(0);
  const closed = new Promise<number>((resolve, reject) => {
    const timer = setTimeout(() => reject(Error("Revoked operation stayed open")), 3000);
    test.socket.addEventListener("close", event => { clearTimeout(timer); resolve(event.code); }, { once: true });
  });
  test.send(operation === "startSolo" ? { type: operation, reservationId: test.reservationId }
    : operation === "gameKeyframe" ? { type: operation, seq: 1, snapshot: { gameId } }
      : operation === "joinCabinet" ? { type: operation, gameId, watch: true } : { type: operation });
  expect(await closed).toBe(1008);
  await expect.poll(() => runInDurableObject(test.room, instance => Reflect.get(instance, "state").playerCount)).toBe(0);
  const state = await runInDurableObject(test.room, instance => ({
    frame: Reflect.get(instance, "latestKeyframe"),
    players: Reflect.get(instance, "state").playerCount,
    spectators: Reflect.get(instance, "state").spectatorCount,
  }));
  expect(state).toEqual({ frame: null, players: 0, spectators: 0 });
  expect(test.messages.some(message => ["soloStarted", "joinedCabinet"].includes(message.type))).toBe(false);
  if (operation === "startSolo") {
    await expect.poll(async () => env.DB.prepare("SELECT status FROM credit_reservations WHERE id = ?").bind(test.reservationId).first("status")).toBe("released");
    expect(await env.DB.prepare("SELECT COUNT(*) FROM credit_reservation_uses WHERE reservation_id = ?").bind(test.reservationId).first("COUNT(*)")).toBe(0);
    expect(await env.DB.prepare("SELECT amount FROM credit_ledger_entries WHERE id = ?").bind(`refund-start:${test.reservationId}`).first("amount")).toBe(1);
  }
});
