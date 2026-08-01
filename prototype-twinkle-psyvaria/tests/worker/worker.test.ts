import { env, exports } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";

beforeAll(async () => {
  await env.DB.batch([
    env.DB.prepare("CREATE TABLE players (id TEXT PRIMARY KEY, display_name TEXT, guest_name TEXT UNIQUE)"),
    env.DB.prepare("CREATE TABLE player_sessions (token_hash TEXT PRIMARY KEY, player_id TEXT NOT NULL, expires_at TEXT NOT NULL, last_seen_at TEXT DEFAULT CURRENT_TIMESTAMP)"),
    env.DB.prepare("CREATE TABLE consent_records (id TEXT PRIMARY KEY, player_id TEXT NOT NULL, policy_type TEXT NOT NULL, policy_version TEXT NOT NULL)"),
    env.DB.prepare("CREATE TABLE credit_wallets (player_id TEXT PRIMARY KEY, free_balance INTEGER NOT NULL DEFAULT 0, purchased_balance INTEGER NOT NULL DEFAULT 0, updated_at TEXT DEFAULT CURRENT_TIMESTAMP)"),
    env.DB.prepare("CREATE TABLE credit_reservations (id TEXT PRIMARY KEY, player_id TEXT NOT NULL, amount INTEGER NOT NULL, balance_type TEXT NOT NULL, status TEXT NOT NULL, expires_at TEXT NOT NULL)"),
    env.DB.prepare("CREATE TABLE rankings (id INTEGER PRIMARY KEY AUTOINCREMENT, player_name TEXT NOT NULL, clear_time_ms INTEGER NOT NULL, score INTEGER NOT NULL, max_level INTEGER NOT NULL, client_version TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP)"),
    env.DB.prepare("CREATE TABLE game_results (id TEXT PRIMARY KEY, game_id TEXT NOT NULL, game_version TEXT NOT NULL, mode TEXT NOT NULL, player_id TEXT, player_name TEXT NOT NULL, cleared INTEGER NOT NULL, clear_time_ms INTEGER, score INTEGER NOT NULL, max_level INTEGER NOT NULL, defeated_boss_count INTEGER NOT NULL)"),
  ]);
});

describe("Cloudflare Worker", () => {
  it("serves the health endpoint locally", async () => {
    const response = await exports.default.fetch("http://localhost/api/health");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      runtime: "cloudflare-workers",
    });
  });

  it("uses the server-issued guest name for ranking entries", async () => {
    const bootstrapResponse = await exports.default.fetch("http://localhost/api/platform/bootstrap");
    const bootstrap = await bootstrapResponse.json<{ playerName: string }>();
    const cookie = bootstrapResponse.headers.get("set-cookie")?.split(";", 1)[0];
    expect(cookie).toBeTruthy();
    const clientVersion = `guest-name-test-${crypto.randomUUID()}`;

    const response = await exports.default.fetch("http://localhost/api/ranking", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookie!,
      },
      body: JSON.stringify({
        playerName: "CHANGED-NAME",
        clearTimeMs: 1000,
        score: 100,
        maxLevel: 1,
        clientVersion,
      }),
    });
    expect(response.status).toBe(200);

    const rankingResponse = await exports.default.fetch(
      `http://localhost/api/ranking?type=score&limit=1&version=${clientVersion}`,
    );
    const ranking = await rankingResponse.json<{ rankings: Array<{ player_name: string }> }>();
    expect(ranking.rankings[0]?.player_name).toBe(bootstrap.playerName);
    expect(ranking.rankings[0]?.player_name).not.toBe("CHANGED-NAME");
  });

  it("rejects writes to the cabinet directory endpoint", async () => {
    const response = await exports.default.fetch("http://localhost/api/cabinets", {
      method: "POST",
    });
    expect(response.status).toBe(405);
    await expect(response.json()).resolves.toEqual({
      error: "method_not_allowed",
    });
  });
});
