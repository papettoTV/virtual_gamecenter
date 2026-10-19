import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";

const deletedPlayer = "recovery-drill-deleted";
const survivor = "recovery-drill-survivor";
const jobId = "00000000-0000-4000-8000-000000000001";
const fixtureVersion = "synthetic-only-v1";

export function validateRecoveryConfig(config) {
  const name = config.name;
  assert.match(name, /^pulbase-recovery-drill-\d{8}(?:-do)?$/);
  assert.equal(config.account_id, "60e5472a284dc71bbafbbfac8aa2a940");
  assert.equal(config.workers_dev, false);
  assert.equal(config.preview_urls, false);
  assert.equal(config.vars?.RECOVERY_DRILL, "true");
  assert.equal(config.d1_databases?.length, 1);
  assert.equal(config.r2_buckets?.length, 1);
  const database = config.d1_databases[0];
  assert.equal(database.binding, "DB");
  assert.equal(database.database_name, name);
  assert.match(database.database_id, /^[a-f0-9-]{36}$/);
  assert.ok(!["c49b03c7-e616-4acb-96a8-2837ff62034f", "c0050cdb-dc20-42fb-9855-bfb155ba5dd2", "00000000-0000-0000-0000-000000000002"].includes(database.database_id));
  assert.equal(database.remote, true);
  assert.equal(config.r2_buckets[0].binding, "DELETION_AUDIT");
  assert.equal(config.r2_buckets[0].bucket_name, name);
  assert.equal(config.r2_buckets[0].remote, true);
  for (const key of ["env", "routes", "route", "triggers", "services", "durable_objects", "secrets", "assets"]) assert.equal(config[key], undefined);
  return name;
}

