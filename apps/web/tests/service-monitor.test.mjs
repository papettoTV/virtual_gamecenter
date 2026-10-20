import assert from "node:assert/strict";
import { test } from "node:test";
import { nextHealthState } from "../src/monitor/health-state.mjs";
import worker from "../src/monitor/worker.mjs";
import { readFile } from "node:fs/promises";
import { alertCases, syntheticAlertQuery } from "../scripts/verify-revocation-alert.mjs";

test("synthetic SQL is bounded, read-only and cannot supply identifiers or SQL fragments", async () => {
  const config = JSON.parse(await readFile(new URL("../config/service-alerts.json", import.meta.url), "utf8"));
  assert.equal(alertCases.length, 14);
  for (const item of alertCases) {
    const query = syntheticAlertQuery(config.alerts[0].query, item.rows);
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
  assert.ok(alert.query.includes("argMax(double1, if(blob3 = 'v1', double4, 0.0)) >= 1 THEN 1"));
  assert.ok(alert.query.includes('double1 * "sampleInterval", 0.0)) >= 1 THEN 4'));
  assert.ok(alert.query.includes("blob3 = 'revocation-v1' OR blob3 = 'idle-revocation-v1'"));
  assert.ok(alert.query.includes('double4 * "sampleInterval", 0.0)) >= 10 THEN 5'));
  assert.ok(alert.query.includes("< 1800 THEN 2 ELSE 0 END AS value"));
  assert.ok(alert.query.includes(`accountTag = '${config.accountId}'`));
  assert.ok(alert.query.includes("blob1 = 'staging'"));
  assert.ok(alert.query.includes("timestamp >= NOW() - INTERVAL '20' MINUTE"));
  assert.ok(alert.name.includes("1 DOWN, 2 RECOVERED, 3 NO DATA, 4 REVOKE, 5 RETRIES"));
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
    HEALTH_STATE: { get: async () => stored, put: async (_key, value) => { stored = JSON.parse(value); } },
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
