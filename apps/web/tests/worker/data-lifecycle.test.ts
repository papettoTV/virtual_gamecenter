import { env, exports } from "cloudflare:workers";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { migrateTestDatabase } from "../migrate-test-database";
import { handleDataLifecycleRequest, hashIdentifier, processDeletion, replayDeletionAudit, runRetention, type LifecycleRooms } from "../../src/worker/data-lifecycle";
import { registerGoogleAccount } from "../../src/worker/google-auth";
import { handlePlatformRequest } from "../../src/worker/platform";

beforeAll(migrateTestDatabase);

const removePlayerData = vi.fn(async () => {});
const expireIdleData = vi.fn(async () => {});
const rooms = { idFromName: (name: string) => name, get: () => ({ removePlayerData, expireIdleData }) } as unknown as LifecycleRooms;

async function guest() {
  const response = await exports.default.fetch("http://localhost/api/platform/bootstrap");
  const state = await response.json<{ playerId: string }>();
  const cookies = response.headers.getSetCookie().map(cookie => cookie.split(";")[0]).join("; ");
  const token = /vgc_session=([^;]+)/.exec(cookies)![1]!;
  await exports.default.fetch("http://localhost/api/platform/welcome-credit", { method: "POST", headers: { Cookie: cookies } });
  return { ...state, cookies, token };
}

async function api(path: string, cookie: string, method = "GET", body?: unknown, origin = "http://localhost") {
  return (await handleDataLifecycleRequest(new Request(`http://localhost/api/platform/data-deletion/${path}`, {
    method, headers: { Cookie: cookie, Origin: origin, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined,
  }), env.DB, rooms, env.DELETION_AUDIT))!;
}

async function preview(cookie: string, scope = "all") {
  return (await api(`preview?scope=${scope}`, cookie)).json<{ confirmationToken: string; reauthRequired: boolean }>();
}

async function record(playerId: string, name = "same-name") {
  const id = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO rankings (owner_id, player_name, clear_time_ms, score, max_level, client_version) VALUES (?, ?, 1000, 10, 1, 'test')").bind(playerId, name),
    env.DB.prepare("INSERT INTO shared_results (id, owner_id, player_name, game_id, game_version, elapsed_time_ms, cleared, score, metrics_json) VALUES (?, ?, ?, 'graze-duel', 'test', 1000, 1, 10, '{}')").bind(id, playerId, name),
  ]);
  return id;
}

