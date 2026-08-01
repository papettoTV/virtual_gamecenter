import { env, exports } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import { registerGoogleAccount } from "../../src/worker/google-auth";

beforeAll(async () => {
  await env.DB.batch([
    env.DB.prepare("CREATE TABLE accounts (id TEXT PRIMARY KEY, display_name TEXT NOT NULL, avatar_url TEXT, updated_at TEXT DEFAULT CURRENT_TIMESTAMP)"),
    env.DB.prepare("CREATE TABLE account_identities (provider TEXT NOT NULL, provider_subject TEXT NOT NULL, account_id TEXT NOT NULL, email TEXT, PRIMARY KEY (provider, provider_subject))"),
    env.DB.prepare("CREATE TABLE players (id TEXT PRIMARY KEY, display_name TEXT, guest_name TEXT UNIQUE, account_id TEXT UNIQUE, updated_at TEXT DEFAULT CURRENT_TIMESTAMP)"),
    env.DB.prepare("CREATE TABLE player_sessions (token_hash TEXT PRIMARY KEY, player_id TEXT NOT NULL, expires_at TEXT NOT NULL, last_seen_at TEXT DEFAULT CURRENT_TIMESTAMP)"),
    env.DB.prepare("CREATE TABLE consent_records (id TEXT PRIMARY KEY, player_id TEXT NOT NULL, policy_type TEXT NOT NULL, policy_version TEXT NOT NULL)"),
    env.DB.prepare("CREATE TABLE credit_wallets (player_id TEXT PRIMARY KEY, free_balance INTEGER NOT NULL DEFAULT 0, purchased_balance INTEGER NOT NULL DEFAULT 0, updated_at TEXT DEFAULT CURRENT_TIMESTAMP)"),
    env.DB.prepare("CREATE TABLE credit_ledger_entries (id TEXT PRIMARY KEY, player_id TEXT NOT NULL, balance_type TEXT NOT NULL, entry_type TEXT NOT NULL, amount INTEGER NOT NULL, reference_id TEXT)"),
    env.DB.prepare("CREATE TRIGGER credit_ledger_free AFTER INSERT ON credit_ledger_entries WHEN NEW.balance_type = 'free' BEGIN UPDATE credit_wallets SET free_balance = free_balance + NEW.amount WHERE player_id = NEW.player_id; END"),
    env.DB.prepare("CREATE TABLE credit_reservations (id TEXT PRIMARY KEY, player_id TEXT NOT NULL, amount INTEGER NOT NULL, balance_type TEXT NOT NULL, status TEXT NOT NULL, expires_at TEXT NOT NULL)"),
    env.DB.prepare("CREATE TABLE rankings (id INTEGER PRIMARY KEY AUTOINCREMENT, player_name TEXT NOT NULL, clear_time_ms INTEGER NOT NULL, cleared INTEGER NOT NULL DEFAULT 1, score INTEGER NOT NULL, max_level INTEGER NOT NULL, defeated_boss_count INTEGER NOT NULL DEFAULT 3, client_version TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP)"),
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

  it("starts Google registration with the configured callback", async () => {
    const response = await exports.default.fetch(
      "http://localhost/api/platform/auth/google/start?returnTo=%2Fcabinets%2Fabc%3Fmode%3Dhost",
      { redirect: "manual" },
    );
    expect(response.status).toBe(302);
    const location = new URL(response.headers.get("location")!);
    expect(location.origin).toBe("https://accounts.google.com");
    expect(location.searchParams.get("redirect_uri")).toBe(
      "http://localhost/api/platform/auth/google/callback",
    );
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

  it("registers a game-over score without marking the result as cleared", async () => {
    const bootstrapResponse = await exports.default.fetch("http://localhost/api/platform/bootstrap");
    const cookie = bootstrapResponse.headers.get("set-cookie")?.split(";", 1)[0];
    const clientVersion = `game-over-test-${crypto.randomUUID()}`;

    const response = await exports.default.fetch("http://localhost/api/ranking", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookie!,
      },
      body: JSON.stringify({
        elapsedTimeMs: 45_000,
        cleared: false,
        score: 12_345,
        maxLevel: 18,
        defeatedBossCount: 1,
        clientVersion,
      }),
    });
    expect(response.status).toBe(200);

    const rankingResponse = await exports.default.fetch(
      `http://localhost/api/ranking?type=score&limit=1&version=${clientVersion}`,
    );
    const ranking = await rankingResponse.json<{
      rankings: Array<{
        cleared: number;
        play_time_ms: number;
        defeated_boss_count: number;
      }>;
    }>();
    expect(ranking.rankings[0]).toMatchObject({
      cleared: 0,
      play_time_ms: 45_000,
      defeated_boss_count: 1,
    });
  });

  it("upgrades the current guest player and grants registration credits", async () => {
    const bootstrapResponse = await exports.default.fetch("http://localhost/api/platform/bootstrap");
    const before = await bootstrapResponse.json<{ playerId: string; playerName: string }>();
    const cookie = bootstrapResponse.headers.get("set-cookie")?.split(";", 1)[0];
    const token = cookie?.split("=")[1];
    expect(token).toBeTruthy();

    await registerGoogleAccount(env.DB, {
      playerId: before.playerId,
      token: token!,
      secureCookie: false,
    }, {
      sub: `google-${crypto.randomUUID()}`,
      name: "テストプレイヤー",
      picture: "https://example.com/avatar.png",
      email: "player@example.com",
    });

    const registeredResponse = await exports.default.fetch("http://localhost/api/platform/bootstrap", {
      headers: { Cookie: cookie! },
    });
    const registered = await registeredResponse.json<{
      playerId: string;
      playerName: string;
      accountRegistered: boolean;
      avatarUrl: string;
      wallet: { availableTotal: number };
    }>();
    expect(registered.playerId).toBe(before.playerId);
    expect(registered.playerName).toBe("テストプレイヤー");
    expect(registered.accountRegistered).toBe(true);
    expect(registered.avatarUrl).toBe("https://example.com/avatar.png");
    expect(registered.wallet.availableTotal).toBe(5);

    const updateResponse = await exports.default.fetch("http://localhost/api/platform/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: cookie! },
      body: JSON.stringify({ playerName: "変更後の名前" }),
    });
    expect(updateResponse.status).toBe(200);
    const updated = await updateResponse.json<{ identity: { playerName: string } }>();
    expect(updated.identity.playerName).toBe("変更後の名前");
  });

  it("logs into the shared developer account locally and returns to the source screen", async () => {
    const bootstrapResponse = await exports.default.fetch("http://localhost/api/platform/bootstrap");
    const cookie = bootstrapResponse.headers.get("set-cookie")?.split(";", 1)[0];
    expect(cookie).toBeTruthy();

    const loginResponse = await exports.default.fetch(
      "http://localhost/api/platform/auth/developer?returnTo=%2Fcabinets%2Fdev%3Fmode%3Dhost",
      { headers: { Cookie: cookie! }, redirect: "manual" },
    );
    expect(loginResponse.status).toBe(302);
    expect(loginResponse.headers.get("location")).toBe(
      "http://localhost/cabinets/dev?mode=host&account=registered",
    );

    const registeredResponse = await exports.default.fetch("http://localhost/api/platform/bootstrap", {
      headers: { Cookie: cookie! },
    });
    const registered = await registeredResponse.json<{
      playerId: string;
      playerName: string;
      accountRegistered: boolean;
      wallet: { availableTotal: number };
    }>();
    expect(registered.playerName).toBe("開発者ユーザー");
    expect(registered.accountRegistered).toBe(true);
    expect(registered.wallet.availableTotal).toBe(5);

    const logoutResponse = await exports.default.fetch("http://localhost/api/platform/auth/logout", {
      method: "POST",
      headers: { Cookie: cookie! },
    });
    expect(logoutResponse.status).toBe(200);
    const guest = await logoutResponse.json<{
      playerId: string;
      playerName: string;
      accountRegistered: boolean;
      wallet: { availableTotal: number };
    }>();
    expect(guest.playerId).not.toBe(registered.playerId);
    expect(guest.playerName).toMatch(/^Player-[a-f0-9]{8}$/);
    expect(guest.accountRegistered).toBe(false);
    expect(guest.wallet.availableTotal).toBe(0);
    expect(logoutResponse.headers.get("set-cookie")).toContain("vgc_session=");
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
