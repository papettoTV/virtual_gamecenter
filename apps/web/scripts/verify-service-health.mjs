import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { DRILL_MARKER } from "../src/monitor/health-drill.mjs";

export function verifyServiceHealth(records, phase, now = Date.now()) {
  if (!["status", "down", "recovered", "normal"].includes(phase) || !Array.isArray(records) || !records.length) throw Error("health_records_required");
  const ordered = [...records].sort((first, second) => Number(second.double4) - Number(first.double4));
  const latest = ordered[0];
  for (const row of ordered) {
    if (!["ok", "error"].includes(row.blob2) || !["normal", DRILL_MARKER, ""].includes(row.blob4)
      || ![1, 2, 3, 4, 5, 6].every(index => Number.isFinite(Number(row[`double${index}`])))) throw Error("invalid_health_records");
  }
  const slot = Number(latest.double4) * 1000;
  if (now - slot > 600000 || slot > now || slot % 300000 !== 0) throw Error("stale_health_records");
  if (phase === "down" && (Number(latest.double1) !== 1 || Number(latest.double2) !== 2 || latest.blob4 !== DRILL_MARKER)) throw Error("down_not_observed");
  if (phase === "down" && (Number(latest.double7) !== 503 || Number(latest.double8) !== 1)) throw Error("controlled_http_failure_not_observed");
  if (phase === "recovered" && (Number(latest.double1) !== 0 || Number(latest.double3) !== 3 || latest.blob4 !== DRILL_MARKER
    || Number(latest.double5) <= 0 || Number(latest.double6) <= Number(latest.double5)
    || Number(latest.double7) !== 200 || Number(latest.double8) !== 1)) throw Error("recovery_not_observed");
  if (phase === "normal" && (latest.blob4 !== "normal" || Number(latest.double1) !== 0 || Number(latest.double3) !== 3)) throw Error("normal_not_observed");
  return { phase, latestSlot: new Date(slot).toISOString(), incident: Number(latest.double1) === 1,
    failures: Number(latest.double2), successes: Number(latest.double3), drill: latest.blob4 === DRILL_MARKER,
    probeStatus: Number(latest.double7) || null,
    applicationHealthy: latest.blob4 === "normal" || Number(latest.double7) > 0 ? Number(latest.double8) === 1 : null,
    downAt: Number(latest.double5) ? new Date(Number(latest.double5) * 1000).toISOString() : null,
    recoveredAt: Number(latest.double6) ? new Date(Number(latest.double6) * 1000).toISOString() : null };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 3 || args[0] !== "--environment" || args[1] !== "staging" || !["status", "down", "recovered", "normal"].includes(args[2])) throw Error("staging_health_verification_only");
  process.loadEnvFile(".dev.vars");
  const token = process.env.CLOUDFLARE_METRICS_TOKEN;
  if (!token) throw Error("metrics_read_token_required");
  const config = JSON.parse(await readFile(new URL("../config/service-alerts.json", import.meta.url), "utf8"));
  async function query(sql) {
    const response = await fetch("https://api.cloudflare.com/client/v4/analytics/sql", {
      method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "text/plain" }, body: sql,
      redirect: "manual", signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw Error("health_query_failed");
    return (await response.json()).data;
  }
  const rows = await query(`SELECT timestamp, blob2, blob4, double1, double2, double3, double4, double5, double6, double7, double8 FROM events.analyticsEngine.pulbase_service_health WHERE accountTag = '${config.accountId}' AND blob1 = 'staging' AND blob3 = 'v1' AND timestamp >= NOW() - INTERVAL '60' MINUTE ORDER BY double4 DESC LIMIT 16`);
  const summary = verifyServiceHealth(rows, args[2]);
  const alert = await query(config.alerts[0].query);
  const alertValue = Number(alert?.[0]?.value);
  if (![0, 1, 2, 3, 4, 5].includes(alertValue)) throw Error("invalid_alert_value");
  if (args[2] === "down" && alertValue !== 1 || args[2] === "recovered" && alertValue !== 2) throw Error("alert_phase_mismatch");
  console.log(JSON.stringify({ environment: "staging", checkedAt: new Date().toISOString(), ...summary, alertValue, writes: 0 }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(() => {
  console.error("service_health_verification_failed; details suppressed"); process.exitCode = 1;
});
