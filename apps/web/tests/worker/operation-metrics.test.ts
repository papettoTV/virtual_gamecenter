import { beforeAll, expect, it, vi } from "vitest";
import { env } from "cloudflare:workers";
import { observeOperation, operationMetrics, recordOperation, type Operation } from "../../src/worker/operation-metrics";
import { handlePlatformRequest } from "../../src/worker/platform";
import { registerGoogleAccount } from "../../src/worker/google-auth";
import { reconcileBetaCredits } from "../../src/worker/beta-credits";
import { migrateTestDatabase } from "../migrate-test-database";

beforeAll(migrateTestDatabase);

async function guest() {
  const response = (await handlePlatformRequest(new Request("http://localhost/api/platform/bootstrap"), env.DB))!;
  const cookie = response.headers.getSetCookie().map(value => value.split(";", 1)[0]).join("; ");
  return { ...(await response.json<{ playerId: string }>()), cookie, token: /vgc_session=([^;]+)/.exec(cookie)![1]! };
}

it("measures welcome, registration and daily grants without counting idempotent reads as successes", async () => {
  const writeDataPoint = vi.fn(), metrics = { writeDataPoint };
  const player = await guest();
  const request = () => new Request("http://localhost/api/platform/welcome-credit", { method: "POST", headers: { Cookie: player.cookie } });
  for (let attempt = 0; attempt < 2; attempt += 1) expect((await handlePlatformRequest(request(), env.DB, { APP_ENV: "staging", SECURITY_EVENTS: metrics }))!.status).toBe(200);
  expect(writeDataPoint.mock.calls.map(call => call[0].blobs[1])).toEqual(["welcome_credit"]);
  await env.DB.prepare("INSERT INTO credit_ledger_entries (id, player_id, balance_type, entry_type, amount, reference_id) VALUES (?, ?, 'free', 'consumed', -5, 'operation-test')").bind(crypto.randomUUID(), player.playerId).run();
  for (let attempt = 0; attempt < 2; attempt += 1) await reconcileBetaCredits(env.DB, player.playerId, crypto.randomUUID(), false, new Date(), metrics);
  expect(writeDataPoint.mock.calls.map(call => call[0].blobs[1])).toEqual(["welcome_credit", "daily_credit"]);
  const profile = { sub: crypto.randomUUID(), name: "Private profile", email: "private@example.invalid" };
  for (let attempt = 0; attempt < 2; attempt += 1) await registerGoogleAccount(env.DB, { playerId: player.playerId, token: player.token, secureCookie: false }, profile, metrics);
  expect(writeDataPoint.mock.calls.map(call => call[0].blobs[1])).toEqual(["welcome_credit", "daily_credit", "registration_credit"]);
  expect(JSON.stringify(writeDataPoint.mock.calls)).not.toContain(player.playerId);
  expect(JSON.stringify(writeDataPoint.mock.calls)).not.toContain("Private");
});

