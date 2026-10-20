import { pathToFileURL } from "node:url";

export { operationFamilies, operationExpression, operationReportQuery, summarizeOperations } from "../src/shared/operation-report.mjs";
import { operationReportQuery, summarizeOperations } from "../src/shared/operation-report.mjs";

async function main() {
  if (process.argv.slice(2).join(" ") !== "--environment staging") throw Error("staging_report_only");
  process.loadEnvFile(".dev.vars");
  if (!process.env.CLOUDFLARE_METRICS_TOKEN) throw Error("metrics_token_required");
  const response = await fetch("https://api.cloudflare.com/client/v4/analytics/sql", {
    method: "POST", headers: { Authorization: `Bearer ${process.env.CLOUDFLARE_METRICS_TOKEN}`, "Content-Type": "text/plain" },
    body: operationReportQuery(), redirect: "manual", signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw Error("operation_query_failed");
  console.log(JSON.stringify({ environment: "staging", checkedAt: new Date().toISOString(), windowMinutes: 20,
    countsAreEstimates: true, families: summarizeOperations((await response.json()).data), writes: 0 }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(() => {
  console.error("operation_report_failed; details suppressed"); process.exitCode = 1;
});
