import { env, exports } from "cloudflare:workers";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { getActiveGames } from "../../src/domain/game";
import { recoverExpiredUnusedCaptures, refundUnusedCapture, validatePlayReservation } from "../../src/worker/credit-reservations";
import { hashIdentifier } from "../../src/worker/identity-hash";
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
  it.each(["credits", "bootstrap", "reserve"])("recovers an expired unused capture before %s and never refunds twice", async action => {
    const test = await fixture(game.id);
    await test.api(`credit-reservations/${test.reservationId}/capture`);
    await env.DB.prepare("UPDATE credit_reservations SET expires_at = datetime('now', '-1 second') WHERE id = ?").bind(test.reservationId).run();
    const response = action === "reserve"
      ? await test.api("credit-reservations", { cabinetId: test.cabinetId, gameId: game.id })
      : await exports.default.fetch(`http://localhost/api/platform/${action}`, { headers: { Cookie: test.cookie } });
    expect(response.status).toBe(200);
    const result = await response.json<{ reservationId?: string; wallet: { freeBalance: number; availableTotal: number } }>();
    expect(result.wallet.freeBalance).toBe(5);
    expect(result.wallet.availableTotal).toBe(action === "reserve" ? 4 : 5);
    await Promise.all([recoverExpiredUnusedCaptures(env.DB, test.playerId), test.api(`credit-reservations/${test.reservationId}/release`)]);
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM credit_ledger_entries WHERE reference_id = ? AND entry_type = 'refunded'").bind(test.reservationId).first("count")).toBe(1);
    expect(await env.DB.prepare("SELECT status FROM play_sessions WHERE id = (SELECT play_session_id FROM credit_reservations WHERE id = ?)").bind(test.reservationId).first("status")).toBe("cancelled");
    expect(await test.validate("captured", "recovered-replay")).toBe(false);
    if (result.reservationId) await test.api(`credit-reservations/${result.reservationId}/release`);
  });

  it("does not recover another owner, an unexpired capture, or a used capture", async () => {
    const test = await fixture(game.id);
    await test.api(`credit-reservations/${test.reservationId}/capture`);
    await recoverExpiredUnusedCaptures(env.DB, test.playerId);
    expect(await env.DB.prepare("SELECT status FROM credit_reservations WHERE id = ?").bind(test.reservationId).first("status")).toBe("captured");
    expect(await test.validate("captured", "started")).toBe(true);
    await env.DB.prepare("UPDATE credit_reservations SET expires_at = datetime('now', '-1 second') WHERE id = ?").bind(test.reservationId).run();
    await recoverExpiredUnusedCaptures(env.DB, test.playerId);
    const unused = await fixture(game.id);
    await unused.api(`credit-reservations/${unused.reservationId}/capture`);
    await env.DB.prepare("UPDATE credit_reservations SET expires_at = datetime('now', '-1 second') WHERE id = ?").bind(unused.reservationId).run();
    await recoverExpiredUnusedCaptures(env.DB, test.playerId);
    for (const reservationId of [test.reservationId, unused.reservationId]) {
      expect(await env.DB.prepare("SELECT status FROM credit_reservations WHERE id = ?").bind(reservationId).first("status")).toBe("captured");
    }
    expect(await env.DB.prepare("SELECT free_balance FROM credit_wallets WHERE player_id = ?").bind(test.playerId).first("free_balance")).toBe(4);
  });

  it("does not recover unsupported modes or a capture without a matching consumption entry", async () => {
    const test = await fixture(game.id);
    await test.api(`credit-reservations/${test.reservationId}/capture`);
    await env.DB.prepare("UPDATE credit_reservations SET expires_at = datetime('now', '-1 second') WHERE id = ?").bind(test.reservationId).run();
    await env.DB.prepare("UPDATE play_sessions SET mode = 'versus' WHERE id = (SELECT play_session_id FROM credit_reservations WHERE id = ?)").bind(test.reservationId).run();
    await recoverExpiredUnusedCaptures(env.DB, test.playerId);
    expect(await env.DB.prepare("SELECT status FROM credit_reservations WHERE id = ?").bind(test.reservationId).first("status")).toBe("captured");
    await env.DB.prepare("UPDATE play_sessions SET mode = 'solo' WHERE id = (SELECT play_session_id FROM credit_reservations WHERE id = ?)").bind(test.reservationId).run();
    await env.DB.prepare("UPDATE credit_ledger_entries SET reference_id = 'invalid' WHERE id = ?").bind(`consume:${test.reservationId}`).run();
    await recoverExpiredUnusedCaptures(env.DB, test.playerId);
    expect(await env.DB.prepare("SELECT status FROM credit_reservations WHERE id = ?").bind(test.reservationId).first("status")).toBe("captured");
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM credit_ledger_entries WHERE reference_id = ? AND entry_type = 'refunded'").bind(test.reservationId).first("count")).toBe(0);
  });

  it("captures concurrent duplicate requests once and refunds concurrent releases once", async () => {
    const test = await fixture(game.id);
    const captures = await Promise.all([test.api(`credit-reservations/${test.reservationId}/capture`), test.api(`credit-reservations/${test.reservationId}/capture`)]);
    expect(captures.map(response => response.status)).toEqual([200, 200]);
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM credit_ledger_entries WHERE reference_id = ? AND entry_type = 'consumed'").bind(test.reservationId).first("count")).toBe(1);
    const releases = await Promise.all([test.api(`credit-reservations/${test.reservationId}/release`), test.api(`credit-reservations/${test.reservationId}/release`)]);
    for (const response of releases) expect(await response.json()).toMatchObject({ status: "released", wallet: { availableTotal: 5, reservedFree: 0 } });
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM credit_ledger_entries WHERE reference_id = ? AND entry_type = 'refunded'").bind(test.reservationId).first("count")).toBe(1);
  });

  it("cancels an uncaptured reservation without spending and requires a new reservation to retry", async () => {
    const test = await fixture(game.id);
    expect(await (await test.api(`credit-reservations/${test.reservationId}/release`)).json()).toMatchObject({ status: "released", wallet: { availableTotal: 5, reservedFree: 0 } });
    expect((await test.api(`credit-reservations/${test.reservationId}/capture`)).status).toBe(200);
    expect(await test.validate("captured", "cancelled-retry")).toBe(false);
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM credit_ledger_entries WHERE reference_id = ?").bind(test.reservationId).first("count")).toBe(0);
    const retry = await (await test.api("credit-reservations", { cabinetId: test.cabinetId, gameId: game.id })).json<{ reservationId: string }>();
    expect(retry.reservationId).not.toBe(test.reservationId);
    expect(await (await test.api(`credit-reservations/${retry.reservationId}/capture`)).json()).toMatchObject({ status: "captured", wallet: { availableTotal: 4 } });
    await test.api(`credit-reservations/${retry.reservationId}/release`);
  });

  it("serializes start authorization against a concurrent refund without granting a free play", async () => {
    const test = await fixture(game.id);
    await test.api(`credit-reservations/${test.reservationId}/capture`);
    const [authorized] = await Promise.all([test.validate("captured", "racing-start"), refundUnusedCapture(env.DB, test.reservationId)]);
    const reservation = await env.DB.prepare("SELECT status FROM credit_reservations WHERE id = ?").bind(test.reservationId).first<{ status: string }>();
    const balance = await env.DB.prepare("SELECT free_balance FROM credit_wallets WHERE player_id = ?").bind(test.playerId).first("free_balance");
    expect(reservation?.status).toBe(authorized ? "captured" : "released");
    expect(balance).toBe(authorized ? 4 : 5);
    expect(await test.validate("captured", "racing-replay")).toBe(false);
  });

  it.each(["revoked", "expired", "deleted"])("atomically refuses a captured play with a %s session", async condition => {
    const test = await fixture(game.id);
    await test.api(`credit-reservations/${test.reservationId}/capture`);
    const hash = await hashIdentifier(test.cookie.split("=")[1]!);
    if (condition === "revoked") await env.DB.prepare("DELETE FROM player_sessions WHERE token_hash = ?").bind(hash).run();
    if (condition === "expired") await env.DB.prepare("UPDATE player_sessions SET expires_at = '2000-01-01' WHERE token_hash = ?").bind(hash).run();
    if (condition === "deleted") await env.DB.prepare("UPDATE players SET deletion_requested_at = CURRENT_TIMESTAMP WHERE id = ?").bind(test.playerId).run();
    expect(await validatePlayReservation(env.DB, test.reservationId, test.playerId, test.cabinetId, game.id, "solo", "captured", crypto.randomUUID(), hash)).toBe(false);
    expect(await env.DB.prepare("SELECT COUNT(*) FROM credit_reservation_uses WHERE reservation_id = ?").bind(test.reservationId).first("COUNT(*)")).toBe(0);
  });
  it("keeps a streaming solo cabinet visible after the directory freshness window", async () => {
    const test = await fixture(game.id);
    await test.api(`credit-reservations/${test.reservationId}/capture`);
    const upgrade = await exports.default.fetch(`http://localhost/api/cabinets/${test.cabinetId}/ws?gameId=${game.id}`, { headers: { Cookie: test.cookie, Upgrade: "websocket" } });
    const socket = upgrade.webSocket!; socket.accept();
    const messages: Array<{ type: string }> = [];
    socket.addEventListener("message", event => messages.push(JSON.parse(event.data as string)));
    let restoreClock: (() => void) | undefined;
    try {
      socket.send(JSON.stringify({ type: "joinCabinet", gameId: game.id }));
      await expect.poll(() => messages.some(message => message.type === "joinedCabinet")).toBe(true);
      socket.send(JSON.stringify({ type: "startSolo", reservationId: test.reservationId }));
      await expect.poll(() => messages.some(message => message.type === "soloStarted")).toBe(true);
      const later = Date.now() + 20_000;
      const clock = vi.spyOn(Date, "now").mockReturnValue(later);
      restoreClock = () => { clock.mockRestore(); };
      socket.send(JSON.stringify({ type: "gameKeyframe", seq: 1, snapshot: { gameId: game.id } }));
      await expect.poll(async () => {
        const response = await exports.default.fetch(`http://localhost/api/cabinets?gameId=${game.id}`);
        const directory = await response.json<{ cabinets: Array<{ cabinetId: string }> }>();
        return directory.cabinets.some(cabinet => cabinet.cabinetId === test.cabinetId);
      }).toBe(true);
    } finally { restoreClock?.(); socket.close(); }
  });
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

