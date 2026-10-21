import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, expect, it } from "vitest";
import { migrateTestDatabase } from "../migrate-test-database";
import { collectStartAlert, recordStartAlert } from "../../src/monitor/start-slo-alert.mjs";
import { RECEIPT_DRILL_MARKER, RECEIPT_DRILL_DURATION } from "../../src/monitor/start-slo-drill.mjs";
import { handlePlatformRequest } from "../../src/worker/platform";
import { acknowledgeStart, allowStartReceipt, rejectStartAttempt, settleStartAttempts } from "../../src/worker/start-slo";

beforeAll(migrateTestDatabase);
beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM start_slo_attempts"), env.DB.prepare("DELETE FROM start_slo_alert_buckets"),
    env.DB.prepare("INSERT OR REPLACE INTO start_slo_alert_config VALUES (1, ?)").bind(Date.now() - 86400000),
  ]);
});

async function requestStart() {
  const call = (path: string, cookie = "", body?: object) => handlePlatformRequest(new Request("http://localhost/api/platform/" + path,
    { method: body || path.endsWith("/capture") ? "POST" : "GET", headers: { Cookie: cookie, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined }), env.DB, { APP_ENV: "staging" });
  const bootstrap = (await call("bootstrap"))!;
  const cookie = bootstrap.headers.get("set-cookie")!.split(";", 1)[0]!;
  const { playerId } = await bootstrap.json<{ playerId: string }>();
  await call("welcome-credit", cookie, {});
  const reserved = (await call("credit-reservations", cookie, { cabinetId: crypto.randomUUID(), gameId: "graze-duel", purpose: "solo" }))!;
  const { reservationId } = await reserved.json<{ reservationId: string }>();
  const capture = () => call("credit-reservations/" + reservationId + "/capture", cookie);
  expect((await capture())!.status).toBe(200);
  return { reservationId, playerId, capture };
}

it("counts expired requests before hourly settlement and preserves counts after deletion", async () => {
  const player = await requestStart();
  await player.capture();
  const now = Date.now() + 65000;
  expect(await collectStartAlert(env.DB, now)).toMatchObject({ eligible: 1, missing: 1, code: 0, complete: true });
  await settleStartAttempts(env.DB, now);
  expect(await collectStartAlert(env.DB, now)).toMatchObject({ eligible: 1, missing: 1 });
  await env.DB.prepare("DELETE FROM start_slo_attempts WHERE reservation_id = ?").bind(player.reservationId).run();
  expect(await collectStartAlert(env.DB, now)).toMatchObject({ eligible: 1, missing: 1 });
});

it("preserves a deleted unresolved request and excludes owned business denials", async () => {
  const first = await requestStart(), second = await requestStart();
  await env.DB.prepare("DELETE FROM start_slo_attempts WHERE reservation_id = ?").bind(first.reservationId).run();
  await rejectStartAttempt(env.DB, second.reservationId, second.playerId);
  expect(await collectStartAlert(env.DB, Date.now() + 65000)).toMatchObject({ eligible: 1, missing: 1 });
});

it("never treats an acknowledged request as missing or repeats its denominator", async () => {
  const player = await requestStart();
  const receipt = (await allowStartReceipt(env.DB, player.reservationId, 1))!;
  await acknowledgeStart(env.DB, receipt, 1); await acknowledgeStart(env.DB, receipt, 1); await player.capture();
  expect(await collectStartAlert(env.DB, Date.now() + 65000)).toMatchObject({ eligible: 1, missing: 0, code: 0 });
});

it.each([[2, 2, 0], [15, 3, 9], [16, 3, 0], [3, 3, 9]])("uses exact >=3 and >=20%% limits (%i/%i)", async (eligible, missing, code) => {
  const now = Date.now(), bucket = Math.floor(now / 60000) * 60000 - 60000;
  await env.DB.prepare("INSERT INTO start_slo_alert_buckets VALUES (?, ?, 0, ?)").bind(bucket, eligible, missing).run();
  expect(await collectStartAlert(env.DB, now)).toMatchObject({ eligible, missing, code });
});

it("excludes immature and old cohorts and lets failures age out without erasing evidence", async () => {
  const now = Date.now(), to = Math.floor(now / 60000) * 60000;
  for (const bucket of [to - 1200000 - 60000, to]) await env.DB.prepare("INSERT INTO start_slo_alert_buckets VALUES (?, 3, 0, 3)").bind(bucket).run();
  expect(await collectStartAlert(env.DB, now)).toMatchObject({ eligible: 0, missing: 0, code: 0 });
  expect(await collectStartAlert(env.DB, now + 60000)).toMatchObject({ eligible: 3, missing: 3, code: 9 });
  expect(await collectStartAlert(env.DB, now + 1260000)).toMatchObject({ eligible: 0, missing: 0, code: 0 });
  expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM start_slo_alert_buckets").first("count")).toBe(2);
});

it("rejects corrupt or absent monitoring metadata rather than reporting healthy", async () => {
  await env.DB.prepare("DELETE FROM start_slo_alert_config").run();
  await expect(collectStartAlert(env.DB)).rejects.toThrow("invalid_start_alert_counts");
});

it("reports a real missing-table D1 exception as code10 and falls back to the valid database at expiry", async () => {
  const now = Date.now(), points: unknown[] = [];
  const isolated = {
    prepare: (sql: string) => env.DB.prepare(sql.replaceAll("start_slo_", "__missing_start_slo_")),
    batch: (statements: D1PreparedStatement[]) => env.DB.batch(statements),
  };
  const bindings = { MONITOR_ENVIRONMENT: "staging", START_SLO_DB: env.DB, START_SLO_DRILL_DB: isolated, HEALTH_EVENTS: { writeDataPoint: (point: unknown) => points.push(point) },
    START_SLO_DRILL_KIND: RECEIPT_DRILL_MARKER, START_SLO_DRILL_STARTED_MS: String(now), START_SLO_DRILL_UNTIL_MS: String(now + RECEIPT_DRILL_DURATION) };
  expect((await recordStartAlert(bindings, now)).doubles[0]).toBe(10);
  expect((await recordStartAlert(bindings, now + RECEIPT_DRILL_DURATION)).doubles[0]).toBe(0);
  expect(points).toHaveLength(2);
  expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM start_slo_alert_buckets").first("count")).toBe(0);
});
