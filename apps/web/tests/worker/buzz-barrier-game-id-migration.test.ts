import { env } from "cloudflare:workers";
import { expect, it } from "vitest";
import { migrateTestDatabaseWithHook } from "../migrate-test-database";

it("moves the game ID without changing users, wallets, or credit history", async () => {
  const tables = ["accounts", "players", "credit_wallets", "credit_ledger_entries", "credit_reservations"];
  const snapshot = () => Promise.all(tables.map(async table => (await env.DB.prepare(`SELECT * FROM ${table}`).all()).results));
  let before: Awaited<ReturnType<typeof snapshot>> | undefined;
  await migrateTestDatabaseWithHook(async path => {
    if (!path.endsWith("/0026_buzz_barrier_game_id.sql")) return;
    await env.DB.batch([
      "INSERT INTO accounts (id, display_name) VALUES ('account', 'Test user')",
      "INSERT INTO players (id, account_id) VALUES ('player', 'account')",
      "INSERT INTO credit_wallets (player_id, free_balance, purchased_balance) VALUES ('player', 4, 2)",
      "INSERT INTO play_sessions (id, cabinet_id, game_id, mode, status, host_player_id) VALUES ('play', 'cabinet', 'graze-duel', 'solo', 'ended', 'player')",
      "INSERT INTO credit_ledger_entries (id, player_id, balance_type, entry_type, amount, play_session_id) VALUES ('ledger', 'player', 'free', 'consumed', -1, 'play')",
      "INSERT INTO credit_reservations (id, player_id, play_session_id, amount, balance_type, status, expires_at) VALUES ('reserve', 'player', 'play', 1, 'free', 'captured', '2099-01-01')",
      "INSERT INTO shared_results (id, owner_id, player_name, game_id, game_version, elapsed_time_ms, cleared, score, metrics_json) VALUES ('result', 'player', 'Test user', 'graze-duel', 'test', 1000, 0, 42, '{}')",
    ].map(sql => env.DB.prepare(sql)));
    before = await snapshot();
  });
  expect(before?.every(rows => rows.length === 1)).toBe(true);
  expect(await snapshot()).toEqual(before);
  expect(await env.DB.prepare("SELECT game_id FROM play_sessions WHERE id = 'play'").first("game_id")).toBe("buzz-barrier");
  expect(await env.DB.prepare("SELECT game_id FROM shared_results WHERE id = 'result'").first("game_id")).toBe("buzz-barrier");
  expect(await env.DB.prepare("SELECT id FROM games WHERE id = 'graze-duel'").first()).toBeNull();
  expect((await env.DB.prepare("PRAGMA foreign_key_check").all()).results).toEqual([]);
  await expect(env.DB.prepare("UPDATE shared_results SET score = 1 WHERE id = 'result'").run()).rejects.toThrow("shared_results are immutable");
});
