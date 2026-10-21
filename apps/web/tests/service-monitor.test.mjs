import assert from "node:assert/strict";
import { test } from "node:test";
import { nextHealthState } from "../src/monitor/health-state.mjs";
import worker from "../src/monitor/worker.mjs";
import { readFile } from "node:fs/promises";
import { alertCases, syntheticAlertQuery } from "../scripts/verify-revocation-alert.mjs";
import { checkDrill, DRILL_KEY, DRILL_MARKER, drillProbe, finishDrill, recoverDrill, startDrill, validDrill } from "../src/monitor/health-drill.mjs";
import { healthDrillCommand } from "../scripts/health-drill.mjs";
import { verifyServiceHealth } from "../scripts/verify-service-health.mjs";
import { operationExpression, operationReportQuery, summarizeOperations } from "../scripts/operation-report.mjs";
import { operationVerificationTarget } from "../scripts/verify-operation-metrics-staging.mjs";
import { startSloVerificationTarget } from "../scripts/verify-start-slo-staging.mjs";
import { recordStartAlert, startReceiptExpression } from "../src/monitor/start-slo-alert.mjs";
import { verifyMissingStarts } from "../scripts/verify-start-receipt-alert.mjs";
import { receiptDrillCommand, receiptDrillConfig, cronPauseConfig } from "../scripts/start-slo-drill.mjs";
import { RECEIPT_DRILL_MARKER, RECEIPT_DRILL_DURATION, RECEIPT_DRILL_DATABASE, startReceiptTarget } from "../src/monitor/start-slo-drill.mjs";
import { CRON_PAUSE_MARKER, CRON_PAUSE_DURATION, monitorPaused } from "../src/monitor/cron-pause.mjs";

test("bounded Cron pause expires even with no health or receipt writes and rejects unsafe settings", async () => {
  const now = Date.now();
  const env = { MONITOR_ENVIRONMENT: "staging", MONITOR_PAUSE_KIND: CRON_PAUSE_MARKER,
    MONITOR_PAUSE_STARTED_MS: String(now), MONITOR_PAUSE_UNTIL_MS: String(now + CRON_PAUSE_DURATION) };
  assert.equal(monitorPaused({}, now), false);
  assert.equal(monitorPaused(env, now), true);
  assert.equal(monitorPaused(env, now + CRON_PAUSE_DURATION - 1), true);
  assert.equal(monitorPaused(env, now + CRON_PAUSE_DURATION), false);
  assert.equal(monitorPaused(env, now + CRON_PAUSE_DURATION + 1), false);
  for (const changed of [{ ...env, MONITOR_ENVIRONMENT: "production" }, { ...env, MONITOR_PAUSE_KIND: "wrong" },
    { ...env, MONITOR_PAUSE_UNTIL_MS: "Infinity" }, { ...env, MONITOR_PAUSE_UNTIL_MS: String(now + CRON_PAUSE_DURATION + 1) },
    { ...env, MONITOR_PAUSE_STARTED_MS: String(now + 1) }, { MONITOR_PAUSE_KIND: CRON_PAUSE_MARKER }]) assert.throws(() => monitorPaused(changed, now));
  const originalLog = console.log, logs = [];
  try {
    console.log = value => logs.push(value);
    await worker.scheduled({ scheduledTime: now }, env);
    assert.deepEqual(logs.map(value => JSON.parse(value).event), ["monitor_cron_paused"]);
    await assert.rejects(worker.scheduled({ scheduledTime: now }, { ...env,
      MONITOR_PAUSE_STARTED_MS: String(now - CRON_PAUSE_DURATION), MONITOR_PAUSE_UNTIL_MS: String(now) }), /monitor_auth_missing/);
    await assert.rejects(worker.scheduled({ scheduledTime: now }, { ...env, MONITOR_PAUSE_UNTIL_MS: "0" }), /invalid_monitor_pause/);
  } finally { console.log = originalLog; }
});

