import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseTokenOutput, tokenCommandOptions } from "./observability-policy.mjs";
import { RECEIPT_DRILL_DATABASE, RECEIPT_DRILL_DURATION, RECEIPT_DRILL_MARKER } from "../src/monitor/start-slo-drill.mjs";
import { verifyServiceHealth } from "./verify-service-health.mjs";
import { CRON_PAUSE_DURATION, CRON_PAUSE_MARKER } from "../src/monitor/cron-pause.mjs";

const account = "60e5472a284dc71bbafbbfac8aa2a940";
const root = fileURLToPath(new URL("../", import.meta.url));

export function receiptDrillCommand(args) {
  if (args.length !== 3 || args[0] !== "--environment" || args[1] !== "staging" || !["fault", "pause", "restore", "status"].includes(args[2])) throw Error("staging_receipt_drill_only");
  return args[2];
}

export function receiptDrillConfig(base, now) {
  assert.equal(base.name, "pulbase-service-monitor"); assert.equal(base.account_id, account);
  assert.equal(base.main, "src/monitor/main.mjs");
  assert.equal(base.vars?.MONITOR_ENVIRONMENT, "staging"); assert.equal(base.vars?.START_SLO_ENABLED, "true");
  assert.equal(base.workers_dev, false); assert.equal(base.preview_urls, false);
  assert.ok(!base.route && !base.routes?.length && !base.env && !base.assets);
  assert.deepEqual(base.triggers?.crons, ["*/5 * * * *"]);
  assert.deepEqual(base.analytics_engine_datasets, [{ binding: "HEALTH_EVENTS", dataset: "pulbase_service_health" }]);
  assert.deepEqual(base.kv_namespaces, [{ binding: "HEALTH_STATE", id: "ab926be25f7740a08844889f0c5e0b3f" }]);
  assert.deepEqual(base.services, [{ binding: "HEALTH_DRILL_PROBE", service: "pulbase-service-monitor", entrypoint: "HealthDrillProbe" }]);
  assert.deepEqual(base.secrets?.required, ["PULBASE_CHECK_USERNAME", "PULBASE_CHECK_PASSWORD"]);
  assert.deepEqual(base.d1_databases, [{ binding: "START_SLO_DB", database_name: "pulbase-staging", database_id: "c49b03c7-e616-4acb-96a8-2837ff62034f" }]);
  assert.ok(!Object.keys(base.vars).some(key => key.startsWith("START_SLO_DRILL_")));
  assert.ok(!Object.keys(base.vars).some(key => key.startsWith("MONITOR_PAUSE_")));
  assert.ok(Number.isSafeInteger(now) && now > 0);
  return { ...base, main: resolve(root, base.main), vars: { ...base.vars, START_SLO_DRILL_KIND: RECEIPT_DRILL_MARKER,
    START_SLO_DRILL_STARTED_MS: String(now), START_SLO_DRILL_UNTIL_MS: String(now + RECEIPT_DRILL_DURATION) },
    d1_databases: [...base.d1_databases, { binding: "START_SLO_DRILL_DB", database_name: "pulbase-revocation-drill-20261020", database_id: RECEIPT_DRILL_DATABASE }] };
}

export function cronPauseConfig(base, now) {
  receiptDrillConfig(base, now);
  return { ...base, main: resolve(root, base.main), vars: { ...base.vars, MONITOR_PAUSE_KIND: CRON_PAUSE_MARKER,
    MONITOR_PAUSE_STARTED_MS: String(now), MONITOR_PAUSE_UNTIL_MS: String(now + CRON_PAUSE_DURATION) } };
}

