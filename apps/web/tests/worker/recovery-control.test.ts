import { env, exports } from "cloudflare:workers";
import { evictDurableObject, runInDurableObject } from "cloudflare:test";
import { beforeAll, expect, it } from "vitest";
import { migrateTestDatabase } from "../migrate-test-database";
import type { RecoveryControl } from "../../src/worker/recovery-control";

beforeAll(migrateTestDatabase);
const control = (env as Env & { RECOVERY_CONTROL: DurableObjectNamespace<RecoveryControl> }).RECOVERY_CONTROL.getByName("global");
const api = (path: string, cookie = "", body?: unknown) => exports.default.fetch(`http://localhost/api/${path}`, {
  method: body ? "POST" : "GET", headers: { Cookie: cookie, Origin: "http://localhost", "Content-Type": "application/json", "CF-Connecting-IP": "192.0.2.80" }, body: body ? JSON.stringify(body) : undefined,
});

it("starts closed, blocks all writes and serves a no-store maintenance screen", async () => {
  expect(await control.isOpen()).toBe(false);
  expect((await control.resume()).error).toBe("recovery_not_ready");
  const page = await exports.default.fetch("http://localhost/");
  expect(page.status).toBe(503);
  expect(page.headers.get("Cache-Control")).toBe("no-store");
  expect(await page.text()).toContain("メンテナンス中");
  expect((await api("platform/bootstrap")).status).toBe(503);
  expect((await env.DB.prepare("SELECT COUNT(*) AS count FROM players").first<{ count: number }>())!.count).toBe(0);
});

it("drains real room sockets, persists suspension and removes stale playback before resuming", async () => {
  await control.reconcile(); await control.resume();
  const bootstrap = await api("platform/bootstrap");
  const cookie = bootstrap.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
  await api("platform/welcome-credit", cookie, {});
  const cabinetId = crypto.randomUUID();
  const connect = async () => {
    const upgrade = await exports.default.fetch(`http://localhost/api/cabinets/${cabinetId}/ws?gameId=graze-duel`, { headers: { Cookie: cookie, Upgrade: "websocket", "CF-Connecting-IP": "192.0.2.80" } });
    expect(upgrade.status).toBe(101);
    const socket = upgrade.webSocket!; socket.accept();
    const messages: Array<{ type: string }> = [];
    socket.addEventListener("message", event => { messages.push(JSON.parse(event.data as string)); });
    return { socket, messages };
  };
  const host = await connect(); const viewer = await connect();
  try {
    host.socket.send(JSON.stringify({ type: "joinCabinet", gameId: "graze-duel" }));
    viewer.socket.send(JSON.stringify({ type: "joinCabinet", gameId: "graze-duel", watch: true }));
    await expect.poll(() => host.messages.some(message => message.type === "joinedCabinet")).toBe(true);
    const reservation = await (await api("platform/credit-reservations", cookie, { cabinetId, gameId: "graze-duel", purpose: "solo" })).json<{ reservationId: string }>();
    await api(`platform/credit-reservations/${reservation.reservationId}/capture`, cookie, {});
    host.socket.send(JSON.stringify({ type: "startSolo", reservationId: reservation.reservationId }));
    await expect.poll(() => host.messages.some(message => message.type === "soloStarted")).toBe(true);
    host.socket.send(JSON.stringify({ type: "gameKeyframe", seq: 1, snapshot: { gameId: "graze-duel" } }));
    await expect.poll(() => viewer.messages.some(message => message.type === "viewerKeyframe")).toBe(true);
    const room = env.CABINET_ROOMS.getByName(cabinetId);
    const closed: number[] = [];
    for (const client of [host, viewer]) client.socket.addEventListener("close", event => { closed.push(event.code); });
    await control.stop();
    await expect.poll(() => closed.length).toBe(2);
    expect(closed).toEqual([1012, 1012]);
    expect(await env.ABUSE_GUARDS.getByName("admission").activeConnectionCount()).toBe(0);
    expect(await runInDurableObject(env.ABUSE_GUARDS.getByName("admission"), async (_instance, context) => context.storage.getAlarm())).toBeNull();
    expect((await room.recoveryStatus()).suspended).toBe(true);
    expect((await control.resume()).error).toBe("recovery_not_ready");
    expect((await api("platform/bootstrap")).status).toBe(503);
    await evictDurableObject(control, { webSockets: "close" });
    expect(await control.isOpen()).toBe(false);
    await evictDurableObject(room, { webSockets: "close" });
    expect((await room.recoveryStatus()).suspended).toBe(true);
    await control.reconcile();
    expect(await room.recoveryStatus()).toMatchObject({ suspended: true, status: "empty", connections: 0, hasReplay: false });
    expect(await control.isOpen()).toBe(false);
    await control.resume();
    expect((await api("platform/credits", cookie)).status).toBe(401);
    const reconnect = await connect();
    reconnect.socket.send(JSON.stringify({ type: "joinCabinet", gameId: "graze-duel", watch: true }));
    await expect.poll(() => reconnect.messages.some(message => message.type === "joinedCabinet")).toBe(true);
    expect(reconnect.messages.some(message => message.type === "viewerKeyframe")).toBe(false);
    reconnect.socket.close();
  } finally { host.socket.close(); viewer.socket.close(); await control.stop(); }
});

it("keeps the service stopped on ledger mismatches and rechecks before opening", async () => {
  const player = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO players (id) VALUES (?)").bind(player),
    env.DB.prepare("INSERT INTO credit_wallets (player_id, free_balance) VALUES (?, 7)").bind(player),
  ]);
  expect((await control.reconcile()).error).toBe("recovery_data_not_ready");
  expect(await control.isOpen()).toBe(false);
  await env.DB.prepare("UPDATE credit_wallets SET free_balance = 0 WHERE player_id = ?").bind(player).run();
  await control.reconcile();
  await env.DB.prepare("UPDATE credit_wallets SET free_balance = 1 WHERE player_id = ?").bind(player).run();
  expect((await control.resume()).error).toBe("recovery_data_not_ready");
  expect(await control.isOpen()).toBe(false);
  await env.DB.prepare("UPDATE credit_wallets SET free_balance = 0 WHERE player_id = ?").bind(player).run();
});