test("code10 drill only accepts fixed staging commands and never mutates the base configuration", async () => {
  for (const command of ["fault", "pause", "restore", "status"]) assert.equal(receiptDrillCommand(["--environment", "staging", command]), command);
  for (const args of [[], ["--environment", "production", "fault"], ["--environment", "staging", "fault", "extra"], ["--environment", "staging", "scheduled"]]) assert.throws(() => receiptDrillCommand(args));
  const base = JSON.parse(await readFile(new URL("../wrangler.service-monitor.jsonc", import.meta.url), "utf8")), original = JSON.stringify(base);
  const now = 1800000000000, fault = receiptDrillConfig(base, now);
  assert.equal(JSON.stringify(base), original);
  assert.equal(fault.vars.START_SLO_DRILL_UNTIL_MS, String(now + RECEIPT_DRILL_DURATION));
  assert.equal(fault.d1_databases[1].database_id, RECEIPT_DRILL_DATABASE);
  assert.deepEqual(fault.d1_databases[0], base.d1_databases[0]);
  const paused = cronPauseConfig(base, now);
  assert.deepEqual(paused.d1_databases, base.d1_databases);
  assert.deepEqual(paused.triggers, base.triggers);
  assert.equal(paused.vars.MONITOR_PAUSE_UNTIL_MS, String(now + CRON_PAUSE_DURATION));
  assert.ok(!Object.keys(paused.vars).some(key => key.startsWith("START_SLO_DRILL_")));
  assert.throws(() => cronPauseConfig({ ...base, vars: { ...base.vars, MONITOR_PAUSE_KIND: CRON_PAUSE_MARKER } }, now));
  for (const field of ["services", "triggers", "kv_namespaces", "analytics_engine_datasets", "secrets"]) assert.deepEqual(fault[field], base[field]);
  for (const changed of [{ ...base, name: "pulbase-production" }, { ...base, workers_dev: true }, { ...base, vars: { ...base.vars, MONITOR_ENVIRONMENT: "production" } },
    { ...base, d1_databases: [] }, { ...base, routes: ["pulbase.com/*"] }, { ...base, main: "src/worker/index.ts" }, { ...base, analytics_engine_datasets: [] },
    { ...base, services: [] }, { ...base, kv_namespaces: [] }]) assert.throws(() => receiptDrillConfig(changed, now));
  const script = await readFile(new URL("../scripts/start-slo-drill.mjs", import.meta.url), "utf8");
  assert.ok(script.indexOf('command === "restore"') < script.indexOf("process.loadEnvFile"));
});

test("code10 drill cannot run forever, in production, or with partial/invalid configuration", () => {
  const now = 1800000000000, normal = {}, isolated = {};
  const env = { MONITOR_ENVIRONMENT: "staging", START_SLO_DB: normal, START_SLO_DRILL_DB: isolated, START_SLO_DRILL_KIND: RECEIPT_DRILL_MARKER,
    START_SLO_DRILL_STARTED_MS: String(now), START_SLO_DRILL_UNTIL_MS: String(now + RECEIPT_DRILL_DURATION) };
  assert.equal(startReceiptTarget({ START_SLO_DB: normal }, now).database, normal);
  assert.equal(startReceiptTarget(env, now).database, isolated);
  assert.equal(startReceiptTarget(env, now + RECEIPT_DRILL_DURATION - 1).fault, true);
  assert.deepEqual(startReceiptTarget({ ...env, START_SLO_DRILL_DB: undefined }, now + RECEIPT_DRILL_DURATION), { database: normal, configured: true, fault: false });
  for (const changed of [{ ...env, MONITOR_ENVIRONMENT: "production" }, { ...env, START_SLO_DRILL_KIND: "unknown" }, { ...env, START_SLO_DRILL_UNTIL_MS: "Infinity" },
    { ...env, START_SLO_DRILL_UNTIL_MS: String(now + RECEIPT_DRILL_DURATION + 1) }, { ...env, START_SLO_DRILL_STARTED_MS: String(now + 1) }, { ...env, START_SLO_DRILL_DB: undefined },
    { START_SLO_DRILL_KIND: RECEIPT_DRILL_MARKER }]) assert.throws(() => startReceiptTarget(changed, now));
});