async function main() {
  const command = receiptDrillCommand(process.argv.slice(2));
  process.env.WRANGLER_WRITE_LOGS = "false"; process.env.WRANGLER_SEND_METRICS = "false";
  const basePath = resolve(root, "wrangler.service-monitor.jsonc"), base = JSON.parse(await readFile(basePath, "utf8"));
  receiptDrillConfig(base, Date.now());
  if (command === "restore") {
    execFileSync(process.execPath, [resolve(root, "node_modules/wrangler/bin/wrangler.js"), "deploy", "--config", basePath], { cwd: root, stdio: "inherit" });
    console.log(JSON.stringify({ environment: "staging", command, restoredConfiguration: true, verificationRequired: true })); return;
  }
  process.loadEnvFile(resolve(root, ".dev.vars"));
  const settings = JSON.parse(await readFile(resolve(root, "config/service-alerts.json"), "utf8"));
  async function analytics(sql) {
    if (!process.env.CLOUDFLARE_METRICS_TOKEN) throw Error("metrics_read_token_required");
    const response = await fetch("https://api.cloudflare.com/client/v4/analytics/sql", { method: "POST",
      headers: { Authorization: `Bearer ${process.env.CLOUDFLARE_METRICS_TOKEN}`, "Content-Type": "text/plain" }, body: sql, redirect: "error", signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw Error("receipt_drill_read_failed");
    return (await response.json()).data;
  }
  const filter = `FROM events.analyticsEngine.pulbase_service_health WHERE accountTag = '${account}' AND blob1 = 'staging' AND timestamp >= NOW() - INTERVAL '20' MINUTE`;
  const receipts = await analytics(`SELECT timestamp, blob2, blob4, blob5, double1, double2, double3, double4, double5 ${filter} AND blob3 = 'start-receipt-v1' ORDER BY double4 DESC LIMIT 6`);
  const alert = Number((await analytics(settings.alerts[0].query))?.[0]?.value);
  const health = await analytics(`SELECT blob2, blob4, double1, double2, double3, double4, double5, double6, double7, double8 ${filter} AND blob3 = 'v1' ORDER BY double4 DESC LIMIT 8`);
  if (command === "status") { console.log(JSON.stringify({ environment: "staging", command, checkedAt: new Date().toISOString(), receipts, health, alert, writes: 0 })); return; }
  const statePath = resolve(root, command === "pause" ? ".wrangler/monitor-cron-pause.json" : ".wrangler/start-receipt-drill.json");
  verifyServiceHealth(health, "normal");
  const latest = receipts?.[0], now = Date.now();
  assert.equal(alert, 0); assert.equal(latest?.blob2, "ok"); assert.equal(Number(latest?.double1), 0);
  assert.ok(Number(latest.double4) * 1000 <= now && now - Number(latest.double4) * 1000 <= 600000);
  assert.ok(!latest.blob4);
  if (existsSync(statePath)) { const previous = JSON.parse(await readFile(statePath, "utf8")); assert.ok(Number.isSafeInteger(previous.startedAt) && now - previous.startedAt >= 86400000); }
  if (command === "fault") {
    const token = parseTokenOutput(execFileSync(process.execPath, [resolve(root, "node_modules/wrangler/bin/wrangler.js"), "auth", "token", "--json"], tokenCommandOptions()));
    const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/${RECEIPT_DRILL_DATABASE}/query`, { method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, redirect: "error", signal: AbortSignal.timeout(10000),
      body: JSON.stringify({ sql: "SELECT name FROM sqlite_master WHERE name IN ('start_slo_alert_buckets', 'start_slo_attempts', 'start_slo_alert_config')" }) });
    const schema = await response.json();
    assert.ok(response.ok && schema.success); assert.deepEqual(schema.result?.[0]?.results, []);
  }
  const startedAt = Date.now(), config = command === "pause" ? cronPauseConfig(base, startedAt) : receiptDrillConfig(base, startedAt);
  await mkdir(resolve(root, ".wrangler"), { recursive: true });
  await writeFile(statePath, JSON.stringify({ startedAt, faultUntil: startedAt + RECEIPT_DRILL_DURATION, phase: "attempted" }), { mode: 0o600 });
  const directory = await mkdtemp(join(tmpdir(), "pulbase-code10-"));
  try {
    const configPath = join(directory, "wrangler.json");
    await writeFile(configPath, JSON.stringify(config), { mode: 0o600 });
    execFileSync(process.execPath, [resolve(root, "node_modules/wrangler/bin/wrangler.js"), "deploy", "--config", configPath], { cwd: root, stdio: "inherit" });
    await writeFile(statePath, JSON.stringify({ startedAt, faultUntil: startedAt + RECEIPT_DRILL_DURATION, phase: "deployed" }), { mode: 0o600 });
    console.log(JSON.stringify({ environment: "staging", command, startedAt: new Date(startedAt).toISOString(), faultUntil: new Date(startedAt + RECEIPT_DRILL_DURATION).toISOString(), automaticFallback: true }));
  } finally { await rm(directory, { recursive: true, force: true }); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(() => {
  console.error("start_receipt_drill_failed; details suppressed; inspect status before retrying; restore remains available"); process.exitCode = 1;
});