it("bounds recovery to twenty reservations per reconciliation and drains the rest on the next call", async () => {
  const test = await fixture(getActiveGames()[0]!.id);
  await test.api(`credit-reservations/${test.reservationId}/release`);
  await env.DB.prepare("UPDATE credit_wallets SET free_balance = 30 WHERE player_id = ?").bind(test.playerId).run();
  for (let index = 0; index < 21; index++) {
    const reservationId = crypto.randomUUID();
    const playSessionId = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare("INSERT INTO play_sessions (id, cabinet_id, game_id, mode, status, host_player_id) VALUES (?, ?, ?, 'solo', 'playing', ?)").bind(playSessionId, test.cabinetId, getActiveGames()[0]!.id, test.playerId),
      env.DB.prepare("INSERT INTO credit_reservations (id, player_id, play_session_id, amount, balance_type, status, expires_at) VALUES (?, ?, ?, 1, 'free', 'captured', datetime('now', '-1 second'))").bind(reservationId, test.playerId, playSessionId),
      env.DB.prepare("INSERT INTO credit_ledger_entries (id, player_id, balance_type, entry_type, amount, play_session_id, reference_id) VALUES (?, ?, 'free', 'consumed', -1, ?, ?)").bind(`consume:${reservationId}`, test.playerId, playSessionId, reservationId),
    ]);
  }
  await recoverExpiredUnusedCaptures(env.DB, test.playerId);
  expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM credit_reservations WHERE player_id = ? AND status = 'captured'").bind(test.playerId).first("count")).toBe(1);
  expect(await env.DB.prepare("SELECT free_balance FROM credit_wallets WHERE player_id = ?").bind(test.playerId).first("free_balance")).toBe(29);
  await recoverExpiredUnusedCaptures(env.DB, test.playerId);
  expect(await env.DB.prepare("SELECT free_balance FROM credit_wallets WHERE player_id = ?").bind(test.playerId).first("free_balance")).toBe(30);
});
