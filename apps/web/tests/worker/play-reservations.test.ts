import { env, exports } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import { getActiveGames } from "../../src/domain/game";
import { validatePlayReservation } from "../../src/worker/credit-reservations";
import { migrateTestDatabase } from "../migrate-test-database";

beforeAll(migrateTestDatabase);
async function fixture(gameId: string, purpose = "solo") {
  const bootstrap = await exports.default.fetch("http://localhost/api/platform/bootstrap");
  const { playerId } = await bootstrap.json<{ playerId: string }>();
  const cookie = bootstrap.headers.get("set-cookie")!.split(";", 1)[0]!;
  const api = (path: string, body?: unknown) => exports.default.fetch("http://localhost/api/platform/" + path, {
    method: "POST", headers: { Cookie: cookie, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined,
  });
  await api("welcome-credit");
  const cabinetId = crypto.randomUUID();
  const reserved = await api("credit-reservations", { cabinetId, gameId, purpose });
  const { reservationId } = await reserved.json<{ reservationId: string }>();
  const validate = (status: "active" | "captured", usageId?: string) => validatePlayReservation(env.DB, reservationId, playerId, cabinetId, gameId, purpose === "solo" ? "solo" : "versus", status, usageId);
  return { playerId, cookie, cabinetId, reservationId, api, validate };
}

describe.each(getActiveGames())("$id play reservations", game => {
  it("requires a paid reservation on the actual WebSocket start and rejects round replay", async () => {
    const test = await fixture(game.id);
    const upgrade = await exports.default.fetch(`http://localhost/api/cabinets/${test.cabinetId}/ws?gameId=${game.id}`, { headers: { Cookie: test.cookie, Upgrade: "websocket" } });
    let socket = upgrade.webSocket!;
    socket.accept();
    const messages: Array<{ type: string; reservationId?: string }> = [];
    socket.addEventListener("message", event => messages.push(JSON.parse(event.data as string)));
    const send = (body: unknown) => socket.send(JSON.stringify(body));
    const wait = async (type: string) => { await expect.poll(() => messages.some(message => message.type === type)).toBe(true); return messages.splice(messages.findIndex(message => message.type === type), 1)[0]; };
    try {
      send({ type: "joinCabinet", gameId: game.id }); await wait("joinedCabinet");
      send({ type: "startSolo" }); await wait("error");
      send({ type: "startSolo", reservationId: test.reservationId }); await wait("error");
      await test.api(`credit-reservations/${test.reservationId}/capture`);
      send({ type: "startSolo", reservationId: test.reservationId });
      expect((await wait("soloStarted"))?.reservationId).toBe(test.reservationId);
      socket.close();
      await expect.poll(async () => (await env.DB.prepare("SELECT status FROM cabinet_directory WHERE cabinet_id = ?").bind(test.cabinetId).first<{ status: string }>())?.status).toBe("empty");
      const reconnect = await exports.default.fetch(`http://localhost/api/cabinets/${test.cabinetId}/ws?gameId=${game.id}`, { headers: { Cookie: test.cookie, Upgrade: "websocket" } });
      socket = reconnect.webSocket!; socket.accept();
      socket.addEventListener("message", event => messages.push(JSON.parse(event.data as string)));
      send({ type: "joinCabinet", gameId: game.id }); await wait("joinedCabinet");
      send({ type: "startSolo" }); expect((await wait("soloStarted"))?.reservationId).toBe(null);
      send({ type: "stopSolo" }); send({ type: "startSolo", reservationId: test.reservationId }); await wait("error");
      expect((await env.DB.prepare("SELECT COUNT(*) AS count FROM credit_reservation_uses WHERE reservation_id = ?").bind(test.reservationId).first<{ count: number }>())?.count).toBe(1);
    } finally { socket.close(); }
  });

  it("checks ownership, cabinet, game, mode, expiry, payment and atomic single use", async () => {
    const test = await fixture(game.id);
    expect(await test.validate("active")).toBe(true);
    expect(await test.validate("captured", "unpaid")).toBe(false);
    expect((await test.api(`credit-reservations/${test.reservationId}/capture`)).status).toBe(200);
    for (const [playerId, cabinetId, gameId, mode] of [
      [crypto.randomUUID(), test.cabinetId, game.id, "solo"],
      [test.playerId, crypto.randomUUID(), game.id, "solo"],
      [test.playerId, test.cabinetId, getActiveGames().find(other => other.id !== game.id)!.id, "solo"],
      [test.playerId, test.cabinetId, game.id, "versus"],
    ]) {
      expect(await validatePlayReservation(env.DB, test.reservationId, playerId, cabinetId!, gameId!, mode!, "captured", "invalid")).toBe(false);
    }
    const results = await Promise.all([test.validate("captured", "first"), test.validate("captured", "second")]);
    expect(results.sort()).toEqual([false, true]);
    expect(await test.validate("captured", "replay")).toBe(false);
    const released = await (await test.api(`credit-reservations/${test.reservationId}/release`)).json<{ status: string; wallet: { availableTotal: number } }>();
    expect(released).toMatchObject({ status: "captured", wallet: { availableTotal: 4 } });
  });

  it("refunds an unstarted captured reservation only once and prevents its reuse", async () => {
    const test = await fixture(game.id);
    await test.api(`credit-reservations/${test.reservationId}/capture`);
    await test.api(`credit-reservations/${test.reservationId}/release`);
    const repeated = await (await test.api(`credit-reservations/${test.reservationId}/release`)).json<{ status: string; wallet: { availableTotal: number } }>();
    expect(repeated).toMatchObject({ status: "released", wallet: { availableTotal: 5 } });
    expect(await test.validate("captured", "after-refund")).toBe(false);
  });

  it("rejects an expired reservation before charging it", async () => {
    const test = await fixture(game.id);
    await env.DB.prepare("UPDATE credit_reservations SET expires_at = ? WHERE id = ?")
      .bind(new Date(Date.now() - 60_000).toISOString(), test.reservationId).run();
    expect(await test.validate("active")).toBe(false);
    expect((await test.api(`credit-reservations/${test.reservationId}/capture`)).status).toBe(409);
    expect((await env.DB.prepare("SELECT free_balance FROM credit_wallets WHERE player_id = ?").bind(test.playerId).first<{ free_balance: number }>())?.free_balance).toBe(5);
  });

  it("authorizes the matching paid versus reservation and blocks solo reservations", async () => {
    const test = await fixture(game.id, "challenge");
    expect(await test.validate("active")).toBe(true);
    expect(await test.validate("captured", "ready")).toBe(false);
    await test.api(`credit-reservations/${test.reservationId}/capture`);
    expect(await test.validate("captured", "ready")).toBe(true);
    expect(await test.validate("captured", "rematch-replay")).toBe(false);
  });
});