describe("data deletion", () => {
  it("fails closed without independent audit storage and preserves the user", async () => {
    const target = await guest();
    const confirmation = await preview(target.cookies);
    const response = await handleDataLifecycleRequest(new Request("http://localhost/api/platform/data-deletion/request", { method: "POST", headers: { Origin: "http://localhost", Cookie: target.cookies }, body: JSON.stringify(confirmation) }), env.DB, rooms);
    expect(response?.status).toBe(503);
    expect(await env.DB.prepare("SELECT * FROM players WHERE id = ?").bind(target.playerId).first()).not.toBeNull();
  });
  it("deletes only the authenticated guest, invalidates every session, and keeps no original player in the receipt", async () => {
    const target = await guest(); const other = await guest();
    const targetResult = await record(target.playerId); const otherResult = await record(other.playerId);
    await env.DB.prepare("INSERT INTO player_sessions (token_hash, player_id, expires_at) VALUES (?, ?, '2099-01-01')").bind(await hashIdentifier("second-device"), target.playerId).run();
    await env.DB.prepare("INSERT INTO player_cabinets VALUES (?, 'room', CURRENT_TIMESTAMP)").bind(target.playerId).run();
    const confirmation = await preview(target.cookies);
    const response = await api("request", target.cookies, "POST", { confirmationToken: confirmation.confirmationToken, playerId: other.playerId });
    expect(response.status).toBe(200);
    const receipt = await response.json<{ id: string; receipt: string; status: string }>();
    expect(receipt.status).toBe("completed");
    expect(await env.DB.prepare("SELECT * FROM players WHERE id = ?").bind(target.playerId).first()).toBeNull();
    expect(await env.DB.prepare("SELECT * FROM shared_results WHERE id = ?").bind(targetResult).first()).toBeNull();
    expect(await env.DB.prepare("SELECT * FROM shared_results WHERE id = ?").bind(otherResult).first()).not.toBeNull();
    expect(await env.DB.prepare("SELECT * FROM rankings WHERE owner_id = ?").bind(other.playerId).first()).not.toBeNull();
    expect(await env.DB.prepare("SELECT * FROM player_sessions WHERE player_id = ?").bind(target.playerId).first()).toBeNull();
    expect(removePlayerData).toHaveBeenCalledWith(target.playerId);
    const job = await env.DB.prepare("SELECT player_id, account_id FROM data_deletions WHERE id = ?").bind(receipt.id).first();
    expect(job).toEqual({ player_id: null, account_id: null });
    const status = await handleDataLifecycleRequest(new Request(`http://localhost/api/platform/data-deletion/${receipt.id}`, { headers: { "X-Deletion-Receipt": receipt.receipt } }), env.DB, rooms, env.DELETION_AUDIT);
    expect(status?.status).toBe(200);
    expect((await api(receipt.id, other.cookies)).status).toBe(401);
    expect((await api("preview", target.cookies)).status).toBe(401);
  });

  it("protects against cross-origin, missing/foreign/expired confirmation and unverified account deletion", async () => {
    const target = await guest(); const other = await guest();
    const confirmation = await preview(target.cookies);
    expect((await api("request", target.cookies, "POST", confirmation, "https://evil.test")).status).toBe(403);
    expect((await api("request", target.cookies, "POST", {})).status).toBe(400);
    expect((await api("request", other.cookies, "POST", confirmation)).status).toBe(409);
    await registerGoogleAccount(env.DB, { playerId: target.playerId, token: target.token, secureCookie: false }, { sub: crypto.randomUUID(), name: "Test" });
    await env.DB.prepare("DELETE FROM verified_sessions WHERE player_id = ?").bind(target.playerId).run();
    expect((await preview(target.cookies)).reauthRequired).toBe(true);
    expect((await api("request", target.cookies, "POST", confirmation)).status).toBe(403);
    await env.DB.prepare("UPDATE deletion_confirmations SET expires_at = '2000-01-01' WHERE player_id = ?").bind(target.playerId).run();
    expect((await api("request", target.cookies, "POST", confirmation)).status).toBe(409);
  });

  it("removes account data, keeps only benefit claims and prevents registration bonus after rejoining", async () => {
    const target = await guest(); const subject = crypto.randomUUID();
    await registerGoogleAccount(env.DB, { playerId: target.playerId, token: target.token, secureCookie: false }, { sub: subject, name: "private-name", email: "private@example.test", picture: "https://example.test/icon" });
    const account = await env.DB.prepare("SELECT account_id FROM players WHERE id = ?").bind(target.playerId).first<{ account_id: string }>();
    const confirmation = await preview(target.cookies);
    expect((await api("request", target.cookies, "POST", confirmation)).status).toBe(200);
    expect(await env.DB.prepare("SELECT * FROM accounts WHERE id = ?").bind(account!.account_id).first()).toBeNull();
    expect(await env.DB.prepare("SELECT * FROM account_identities WHERE provider_subject = ?").bind(subject).first()).toBeNull();
    const newPlayer = await guest();
    await registerGoogleAccount(env.DB, { playerId: newPlayer.playerId, token: newPlayer.token, secureCookie: false }, { sub: subject, name: "new-name" });
    expect((await env.DB.prepare("SELECT free_balance FROM credit_wallets WHERE player_id = ?").bind(newPlayer.playerId).first<{ free_balance: number }>())!.free_balance).toBe(5);
  });

  it("does not regrant welcome or today's refill after deleting the guest", async () => {
    const target = await guest();
    await env.DB.prepare("UPDATE credit_wallets SET free_balance = 0 WHERE player_id = ?").bind(target.playerId).run();
    await exports.default.fetch("http://localhost/api/platform/credits", { headers: { Cookie: target.cookies } });
    const confirmation = await preview(target.cookies);
    expect((await api("request", target.cookies, "POST", confirmation)).status).toBe(200);
    const device = /vgc_device=[^;]+/.exec(target.cookies)![0];
    const response = await exports.default.fetch("http://localhost/api/platform/bootstrap", { headers: { Cookie: device } });
    const state = await response.json<{ welcomeCreditGranted: boolean; wallet: { availableTotal: number }; creditPolicy: { refilledToday: boolean } }>();
    expect(state.welcomeCreditGranted).toBe(true);
    expect(state.wallet.availableTotal).toBe(0);
    expect(state.creditPolicy.refilledToday).toBe(true);
  });

  it("requires the same Google identity when reauthenticating, without granting another bonus", async () => {
    const target = await guest(); const subject = crypto.randomUUID();
    await registerGoogleAccount(env.DB, { playerId: target.playerId, token: target.token, secureCookie: false }, { sub: subject, name: "Google Test" });
    await env.DB.prepare("DELETE FROM verified_sessions WHERE player_id = ?").bind(target.playerId).run();
    const config = { GOOGLE_CLIENT_ID: "test-client", GOOGLE_CLIENT_SECRET: "test-secret" };
    const start = await handlePlatformRequest(new Request("http://localhost/api/platform/auth/reauth?returnTo=%2F%3Fdeletion%3Dall", { headers: { Cookie: target.cookies } }), env.DB, config);
    expect(start!.status).toBe(302);
    const state = new URL(start!.headers.get("Location")!).searchParams.get("state");
    const authCookie = start!.headers.get("Set-Cookie")!.split(";")[0];
    let returnedSubject = "wrong-account";
    const mockedFetch = vi.spyOn(globalThis, "fetch").mockImplementation(async input => {
      const url = String(input);
      if (url.includes("/token")) return Response.json({ access_token: "local-test-token" });
      if (url.includes("/userinfo")) return Response.json({ sub: returnedSubject, name: "Test" });
      throw new Error("unexpected network request");
    });
    try {
      const callback = () => handlePlatformRequest(new Request(`http://localhost/api/platform/auth/google/callback?state=${state}&code=test-code`, { headers: { Cookie: `${target.cookies}; ${authCookie}` } }), env.DB, config);
      const rejected = await callback();
      expect(rejected!.headers.get("Location")).toContain("reauth_account_mismatch");
      expect((await preview(target.cookies)).reauthRequired).toBe(true);
      returnedSubject = subject;
      const accepted = await callback();
      expect(accepted!.headers.get("Location")).toBe("http://localhost/?deletion=all");
      expect((await preview(target.cookies)).reauthRequired).toBe(false);
      expect((await env.DB.prepare("SELECT free_balance FROM credit_wallets WHERE player_id = ?").bind(target.playerId).first<{ free_balance: number }>())!.free_balance).toBe(10);
    } finally { mockedFetch.mockRestore(); }
  });

  it("preserves purchased balances and pending or paid transactions for manual handling", async () => {
    const target = await guest();
    await env.DB.prepare("UPDATE credit_wallets SET purchased_balance = 5 WHERE player_id = ?").bind(target.playerId).run();
    expect((await api("request", target.cookies, "POST", await preview(target.cookies))).status).toBe(409);
    expect(await env.DB.prepare("SELECT * FROM players WHERE id = ?").bind(target.playerId).first()).not.toBeNull();
    expect((await api("request", target.cookies, "POST", await preview(target.cookies, "public"))).status).toBe(200);
  });

  it("public-only deletion preserves profile and wallet, and reused tokens cannot delete twice", async () => {
    const target = await guest(); await record(target.playerId);
    const confirmation = await preview(target.cookies, "public");
    expect((await api("request", target.cookies, "POST", confirmation)).status).toBe(200);
    expect((await api("request", target.cookies, "POST", confirmation)).status).toBe(409);
    expect(await env.DB.prepare("SELECT * FROM players WHERE id = ?").bind(target.playerId).first()).not.toBeNull();
    expect((await env.DB.prepare("SELECT free_balance FROM credit_wallets WHERE player_id = ?").bind(target.playerId).first<{ free_balance: number }>())!.free_balance).toBe(5);
  });

  it("keeps a failed cleanup pending and hides records until an idempotent retry succeeds", async () => {
    const target = await guest(); const result = await record(target.playerId);
    await env.DB.prepare("INSERT INTO player_cabinets VALUES (?, 'retry-room', CURRENT_TIMESTAMP)").bind(target.playerId).run();
    removePlayerData.mockRejectedValueOnce(new Error("temporary"));
    const response = await api("request", target.cookies, "POST", await preview(target.cookies));
    expect(response.status).toBe(202);
    const receipt = await response.json<{ id: string }>();
    expect((await exports.default.fetch(`http://localhost/api/results/${result}`)).status).toBe(404);
    const job = { id: receipt.id, player_id: target.playerId, scope: "all" as const, status: "pending" };
    await processDeletion(env.DB, rooms, job, env.DELETION_AUDIT);
    await processDeletion(env.DB, rooms, job, env.DELETION_AUDIT);
    expect((await env.DB.prepare("SELECT status FROM data_deletions WHERE id = ?").bind(receipt.id).first<{ status: string }>())!.status).toBe("completed");
  });
});