test("code10 drill uses the real collection failure path and returns to normal without changing counters or thresholds", async () => {
  const now = 1800000000000, points = [], originalWarn = console.warn;
  let normalReads = 0, isolatedReads = 0;
  const normal = { prepare: () => ({ bind() { return this; } }), batch: async () => { normalReads++; return [
    { results: [{ requested: 1, rejected: 0, missing: 0 }] }, { results: [{ expired: 0 }] }, { results: [{ started_ms: now - 86400000 }] },
  ]; } };
  const isolated = { prepare: normal.prepare, batch: async () => { isolatedReads++; throw Error("private D1 query details"); } };
  const env = { MONITOR_ENVIRONMENT: "staging", START_SLO_DB: normal, START_SLO_DRILL_DB: isolated, HEALTH_EVENTS: { writeDataPoint: point => points.push(point) },
    START_SLO_DRILL_KIND: RECEIPT_DRILL_MARKER, START_SLO_DRILL_STARTED_MS: String(now), START_SLO_DRILL_UNTIL_MS: String(now + RECEIPT_DRILL_DURATION) };
  try {
    console.warn = () => {};
    const failed = await recordStartAlert(env, now);
    assert.equal(failed.doubles[0], 10); assert.deepEqual(failed.blobs.slice(3), [RECEIPT_DRILL_MARKER, "fault"]);
    assert.equal(normalReads, 0); assert.equal(isolatedReads, 1);
    const recovered = await recordStartAlert(env, now + RECEIPT_DRILL_DURATION);
    assert.equal(recovered.doubles[0], 0); assert.equal(recovered.doubles[1], 1); assert.equal(recovered.doubles[2], 0);
    assert.deepEqual(recovered.blobs.slice(3), [RECEIPT_DRILL_MARKER, "expired"]); assert.equal(normalReads, 1); assert.equal(isolatedReads, 1);
    assert.equal(JSON.stringify(points).includes("private D1 query details"), false);
  } finally { console.warn = originalWarn; }
});

test("missing receipt drill rejects production and destination overrides before any side effects", async () => {
  for (const args of [[], ["--environment", "production"], ["--environment", "staging", "normal", "extra"], ["--environment", "staging", "https://pulbase.com"]]) {
    await assert.rejects(verifyMissingStarts(args));
  }
});

test("receipt snapshots contain only aggregate numbers and never turn query errors into healthy data", async () => {
  const now = 1800000000000, points = [], warnings = [], originalWarn = console.warn;
  const database = { prepare: () => ({ bind() { return this; } }), batch: async () => [
    { results: [{ requested: 15, rejected: 0, missing: 1 }] }, { results: [{ expired: 2 }] }, { results: [{ started_ms: now - 86400000 }] },
  ] };
  const env = { START_SLO_DB: database, HEALTH_EVENTS: { writeDataPoint: point => points.push(point) } };
  try {
    console.warn = value => warnings.push(value);
    assert.equal((await recordStartAlert(env, now)).doubles[0], 9);
    database.batch = async () => { throw Error("private-token-or-sql"); };
    assert.equal((await recordStartAlert(env, now + 1)).doubles[0], 10);
    database.batch = async () => [
      { results: [{ requested: 0, rejected: 0, missing: 0 }] }, { results: [{ expired: 0 }] }, { results: [{ started_ms: now }] },
    ];
    const idle = await recordStartAlert(env, now + 2);
    assert.equal(idle.doubles[0], 0); assert.equal(idle.blobs[1], "warmup");
    assert.equal(JSON.stringify({ points, warnings }).includes("private-token-or-sql"), false);
    assert.deepEqual(warnings, ["start_receipt_collection_failed"]);
    assert.throws(() => startReceiptExpression("cookie"));
  } finally { console.warn = originalWarn; }
});

test("start SLO verification is staging-only and cannot override a destination", () => {
  assert.equal(startSloVerificationTarget(["--environment", "staging"]), "https://develop.virtual-gamecenter.pages.dev");
  for (const args of [[], ["--environment", "production"], ["--environment", "staging", "--origin", "https://pulbase.com"]]) {
    assert.throws(() => startSloVerificationTarget(args));
  }
});

test("synthetic SQL is bounded, read-only and cannot supply identifiers or SQL fragments", async () => {
  const config = JSON.parse(await readFile(new URL("../config/service-alerts.json", import.meta.url), "utf8"));
  assert.equal(alertCases.length, 31);
  for (const item of alertCases) {
    const query = syntheticAlertQuery(config.alerts[0].query, item.rows, item.operations, item.receipt);
    assert.ok(query.startsWith("SELECT CASE "));
    assert.ok(query.includes("LIMIT 1"));
    assert.ok(query.length < 4000);
  }
  assert.throws(() => syntheticAlertQuery(config.alerts[0].query, [["private-cookie", 1, 0, 0, 1]]));
  assert.throws(() => syntheticAlertQuery(config.alerts[0].query, [["v1", "DROP TABLE", 0, 0, 1]]));
  assert.throws(() => syntheticAlertQuery("SELECT secret FROM anything", []));
});