it.each(["welcome", "daily", "registration"])("records a failed %s transaction and preserves the original database error", async kind => {
  const player = await guest();
  const writeDataPoint = vi.fn(), metrics = { writeDataPoint }, failure = Error("private SQL and token");
  const database = new Proxy(env.DB, { get(target, key) {
    if (key === "batch") return async () => { throw failure; };
    const value = Reflect.get(target, key, target);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const operation = kind === "welcome" ? handlePlatformRequest(new Request("http://localhost/api/platform/welcome-credit", { method: "POST", headers: { Cookie: player.cookie } }), database, { APP_ENV: "staging", SECURITY_EVENTS: metrics })
    : kind === "daily" ? reconcileBetaCredits(database, player.playerId, "test-device", false, new Date(), metrics)
    : registerGoogleAccount(database, { playerId: player.playerId, token: player.token, secureCookie: false }, { sub: crypto.randomUUID(), name: "Test" }, metrics);
  await expect(operation).rejects.toBe(failure);
  expect(writeDataPoint).toHaveBeenCalledTimes(1);
  expect(writeDataPoint.mock.calls[0]![0].doubles).toEqual([1, 1, 0, 0, 0]);
});

it.each(["solo_start", "versus_start", "google_login", "welcome_credit", "registration_credit", "daily_credit"] as Operation[])("records privacy-safe operation results for %s", async operation => {
  const writeDataPoint = vi.fn();
  const result = await observeOperation({ writeDataPoint }, operation, async () => "private-result", undefined, "private-player-id");
  expect(result).toBe("private-result");
  expect(writeDataPoint).toHaveBeenCalledTimes(1);
  const point = writeDataPoint.mock.calls[0]![0];
  expect(point.doubles).toEqual([1, 0, 1, 0, 0]);
  expect(JSON.stringify(point)).not.toContain("private");
  expect(point.blobs[2]).toBe("operation-v1");
});

it("keeps cancellations and expected denials out of the technical-failure denominator", () => {
  const writeDataPoint = vi.fn();
  recordOperation({ writeDataPoint }, "solo_start", "rejected", "graze-duel");
  recordOperation({ writeDataPoint }, "google_login", "cancelled");
  recordOperation({ writeDataPoint }, "daily_credit", "noop");
  expect(writeDataPoint.mock.calls.map(call => call[0].doubles)).toEqual([[0, 0, 0, 1, 0], [0, 0, 0, 0, 1]]);
});

it("preserves original failures and does not make telemetry failure a business failure", async () => {
  const error = Error("private token");
  const writeDataPoint = vi.fn();
  await expect(observeOperation({ writeDataPoint }, "welcome_credit", async () => { throw error; })).rejects.toBe(error);
  expect(writeDataPoint.mock.calls[0]![0].doubles).toEqual([1, 1, 0, 0, 0]);
  const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    expect(await observeOperation({ writeDataPoint() { throw error; } }, "welcome_credit", async () => 5)).toBe(5);
    expect(warning).toHaveBeenCalledExactlyOnceWith("operation_metrics_failed");
  } finally { warning.mockRestore(); }
});

it("enables operation telemetry only in staging", () => {
  const writeDataPoint = vi.fn();
  expect(operationMetrics({ APP_ENV: "production", SECURITY_EVENTS: { writeDataPoint } })).toBeUndefined();
  expect(operationMetrics({ APP_ENV: "local", SECURITY_EVENTS: { writeDataPoint } })).toBeUndefined();
  expect(operationMetrics({ APP_ENV: "staging", SECURITY_EVENTS: { writeDataPoint } })).toEqual({ writeDataPoint });
});

it.each(["success", "failure", "cancelled", "invalid_state"])("measures Google callback %s without counting unsafe callbacks", async outcome => {
  const player = await guest(), writeDataPoint = vi.fn();
  const config = { APP_ENV: "staging", SECURITY_EVENTS: { writeDataPoint }, GOOGLE_CLIENT_ID: "test-client", GOOGLE_CLIENT_SECRET: "test-secret" };
  await env.DB.batch(["terms", "privacy"].map(kind => env.DB.prepare("INSERT INTO consent_records (id, player_id, policy_type, policy_version) VALUES (?, ?, ?, ?)")
    .bind(crypto.randomUUID(), player.playerId, kind, kind === "terms" ? "2026-10-12.3" : "2026-10-14.1")));
  const state = crypto.randomUUID(), stateCookie = "vgc_oauth_state=" + encodeURIComponent(JSON.stringify({ state, returnTo: "/" }));
  const upstream = vi.spyOn(globalThis, "fetch").mockImplementation(async input => {
    if (outcome === "failure") throw Error("private upstream token");
    const url = input instanceof Request ? input.url : String(input);
    return url.includes("/token") ? Response.json({ access_token: "private-test-token" }) : Response.json({ sub: crypto.randomUUID(), name: "Private profile" });
  });
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    const query = outcome === "cancelled" ? "error=access_denied" : "code=private-code";
    const response = await handlePlatformRequest(new Request(`http://localhost/api/platform/auth/google/callback?state=${outcome === "invalid_state" ? "wrong" : state}&${query}`, { headers: { Cookie: `${player.cookie}; ${stateCookie}` } }), env.DB, config);
    expect(response!.status).toBe(302);
    const login = writeDataPoint.mock.calls.map(call => call[0]).filter(point => point.blobs[1] === "google_login");
    expect(login).toHaveLength(outcome === "invalid_state" ? 0 : 1);
    if (login.length) expect(login[0].blobs[3]).toBe(outcome);
    expect(JSON.stringify(writeDataPoint.mock.calls)).not.toContain("private");
  } finally { upstream.mockRestore(); log.mockRestore(); }
});