async function lifecycle() {
  const { build } = await import("esbuild");
  const result = await build({
    stdin: { contents: 'export { processDeletion, replayDeletionAudit, hashIdentifier } from "./src/worker/data-lifecycle.ts";', resolveDir: process.cwd() },
    bundle: true, write: false, platform: "node", format: "esm",
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
}

async function exercise(env, action, functions) {
  const database = env.DB;
  const audit = env.DELETION_AUDIT;
  const { hashIdentifier, processDeletion, replayDeletionAudit } = functions;
  const rowCount = async (table, column, value) => (await database.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE ${column} = ?`).bind(value).first()).count;
  const rooms = { idFromName: name => name, get: () => ({ removePlayerData: async playerId => assert.equal(playerId, deletedPlayer) }) };
  const checkSurvivor = async (sessions = 1) => {
    assert.equal(await rowCount("players", "id", survivor), 1);
    assert.equal(await rowCount("player_sessions", "player_id", survivor), sessions);
    assert.equal(await rowCount("rankings", "owner_id", survivor), 1);
    assert.deepEqual(await database.prepare("SELECT free_balance, purchased_balance FROM credit_wallets WHERE player_id = ?").bind(survivor).first(), { free_balance: 5, purchased_balance: 5 });
    assert.equal(await rowCount("credit_purchases", "player_id", survivor), 1);
    assert.equal(await rowCount("credit_ledger_entries", "player_id", survivor), 2);
  };
  if (action === "seed") {
    const count = (await database.prepare("SELECT COUNT(*) AS count FROM players").first()).count;
    if (count > 0) {
      assert.equal((await database.prepare("SELECT version FROM recovery_drill_guard").first())?.version, fixtureVersion);
      assert.equal((await database.prepare("SELECT COUNT(*) AS count FROM players WHERE id NOT IN (?, ?)").bind(deletedPlayer, survivor).first()).count, 0);
    }
    assert.equal((await audit.list({ limit: 1 })).objects.length, 0);
    await database.prepare("CREATE TABLE IF NOT EXISTS recovery_drill_guard (version TEXT PRIMARY KEY)").run();
    await database.prepare("INSERT OR IGNORE INTO recovery_drill_guard VALUES (?)").bind(fixtureVersion).run();
    for (const playerId of [deletedPlayer, survivor]) {
      if (await rowCount("players", "id", playerId)) continue;
      await database.batch([
        database.prepare("INSERT INTO players (id, guest_name) VALUES (?, ?)").bind(playerId, playerId),
        database.prepare("INSERT INTO credit_wallets (player_id) VALUES (?)").bind(playerId),
        database.prepare("INSERT INTO player_sessions (token_hash, player_id, expires_at) VALUES (?, ?, '2099-01-01')").bind(await hashIdentifier(playerId), playerId),
        database.prepare("INSERT INTO rankings (owner_id, player_name, clear_time_ms, score, max_level, client_version) VALUES (?, 'Synthetic Drill Player', 1000, 10, 1, 'recovery-drill')").bind(playerId),
        database.prepare("INSERT INTO shared_results (id, owner_id, player_name, game_id, game_version, elapsed_time_ms, cleared, score, metrics_json) VALUES (?, ?, 'Synthetic Drill Player', 'graze-duel', 'recovery-drill', 1000, 1, 10, '{}')").bind(`${playerId}-result`, playerId),
        database.prepare("INSERT INTO credit_ledger_entries (id, player_id, balance_type, entry_type, amount) VALUES (?, ?, 'free', 'free_granted', 5)").bind(`${playerId}-free`, playerId),
      ]);
    }
    await database.batch([
      database.prepare("INSERT OR IGNORE INTO player_cabinets VALUES (?, 'recovery-drill-cabinet', CURRENT_TIMESTAMP)").bind(deletedPlayer),
      database.prepare("INSERT OR IGNORE INTO credit_purchases (id, player_id, stripe_checkout_session_id, unit_count, credit_amount, currency, amount_total, status) VALUES ('synthetic-purchase', ?, 'synthetic-not-a-stripe-session', 1, 5, 'jpy', 100, 'paid')").bind(survivor),
      database.prepare("INSERT OR IGNORE INTO credit_ledger_entries (id, player_id, balance_type, entry_type, amount, reference_id) VALUES ('synthetic-paid-ledger', ?, 'purchased', 'purchased', 5, 'synthetic-purchase')").bind(survivor),
    ]);
    await checkSurvivor();
    return { action, seededPlayers: 2, realPersonalData: false, stripeRequests: 0 };
  }
  assert.equal((await database.prepare("SELECT version FROM recovery_drill_guard").first())?.version, fixtureVersion);
  await checkSurvivor(action === "verify-final" ? 0 : 1);
  if (action === "delete") {
    await database.prepare("INSERT INTO data_deletions (id, player_id, receipt_hash, scope, expires_at) VALUES (?, ?, ?, 'all', datetime('now', '+1 year'))").bind(jobId, deletedPlayer, await hashIdentifier("synthetic-receipt")).run();
    await processDeletion(database, rooms, { id: jobId, player_id: deletedPlayer, scope: "all", status: "pending" }, audit);
  } else if (action === "verify-restored") {
    assert.equal(await rowCount("players", "id", deletedPlayer), 1);
    assert.equal(await rowCount("player_sessions", "player_id", deletedPlayer), 1);
    assert.equal(await rowCount("rankings", "owner_id", deletedPlayer), 1);
    assert.equal(await rowCount("data_deletions", "id", jobId), 0);
    assert.ok(await audit.head(`deletions/${jobId}.json`));
    return { action, deletedDataReturnedByRestore: true, independentAuditPreserved: true, publicTraffic: false };
  } else if (action === "replay") {
    const failingRooms = { ...rooms, get: () => ({ removePlayerData: async () => { throw Error("synthetic_room_failure"); } }) };
    assert.equal(await replayDeletionAudit(database, failingRooms, audit), 1);
    assert.equal(await rowCount("player_sessions", "player_id", deletedPlayer), 0);
    assert.equal((await database.prepare("SELECT status FROM data_deletions WHERE id = ?").bind(jobId).first()).status, "pending");
    assert.equal(await replayDeletionAudit(database, rooms, audit), 0);
    assert.equal(await replayDeletionAudit(database, rooms, audit), 0);
  } else if (action === "finalize") {
    assert.equal((await database.prepare("SELECT status FROM data_deletions WHERE id = ?").bind(jobId).first())?.status, "completed");
    await database.batch(["player_sessions", "verified_sessions", "deletion_confirmations"].map(table => database.prepare(`DELETE FROM ${table}`)));
  } else if (action !== "verify-final") throw Error("unknown_drill_action");
  for (const table of ["players", "credit_wallets"]) assert.equal(await rowCount(table, table === "players" ? "id" : "player_id", deletedPlayer), 0);
  for (const table of ["player_sessions", "credit_ledger_entries"]) assert.equal(await rowCount(table, "player_id", deletedPlayer), 0);
  for (const table of ["rankings", "shared_results"]) assert.equal(await rowCount(table, "owner_id", deletedPlayer), 0);
  assert.equal((await database.prepare("SELECT status FROM data_deletions WHERE id = ?").bind(jobId).first()).status, "completed");
  assert.equal((await audit.get(`deletions/${jobId}.json`)).key, `deletions/${jobId}.json`);
  await checkSurvivor(["finalize", "verify-final"].includes(action) ? 0 : 1);
  return { action, deletedPlayerRemoved: true, sessionsRevoked: true, publicRecordsRemoved: true, survivorBalanceAndPurchasePreserved: true, independentAuditPreserved: true, allRestoredSessionsRevoked: ["finalize", "verify-final"].includes(action) };
}

async function main() {
  const [configPath, action] = process.argv.slice(2);
  assert.ok(configPath && ["seed", "delete", "verify-restored", "replay", "finalize", "verify-final"].includes(action), "usage: recovery-drill.mjs <isolated-config.json> <action>");
  const config = JSON.parse(await readFile(configPath, "utf8"));
  const resource = validateRecoveryConfig(config);
  const require = createRequire(import.meta.url);
  const packagePath = require.resolve("wrangler/package.json");
  const metadata = JSON.parse(await readFile(packagePath, "utf8"));
  const binary = resolve(dirname(packagePath), metadata.bin.wrangler);
  const info = JSON.parse(execFileSync(process.execPath, [binary, "d1", "info", "DB", "--config", configPath, "--json"], { encoding: "utf8", timeout: 30000 }));
  assert.equal(info.name, resource);
  assert.equal(info.uuid, config.d1_databases[0].database_id);
  const { getPlatformProxy } = await import("wrangler");
  const proxy = await getPlatformProxy({ configPath, envFiles: [], persist: false, remoteBindings: true });
  try {
    console.log(JSON.stringify({ resource, ...await exercise(proxy.env, action, await lifecycle()) }));
  } finally { await proxy.dispose(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(() => {
  console.error("recovery_drill_failed: keep the drill closed; inspect locally without publishing data");
  process.exitCode = 1;
});