test("fits one remaining custom alert slot without suppressing recovery for six hours", async () => {
  const config = JSON.parse(await readFile(new URL("../config/service-alerts.json", import.meta.url), "utf8"));
  assert.equal(config.alerts.length, 1);
  const alert = config.alerts[0];
  assert.equal(alert.operator, ">=");
  assert.equal(alert.threshold, 1);
  assert.equal(alert.executionInterval, "5m");
  assert.equal(alert.repeatInterval, "15m");
  assert.ok(alert.query.includes("sum(if(blob3 = 'v1', 1, 0)) = 0 THEN 3"));
  assert.ok(alert.query.includes("toUnixTimestamp(NOW()) - argMax(double4, if(blob3 = 'start-receipt-v1', double4, 0.0)) > 600"));
  assert.ok(alert.query.includes("argMax(double1, if(blob3 = 'v1', double4, 0.0)) >= 1 THEN 1"));
  assert.ok(alert.query.includes('double1 * "sampleInterval", 0.0)) >= 1 THEN 4'));
  assert.ok(alert.query.includes("blob3 = 'revocation-v1' OR blob3 = 'idle-revocation-v1'"));
  assert.ok(alert.query.includes('double4 * "sampleInterval", 0.0)) >= 10 THEN 5'));
  assert.ok(alert.query.includes("< 1800 THEN 2 ELSE 0 END AS value"));
  assert.ok(alert.query.includes(`accountTag = '${config.accountId}'`));
  assert.ok(alert.query.includes("blob1 = 'staging'"));
  assert.ok(alert.query.includes("timestamp >= NOW() - INTERVAL '20' MINUTE"));
  assert.ok(alert.name.includes("1 DOWN, 2 RECOVERED, 3 NO DATA, 4 REVOKE, 5 RETRIES"));
  assert.ok(alert.description.includes("6 START, 7 LOGIN, 8 CREDIT"));
});

test("requires two failures and three successes, without repeating transitions", () => {
  let state = nextHealthState(null, false, 300000);
  assert.equal(state.incident, false);
  state = nextHealthState(state, false, 600000);
  assert.equal(state.incident, true);
  assert.equal(state.downAt, 600000);
  state = nextHealthState(state, false, 900000);
  assert.equal(state.downAt, 600000);
  for (const slot of [1200000, 1500000]) { state = nextHealthState(state, true, slot); assert.equal(state.incident, true); }
  state = nextHealthState(state, true, 1800000);
  assert.equal(state.incident, false);
  assert.equal(state.recoveredAt, 1800000);
  state = nextHealthState(state, true, 2100000);
  assert.equal(state.recoveredAt, 1800000);
});

test("does not declare recovery on initial healthy checks", () => {
  let state;
  for (const slot of [300000, 600000, 900000]) state = nextHealthState(state, true, slot);
  assert.equal(state.recoveredAt, 0);
});

test("rejects duplicate/out of order runs and resets streaks after missing slots", () => {
  const state = nextHealthState(null, false, 300000);
  assert.equal(nextHealthState(state, false, 300000), null);
  assert.equal(nextHealthState(state, false, 0), null);
  assert.equal(nextHealthState(state, false, 900000).incident, false);
  assert.throws(() => nextHealthState(null, true, 123));
  assert.throws(() => nextHealthState({ lastSlot: 300000 }, true, 600000), /invalid_monitor_state/);
});

test("has no HTTP trigger and requires configured authentication before probing", async () => {
  assert.equal(worker.fetch().status, 404);
  await assert.rejects(worker.scheduled({ scheduledTime: 300000 }, {}), /monitor_auth_missing/);
});