describe("retention", () => {
  it("reapplies accepted deletions after the D1 deletion receipt is rolled back", async () => {
    const target = await guest();
    const response = await api("request", target.cookies, "POST", await preview(target.cookies));
    const receipt = await response.json<{ id: string }>();
    await env.DB.prepare("DELETE FROM data_deletions WHERE id = ?").bind(receipt.id).run();
    await env.DB.prepare("INSERT INTO players (id, guest_name) VALUES (?, 'restored')").bind(target.playerId).run();
    await record(target.playerId);
    await replayDeletionAudit(env.DB, rooms, env.DELETION_AUDIT);
    expect(await env.DB.prepare("SELECT * FROM players WHERE id = ?").bind(target.playerId).first()).toBeNull();
    expect(await env.DB.prepare("SELECT * FROM rankings WHERE owner_id = ?").bind(target.playerId).first()).toBeNull();
  });
  it("expires detail records but retains current-day refill, balances and independent eligibility", async () => {
    const target = await guest();
    await env.DB.prepare("UPDATE credit_ledger_entries SET created_at = '2000-01-01' WHERE player_id = ?").bind(target.playerId).run();
    await env.DB.prepare("INSERT INTO sharing_events (id, event_type, kind, game_id, target_id, created_at) VALUES ('old', 'result_viewed', 'result', 'graze-duel', 'old', '2000-01-01')").run();
    await runRetention(env.DB, rooms, env.DELETION_AUDIT);
    expect(await env.DB.prepare("SELECT * FROM sharing_events WHERE id = 'old'").first()).toBeNull();
    expect((await env.DB.prepare("SELECT free_balance FROM credit_wallets WHERE player_id = ?").bind(target.playerId).first<{ free_balance: number }>())!.free_balance).toBe(5);
    await env.DB.prepare("UPDATE credit_wallets SET free_balance = 0 WHERE player_id = ?").bind(target.playerId).run();
    const response = await exports.default.fetch("http://localhost/api/platform/credits", { headers: { Cookie: target.cookies } });
    expect((await response.json<{ wallet: { availableTotal: number } }>()).wallet.availableTotal).toBe(3);
    await runRetention(env.DB, rooms, env.DELETION_AUDIT);
    expect(await env.DB.prepare("SELECT * FROM beta_daily_refills WHERE player_id = ?").bind(target.playerId).first()).not.toBeNull();
  });

  it("expires inactive unpaid guests without deleting an active guest or a registered user", async () => {
    const expired = await guest(); const active = await guest(); const registered = await guest();
    await env.DB.prepare("UPDATE players SET created_at = '2000-01-01'").run();
    await env.DB.prepare("UPDATE player_sessions SET last_seen_at = '2000-01-01' WHERE player_id = ?").bind(expired.playerId).run();
    await registerGoogleAccount(env.DB, { playerId: registered.playerId, token: registered.token, secureCookie: false }, { sub: crypto.randomUUID(), name: "Registered" });
    await env.DB.prepare("UPDATE player_sessions SET last_seen_at = '2000-01-01' WHERE player_id = ?").bind(registered.playerId).run();
    await runRetention(env.DB, rooms, env.DELETION_AUDIT);
    expect(await env.DB.prepare("SELECT * FROM players WHERE id = ?").bind(expired.playerId).first()).toBeNull();
    expect(await env.DB.prepare("SELECT * FROM players WHERE id = ?").bind(active.playerId).first()).not.toBeNull();
    expect(await env.DB.prepare("SELECT * FROM players WHERE id = ?").bind(registered.playerId).first()).not.toBeNull();
  });
});
