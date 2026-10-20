import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export const alertCases = [
  { name: "healthy", rows: [["v1", 0, 1800000000, 0, 1]], expected: 0 },
  { name: "down", rows: [["v1", 1, 1800000000, 0, 1]], expected: 1 },
  { name: "recovery", rows: [["v1", 0, 1800000000, 1799999900, 1]], expected: 2 },
  { name: "expired-recovery", rows: [["v1", 0, 1800000000, 1799998000, 1]], expected: 0 },
  { name: "missing-health", rows: [], expected: 3 },
  { name: "incomplete", rows: [["v1", 0, 1800000000, 0, 1], ["revocation-v1", 1, 0, 0, 1]], expected: 4 },
  { name: "success-cannot-clear-failure", rows: [["v1", 0, 1800000000, 0, 1], ["revocation-v1", 1, 0, 0, 1], ["revocation-v1", 0, 0, 0, 1]], expected: 4 },
  { name: "one-retry", rows: [["v1", 0, 1800000000, 0, 1], ["revocation-v1", 0, 1, 0, 1]], expected: 0 },
  { name: "retry-spike", rows: [["v1", 0, 1800000000, 0, 1], ["revocation-v1", 0, 10, 0, 1]], expected: 5 },
  { name: "sampled-retry-spike", rows: [["v1", 0, 1800000000, 0, 1], ["revocation-v1", 0, 1, 0, 10]], expected: 5 },
  { name: "down-priority", rows: [["v1", 1, 1800000000, 0, 1], ["revocation-v1", 1, 10, 0, 1]], expected: 1 },
  { name: "warnings-not-heartbeats", rows: [["revocation-v1", 1, 10, 0, 1]], expected: 3 },
];

export function syntheticAlertQuery(query, rows) {
  assert.ok(query.startsWith("SELECT CASE "));
  assert.ok(query.includes(" FROM events.analyticsEngine.pulbase_service_health WHERE "));
  for (const [schema, failed, retries, recovered, weight] of rows) {
    assert.ok(["v1", "revocation-v1"].includes(schema));
    assert.ok([failed, retries, recovered, weight].every(value => Number.isSafeInteger(value) && value >= 0));
  }
  const health = rows.filter(row => row[0] === "v1").sort((first, second) => second[2] - first[2]);
  const warnings = rows.filter(row => row[0] === "revocation-v1");
  const values = [
    ["sum(if(blob3 = 'v1', 1, 0))", health.length],
    ["argMax(double1, if(blob3 = 'v1', double4, 0.0))", health[0]?.[1] ?? 0],
    ['sum(if(blob3 = \'revocation-v1\', double1 * "sampleInterval", 0.0))', warnings.reduce((sum, row) => sum + row[1] * row[4], 0)],
    ['sum(if(blob3 = \'revocation-v1\', double4 * "sampleInterval", 0.0))', warnings.reduce((sum, row) => sum + row[2] * row[4], 0)],
    ["argMax(double6, if(blob3 = 'v1', double4, 0.0))", health[0]?.[3] ?? 0],
    ["argMax(double4, if(blob3 = 'v1', double4, 0.0))", health[0]?.[2] ?? 0],
  ];
  let synthetic = query;
  for (const [expression, value] of values) {
    assert.ok(synthetic.includes(expression));
    synthetic = synthetic.replaceAll(expression, String(value));
  }
  return `${synthetic} LIMIT 1`;
}

async function main() {
  if (process.argv.slice(2).join(" ") !== "--environment staging") throw Error("Use --environment staging; target overrides are forbidden");
  process.loadEnvFile(".dev.vars");
  const token = process.env.CLOUDFLARE_METRICS_TOKEN;
  if (!token) throw Error("Metrics read token missing");
  const config = JSON.parse(await readFile(new URL("../config/service-alerts.json", import.meta.url)));
  for (const item of alertCases) {
    const response = await fetch("https://api.cloudflare.com/client/v4/analytics/sql", {
      method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "text/plain" },
      body: syntheticAlertQuery(config.alerts[0].query, item.rows), redirect: "manual", signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw Error(`Alert SQL verification failed: HTTP ${response.status}`);
    const result = await response.json();
    assert.equal(Number(result.data?.[0]?.value), item.expected, item.name);
    console.log(JSON.stringify({ case: item.name, value: item.expected, passed: true }));
  }
  const response = await fetch("https://api.cloudflare.com/client/v4/analytics/sql", {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "text/plain" },
    body: config.alerts[0].query, redirect: "manual", signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw Error("Live aggregation query failed");
  const live = await response.json();
  assert.ok([0, 1, 2, 3, 4, 5].includes(Number(live.data?.[0]?.value)));
  console.log(JSON.stringify({ environment: "staging", liveValue: live.data[0].value, writes: 0, syntheticBranchCases: alertCases.length }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(() => {
  console.error("Revocation alert verification failed; response details suppressed"); process.exitCode = 1;
});