test("scheduled probes persist transitions and emit privacy-safe data", async () => {
  const originalFetch = globalThis.fetch;
  const originalLog = console.log;
  let healthy = false;
  let stored = null;
  const points = [];
  const logs = [];
  const requests = [];
  const env = {
    PULBASE_CHECK_USERNAME: "test-user", PULBASE_CHECK_PASSWORD: "secret-test-password",
    HEALTH_STATE: { get: async key => key === "staging" ? stored : null, put: async (_key, value) => { stored = JSON.parse(value); } },
    HEALTH_EVENTS: { writeDataPoint: point => points.push(point) },
  };
  try {
    console.log = value => logs.push(value);
    globalThis.fetch = async (url, options) => {
      requests.push({ url, method: options.method });
      assert.equal(url.origin, "https://develop.virtual-gamecenter.pages.dev");
      assert.equal(options.redirect, "manual");
      if (!healthy) return new Response("private upstream error", { status: 503 });
      if (url.pathname === "/") return new Response('<title>PULBASE</title><div id="root"></div><script type="module" src="/assets/main.js"></script>');
      if (url.pathname.endsWith(".js")) return new Response(null, { headers: { "content-type": "text/javascript" } });
      if (url.pathname === "/api/cabinets") return Response.json({ cabinets: [] });
      return new Response("利用規約 プライバシー");
    };
    for (const slot of [300000, 600000]) await worker.scheduled({ scheduledTime: slot }, env);
    assert.equal(points[1].doubles[0], 1);
    healthy = true;
    for (const slot of [900000, 1200000, 1500000]) await worker.scheduled({ scheduledTime: slot }, env);
    assert.equal(stored.incident, false);
    assert.equal(points.at(-1).doubles[5], 1500);
    assert.equal(points.at(-1).doubles[3], 1500);
    await worker.scheduled({ scheduledTime: 1500000 }, env);
    assert.equal(points.length, 5);
    assert.ok(requests.every(request => ["GET", "HEAD"].includes(request.method)));
    const output = JSON.stringify({ logs, points, stored });
    assert.ok(!output.includes("test-user"));
    assert.ok(!output.includes("secret-test-password"));
    assert.ok(!output.includes("private upstream error"));
  } finally { globalThis.fetch = originalFetch; console.log = originalLog; }
});

function drillStorage(now = 1800000000000) {
  const values = new Map([["staging", { lastSlot: now, incident: false, successes: 3, failures: 0, downAt: 0, recoveredAt: 0 }]]);
  return { values, async get(key) { return values.get(key) ?? null; }, async put(key, value) { values.set(key, JSON.parse(value)); }, async delete(key) { values.delete(key); } };
}

test("health drill only accepts staging and fixed commands, with no target overrides", async () => {
  assert.equal(healthDrillCommand(["--environment", "staging", "status"]), "status");
  for (const args of [["--environment", "production", "start"], ["--environment", "staging", "start", "https://pulbase.com"], ["--environment", "staging", "scheduled"]]) assert.throws(() => healthDrillCommand(args));
  const text = await readFile(new URL("../wrangler.service-monitor.jsonc", import.meta.url), "utf8");
  const config = JSON.parse(text);
  assert.equal(config.name, "pulbase-service-monitor");
  assert.equal(config.vars.MONITOR_ENVIRONMENT, "staging");
  assert.equal(config.workers_dev, false);
  assert.equal(config.preview_urls, false);
  assert.equal(config.vars.START_SLO_ENABLED, "true");
  assert.deepEqual(config.d1_databases, [{ binding: "START_SLO_DB", database_name: "pulbase-staging", database_id: "c49b03c7-e616-4acb-96a8-2837ff62034f" }]);
  assert.deepEqual(config.services, [{ binding: "HEALTH_DRILL_PROBE", service: "pulbase-service-monitor", entrypoint: "HealthDrillProbe" }]);
  assert.deepEqual(config.triggers.crons, ["*/5 * * * *"]);
});

test("drill requires a fresh healthy baseline and cannot renew an active lease", async () => {
  const now = 1800000000000;
  const storage = drillStorage(now);
  const drill = await startDrill(storage, now);
  assert.equal(drill.faultUntil - now, 1200000);
  assert.equal(drill.expiresAt - now, 3600000);
  await assert.rejects(startDrill(storage, now + 1000), /already_active/);
  for (const state of [null, { incident: true, successes: 3, lastSlot: now }, { incident: false, successes: 2, lastSlot: now }, { incident: false, successes: 3, lastSlot: now - 600001 }]) {
    storage.values.delete(DRILL_KEY); storage.values.set("staging", state);
    await assert.rejects(startDrill(storage, now), /baseline/);
  }
});

