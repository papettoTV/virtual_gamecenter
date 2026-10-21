import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, expect, it } from "vitest";
import { migrateTestDatabase } from "../migrate-test-database";
import { handlePlatformRequest } from "../../src/worker/platform";
import { acknowledgeStart, allowStartReceipt, assessStartSlo, beginStartAttempt, collectStartSloReport, recordStartSloCoverage, settleStartAttempts, startSloPeriods } from "../../src/worker/start-slo";

beforeAll(migrateTestDatabase);
beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM start_slo_attempts"), env.DB.prepare("DELETE FROM start_slo_daily"),
    env.DB.prepare("DELETE FROM start_slo_coverage"), env.DB.prepare("INSERT OR REPLACE INTO start_slo_config(id) VALUES (1)"),
  ]);
});

async function fixture(mode = "solo") {
  const environment = mode === "solo" ? { APP_ENV: "staging" } : { APP_ENV: "local", LOCAL_MULTIPLAYER_ENABLED: "true" };
  const call = (path: string, cookie = "", body?: object) => handlePlatformRequest(new Request("http://localhost/api/platform/" + path,
    { method: body || path.endsWith("/capture") ? "POST" : "GET", headers: { Cookie: cookie, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined }), env.DB, environment);
  const bootstrap = (await call("bootstrap"))!;
  const cookie = bootstrap.headers.get("set-cookie")!.split(";", 1)[0]!;
  const identity = await bootstrap.json<{ playerId: string }>();
  await call("welcome-credit", cookie, {});
  const reserved = (await call("credit-reservations", cookie, { cabinetId: crypto.randomUUID(), gameId: "graze-duel", purpose: mode === "solo" ? "solo" : "challenge" }))!;
  expect(reserved.status).toBe(200);
  const { reservationId } = await reserved.json<{ reservationId: string }>();
  return { reservationId, cookie, playerId: identity.playerId, capture: async () => {
    if (mode !== "solo") await beginStartAttempt(env.DB, reservationId, identity.playerId);
    return call("credit-reservations/" + reservationId + "/capture", cookie);
  } };
}

it("durably counts a capture request once even when no start message reaches the room", async () => {
  const player = await fixture();
  expect((await player.capture())!.status).toBe(200);
  expect((await player.capture())!.status).toBe(200);
  const before = await collectStartSloReport(env.DB);
  expect(before.periods[0]).toMatchObject({ requested: 1, allowed: 0, pending: 1, succeeded: 0 });
  const later = Date.now() + 6000;
  expect((await collectStartSloReport(env.DB, later)).periods[0]).toMatchObject({ requested: 1, missing_response: 1, pending: 0, successRate: 0 });
  await settleStartAttempts(env.DB, later);
  await settleStartAttempts(env.DB, later);
  expect((await collectStartSloReport(env.DB, later)).periods[0]).toMatchObject({ requested: 1, missing_response: 1 });
});

it("requires a valid on-time receipt, never turns a late receipt into success, and preserves the denominator on erasure", async () => {
  const player = await fixture(); await player.capture();
  const receipt = (await allowStartReceipt(env.DB, player.reservationId, 1))!;
  await acknowledgeStart(env.DB, { ...receipt, token: "forged" }, 1);
  await acknowledgeStart(env.DB, receipt, 1, Date.now() + 6000);
  expect((await collectStartSloReport(env.DB, Date.now() + 6000)).periods[0]).toMatchObject({ allowed: 1, succeeded: 0, missing_response: 1 });
  await env.DB.prepare("DELETE FROM start_slo_attempts WHERE reservation_id = ?").bind(player.reservationId).run();
  expect((await collectStartSloReport(env.DB)).periods[0]).toMatchObject({ requested: 1, missing_response: 1, pending: 0 });
});

it("retains historical two-seat SLO accounting and rejects duplicate or pre-permission acknowledgements", async () => {
  const player = await fixture("versus"); await player.capture();
  const raw = await env.DB.prepare("SELECT receipt_token FROM start_slo_attempts WHERE reservation_id = ?").bind(player.reservationId).first<{ receipt_token: string }>();
  await acknowledgeStart(env.DB, { attemptId: player.reservationId, token: raw!.receipt_token }, 1);
  expect((await collectStartSloReport(env.DB)).periods[0]!.succeeded).toBe(0);
  const receipt = (await allowStartReceipt(env.DB, player.reservationId, 2))!;
  await allowStartReceipt(env.DB, player.reservationId, 2);
  await acknowledgeStart(env.DB, receipt, 1); await acknowledgeStart(env.DB, receipt, 1);
  expect((await collectStartSloReport(env.DB)).periods[0]).toMatchObject({ requested: 1, allowed: 1, succeeded: 0, pending: 1 });
  await acknowledgeStart(env.DB, receipt, 2); await acknowledgeStart(env.DB, receipt, 2);
  await settleStartAttempts(env.DB, Date.now() + 31000);
  expect((await collectStartSloReport(env.DB, Date.now() + 31000)).periods[0]).toMatchObject({ succeeded: 1, missing_response: 0, pending: 0, successRate: 1 });
});

it("does not count unauthorized or expired reservations and uses the earlier request deadline", async () => {
  const player = await fixture();
  await beginStartAttempt(env.DB, player.reservationId, "someone-else");
  expect((await collectStartSloReport(env.DB)).periods[0]!.requested).toBe(0);
  const now = Date.now();
  await beginStartAttempt(env.DB, player.reservationId, player.playerId, now);
  await beginStartAttempt(env.DB, player.reservationId, player.playerId, now + 3000);
  const row = await env.DB.prepare("SELECT deadline_ms FROM start_slo_attempts WHERE reservation_id = ?").bind(player.reservationId).first<{ deadline_ms: number }>();
  expect(row!.deadline_ms).toBe(now + 5000);
  const expired = await fixture();
  await env.DB.prepare("UPDATE credit_reservations SET expires_at = '2000-01-01' WHERE id = ?").bind(expired.reservationId).run();
  expect((await expired.capture())!.status).toBe(409);
  expect((await collectStartSloReport(env.DB)).periods[0]!.requested).toBe(1);
});

it("keeps an accepted request when subsequent credit consumption fails", async () => {
  const player = await fixture();
  let batches = 0;
  const database = new Proxy(env.DB, { get(target, key) {
    if (key === "batch") return async (statements: D1PreparedStatement[]) => {
      if (++batches === 2) throw Error("synthetic consumption failure");
      return target.batch(statements);
    };
    const value = Reflect.get(target, key, target);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  await expect(handlePlatformRequest(new Request("http://localhost/api/platform/credit-reservations/" + player.reservationId + "/capture",
    { method: "POST", headers: { Cookie: player.cookie } }), database, { APP_ENV: "staging" })).rejects.toThrow("synthetic consumption failure");
  expect((await collectStartSloReport(env.DB, Date.now() + 6000)).periods[0]).toMatchObject({ requested: 1, allowed: 0, missing_response: 1 });
});

it("does not require or write the staging SLO ledger in production", async () => {
  const player = await fixture();
  const response = await handlePlatformRequest(new Request("http://localhost/api/platform/credit-reservations/" + player.reservationId + "/capture",
    { method: "POST", headers: { Cookie: player.cookie } }), env.DB, { APP_ENV: "production" });
  expect(response!.status).toBe(200);
  expect((await collectStartSloReport(env.DB)).periods[0]!.requested).toBe(0);
});

it("keeps exact anonymous counts after removing two-day detail and rejects retrospective coverage backfill", async () => {
  const player = await fixture(); await player.capture();
  const receipt = (await allowStartReceipt(env.DB, player.reservationId, 1))!;
  await acknowledgeStart(env.DB, receipt, 1);
  await settleStartAttempts(env.DB, Date.now() + 3 * 86400_000);
  expect((await env.DB.prepare("SELECT COUNT(*) AS count FROM start_slo_attempts").first<{ count: number }>())!.count).toBe(0);
  expect((await collectStartSloReport(env.DB, Date.now() + 3 * 86400_000)).periods.some(period => period.succeeded === 1)).toBe(true);
  const slot = Math.floor(Date.now() / 3600_000) * 3600_000;
  await recordStartSloCoverage(env.DB, slot + 37, slot + 1000);
  await recordStartSloCoverage(env.DB, slot, slot + 1000);
  await expect(recordStartSloCoverage(env.DB, slot, slot + 600001)).rejects.toThrow();
  expect((await env.DB.prepare("SELECT COUNT(*) AS count FROM start_slo_coverage").first<{ count: number }>())!.count).toBe(1);
});

it.each([[98, 2, "passed"], [97, 3, "failed"]])("formally assesses a fully observed closed month: %s successes", (succeeded, missing, assessment) => {
  const now = Date.parse("2026-11-01T00:00:00Z"), period = startSloPeriods(now)[1]!;
  const counts = { requested: 101, allowed: 100, succeeded, missing_response: missing, rejected: 1 };
  const checkpoints = (period.to - period.from) / 900000;
  expect(assessStartSlo(counts, 0, period.from, period, now, checkpoints)).toMatchObject({ eligible: 100, assessment });
  expect(assessStartSlo(counts, 0, period.from, period, now, checkpoints - 1).assessment).toBe("coverage_gap");
  expect(assessStartSlo(counts, 0, period.from + 1, period, now, checkpoints).assessment).toBe("insufficient_coverage");
  expect(assessStartSlo(counts, 0, null, period, now, checkpoints).assessment).toBe("not_instrumented");
});

it("never declares a current month, empty month, or unresolved request successful", () => {
  const now = Date.parse("2026-11-15T00:00:00Z"), [current, previous] = startSloPeriods(now);
  const empty = { requested: 0, allowed: 0, succeeded: 0, missing_response: 0, rejected: 0 };
  const checkpoints = (previous!.to - previous!.from) / 900000;
  expect(assessStartSlo(empty, 0, current!.from, current!, now, 0).assessment).toBe("collecting");
  expect(assessStartSlo(empty, 0, previous!.from, previous!, now, checkpoints).assessment).toBe("no_data");
  expect(assessStartSlo({ ...empty, requested: 1 }, 0, previous!.from, previous!, now, checkpoints).assessment).toBe("unresolved");
  expect(assessStartSlo({ ...empty, requested: 1 }, 1, previous!.from, previous!, now, checkpoints).assessment).toBe("failed");
});

it("derives formal decisions from transactional D1 counts, expiry and complete scheduled coverage", async () => {
  const now = Date.parse("2026-11-01T00:00:00Z"), period = startSloPeriods(now)[1]!;
  const player = await fixture();
  await beginStartAttempt(env.DB, player.reservationId, player.playerId, period.from);
  const receipt = (await allowStartReceipt(env.DB, player.reservationId, 1, period.from + 1))!;
  await acknowledgeStart(env.DB, receipt, 1, period.from + 2);
  await env.DB.prepare(`WITH RECURSIVE slots(value) AS (SELECT ? UNION ALL SELECT value + 900000 FROM slots WHERE value < ?)
    INSERT INTO start_slo_coverage(slot_ms) SELECT value FROM slots`).bind(period.from + 900000, period.to).run();
  expect((await collectStartSloReport(env.DB, now)).periods[1]).toMatchObject({ requested: 1, succeeded: 1, assessment: "passed" });
  const missing = await fixture();
  await beginStartAttempt(env.DB, missing.reservationId, missing.playerId, period.from + 1000);
  expect((await collectStartSloReport(env.DB, now)).periods[1]).toMatchObject({ requested: 2, missing_response: 1, successRate: 0.5, assessment: "failed" });
  await env.DB.prepare("DELETE FROM start_slo_coverage WHERE slot_ms = ?").bind(period.to).run();
  expect((await collectStartSloReport(env.DB, now)).periods[1]!.assessment).toBe("coverage_gap");
  await env.DB.prepare("DELETE FROM start_slo_config").run();
  await expect(collectStartSloReport(env.DB, now)).rejects.toThrow("invalid_start_slo_report");
});

it("normalizes the observed Cron execution offset without backfilling old slots", async () => {
  const now = 1792537226644;
  await recordStartSloCoverage(env.DB, 1792537225599, now);
  await recordStartSloCoverage(env.DB, 1792537225.599, now);
  const rows = await env.DB.prepare("SELECT slot_ms FROM start_slo_coverage").all<{ slot_ms: number }>();
  expect(rows.results).toEqual([{ slot_ms: 1792537200000 }]);
  await expect(recordStartSloCoverage(env.DB, Number.NaN, now)).rejects.toThrow();
  await expect(recordStartSloCoverage(env.DB, now + 1000, now)).rejects.toThrow();
  await expect(recordStartSloCoverage(env.DB, now - 3600000, now)).rejects.toThrow();
});