test("private HTTP failure expires automatically and never accepts credentials or arbitrary paths", async () => {
  const now = 1800000000000, storage = drillStorage(now);
  const drill = await startDrill(storage, now);
  const request = new Request("https://health-drill.invalid/probe");
  assert.equal((await drillProbe(request, storage, now + 1)).status, 503);
  assert.equal((await drillProbe(request, storage, drill.faultUntil)).status, 200);
  assert.equal(validDrill(drill, drill.expiresAt), null);
  assert.throws(() => validDrill({ ...drill, faultUntil: now + 1200001 }, now));
  assert.throws(() => validDrill({ ...drill, expiresAt: now + 3600001 }, now));
  for (const invalid of [new Request("https://pulbase.com/probe"), new Request("https://health-drill.invalid/probe?secret=x"), new Request(request, { method: "POST" }), new Request(request, { headers: { Authorization: "test" } }), new Request(request, { headers: { Cookie: "test" } })]) assert.equal((await drillProbe(invalid, storage, now)).status, 404);
});

test("drill probe uses real HTTP status and marker, without forwarding Basic authentication", async () => {
  const now = 1800000000000, storage = drillStorage(now);
  await startDrill(storage, now);
  const env = { HEALTH_STATE: storage, HEALTH_DRILL_PROBE: { async fetch(request) {
    assert.equal(request.url, "https://health-drill.invalid/probe");
    assert.equal(request.headers.has("Authorization"), false);
    assert.equal(request.headers.has("Cookie"), false);
    return drillProbe(request, storage, now + 1);
  } } };
  assert.deepEqual(await checkDrill(env, now + 1), { active: true, ok: false, status: 503 });
  await recoverDrill(storage, now + 1000);
  env.HEALTH_DRILL_PROBE.fetch = async () => new Response(null, { headers: { "X-Pulbase-Health-Drill": DRILL_MARKER } });
  assert.equal((await checkDrill(env, now + 1001)).ok, true);
  env.HEALTH_DRILL_PROBE.fetch = async () => new Response(null);
  assert.equal((await checkDrill(env, now + 1001)).ok, false);
  await assert.rejects(checkDrill({ HEALTH_STATE: storage }, now + 1001), /binding_missing/);
});

test("recovery and cleanup never overwrite the health state or finish before recovery", async () => {
  const now = 1800000000000, storage = drillStorage(now);
  await startDrill(storage, now);
  await assert.rejects(finishDrill(storage, now + 1), /still_active/);
  await recoverDrill(storage, now + 1000);
  const state = { lastSlot: now, incident: true, successes: 0 };
  storage.values.set("staging", state);
  await assert.rejects(finishDrill(storage, now + 1001), /healthy_recovery/);
  state.incident = false; state.successes = 3;
  assert.deepEqual(await finishDrill(storage, now + 1002), { finished: true, healthy: true });
  assert.equal(storage.values.has(DRILL_KEY), false);
  assert.equal(storage.values.get("staging"), state);
});

test("natural scheduled checks keep checking the application during controlled 503 and recovery", async () => {
  const originalFetch = globalThis.fetch, originalLog = console.log;
  const now = Math.floor(Date.now() / 300000) * 300000;
  const storage = drillStorage(now - 300000);
  const points = [];
  const drill = { version: 1, startedAt: Date.now() - 1000, faultUntil: Date.now() + 600000, expiresAt: Date.now() - 1000 + 3600000 };
  storage.values.set(DRILL_KEY, drill);
  let status = 503, applicationRequests = 0;
  const env = { HEALTH_STATE: storage, PULBASE_CHECK_USERNAME: "test", PULBASE_CHECK_PASSWORD: "secret",
    HEALTH_EVENTS: { writeDataPoint: point => points.push(point) },
    HEALTH_DRILL_PROBE: { fetch: async () => new Response(null, { status, headers: { "X-Pulbase-Health-Drill": DRILL_MARKER } }) } };
  try {
    console.log = () => {};
    globalThis.fetch = async () => { applicationRequests += 1; return new Response("unhealthy", { status: 503 }); };
    for (const slot of [now, now + 300000]) await worker.scheduled({ scheduledTime: slot }, env);
    assert.equal(points.at(-1).doubles[0], 1);
    assert.equal(applicationRequests, 2);
    assert.equal(points.at(-1).blobs[3], DRILL_MARKER);
    status = 200;
    await worker.scheduled({ scheduledTime: now + 600000 }, env);
    assert.equal(points.at(-1).doubles[0], 1);
    assert.equal(points.at(-1).doubles[2], 0);
    globalThis.fetch = async url => {
      applicationRequests += 1;
      if (url.pathname === "/") return new Response('<title>PULBASE</title><div id="root"></div><script type="module" src="/assets/main.js"></script>');
      if (url.pathname.endsWith(".js")) return new Response(null, { headers: { "content-type": "text/javascript" } });
      if (url.pathname === "/api/cabinets") return Response.json({ cabinets: [] });
      return new Response("利用規約 プライバシー");
    };
    for (const slot of [now + 900000, now + 1200000, now + 1500000]) await worker.scheduled({ scheduledTime: slot }, env);
    assert.equal(points.at(-1).doubles[0], 0);
    assert.equal(points.at(-1).doubles[5], (now + 1500000) / 1000);
  } finally { globalThis.fetch = originalFetch; console.log = originalLog; }
});

test("stored health verification rejects stale, future, wrong-phase and unmarked recovery", () => {
  const now = 1800000000000;
  const row = { blob2: "error", blob4: DRILL_MARKER, double1: 1, double2: 2, double3: 0, double4: now / 1000, double5: now / 1000, double6: 0, double7: 503, double8: 1 };
  assert.equal(verifyServiceHealth([row], "down", now).incident, true);
  assert.throws(() => verifyServiceHealth([row], "recovered", now));
  assert.throws(() => verifyServiceHealth([row], "down", now + 600001));
  assert.throws(() => verifyServiceHealth([{ ...row, double4: now / 1000 + 300 }], "down", now));
  const recovered = { ...row, blob2: "ok", double1: 0, double2: 0, double3: 3, double5: now / 1000 - 1200, double6: now / 1000, double7: 200 };
  assert.equal(verifyServiceHealth([recovered], "recovered", now).incident, false);
  assert.throws(() => verifyServiceHealth([{ ...recovered, blob4: "normal" }], "recovered", now));
  assert.throws(() => verifyServiceHealth([{ ...recovered, double5: 0 }], "recovered", now));
  assert.throws(() => verifyServiceHealth([{ ...row, double8: 0 }], "down", now));
  assert.throws(() => verifyServiceHealth([{ ...recovered, double7: 503 }], "recovered", now));
  assert.throws(() => verifyServiceHealth([recovered], "normal", now));
  assert.equal(verifyServiceHealth([{ ...recovered, blob4: "normal" }], "normal", now).drill, false);
});

test("operation reporting keeps missing traffic unknown and excludes denials from failure rates", () => {
  assert.equal(summarizeOperations([]).start.failureRate, null);
  const rows = [{ operation: "solo_start", eligible: "3", failed: "3", succeeded: "0", rejected: "50", cancelled: "0" }];
  const report = summarizeOperations(rows);
  assert.equal(report.start.failureRate, 1);
  assert.equal(report.start.warning, true);
  assert.equal(report.login.traffic, "no_eligible_data");
  assert.equal(report.start.rejected, 50);
});

test("operation warning boundaries and invalid aggregate input are explicit", () => {
  const row = { operation: "google_login", eligible: 15, failed: 3, succeeded: 12, rejected: 0, cancelled: 0 };
  assert.equal(summarizeOperations([row]).login.warning, true);
  assert.equal(summarizeOperations([{ ...row, eligible: 16, succeeded: 13 }]).login.warning, false);
  assert.equal(summarizeOperations([{ ...row, eligible: 2, failed: 2, succeeded: 0 }]).login.warning, false);
  assert.throws(() => summarizeOperations([{ ...row, failed: 16 }]));
  assert.throws(() => summarizeOperations([{ ...row, operation: "private-player-id" }]));
  assert.throws(() => summarizeOperations(Array(64).fill(row)));
});

test("operation queries are fixed-scope and use sampling weights, without arbitrary SQL", () => {
  assert.ok(operationReportQuery().includes('sum(double1 * "sampleInterval")'));
  assert.ok(operationReportQuery().includes("blob3 = 'operation-v1'"));
  assert.ok(operationReportQuery().endsWith("LIMIT 64"));
  assert.ok(operationExpression("start", "double2").includes("blob6 = 'operation-start-v1'"));
  assert.throws(() => operationExpression("DROP TABLE", "double2"));
  assert.throws(() => operationExpression("login", "private"));
  assert.equal(operationVerificationTarget(["--environment", "staging"]), "https://develop.virtual-gamecenter.pages.dev");
  assert.throws(() => operationVerificationTarget(["--environment", "production"]));
  assert.throws(() => operationVerificationTarget(["--environment", "staging", "https://pulbase.com"]));
});
