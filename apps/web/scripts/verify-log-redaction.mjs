import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { policyOptions } from "./observability-policy.mjs";

const apiRoot = "https://api.cloudflare.com/client/v4/accounts/60e5472a284dc71bbafbbfac8aa2a940/workers/observability/telemetry";

export function canaryQuery(marker, from, to) {
  if (!/^pulbase-log-audit-[a-f0-9-]{36}$/.test(marker) || !Number.isFinite(from)
    || !Number.isFinite(to) || from >= to || to - from > 300_000) throw Error("Invalid canary query");
  return {
    queryId: marker, dry: true, view: "events", limit: 20, timeframe: { from, to },
    parameters: {
      filterCombination: "and",
      filters: [
        { key: "$metadata.service", operation: "eq", type: "string", value: "pulbase-staging" },
        { key: "$metadata.message", operation: "includes", type: "string", value: marker },
      ],
    },
  };
}

export function verifyCanaryEvents(result, marker, code, state) {
  const events = result?.events?.events;
  if (!Array.isArray(events) || events.length === 0) return { confirmed: false, matchingEvents: 0 };
  for (const event of events) {
    const serialized = JSON.stringify(event);
    if (!serialized.includes(marker)) throw Error("Unexpected log scope; event details suppressed");
    if (serialized.includes(code) || serialized.includes(state)
      || serialized.includes("code=") || serialized.includes("state=")) {
      throw Error("Query redaction failed; event details suppressed");
    }
  }
  return { confirmed: true, matchingEvents: events.length };
}

export async function verifyStoredRedaction({ token, authorization }, request = fetch, wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))) {
  async function api(path, body) {
    try {
      const response = await request(apiRoot + path, {
        method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(body), redirect: "error", signal: AbortSignal.timeout(15_000),
      });
      const data = await response.json();
      if (!response.ok || data.success !== true) throw Error();
      return data.result;
    } catch { throw Error("Observability access failed; response details suppressed"); }
  }
  const started = Date.now();
  const filters = [{ key: "$metadata.service", operation: "eq", type: "string", value: "pulbase-staging" }];
  const keys = await api("/keys", { timeframe: { from: started - 300_000, to: started }, filters });
  if (!Array.isArray(keys) || !["$metadata.service", "$metadata.message"].every(key => keys.some(row => row.key === key))) {
    throw Error("Required log fields unavailable; no canary sent");
  }
  const marker = `pulbase-log-audit-${crypto.randomUUID()}`;
  const code = `synthetic-code-${crypto.randomUUID()}`, state = `synthetic-state-${crypto.randomUUID()}`;
  const probe = new URL(`https://develop.virtual-gamecenter.pages.dev/__${marker}`);
  probe.search = new URLSearchParams({ code, state }).toString();
  const response = await request(probe, {
    method: "GET", headers: { Authorization: authorization }, redirect: "error",
    signal: AbortSignal.timeout(15_000), cache: "no-store",
  });
  await response.body?.cancel();
  if (!response.ok) throw Error("Canary request failed; no user session was created");
  for (let attempt = 0; attempt < 3; attempt++) {
    await wait(20_000);
    const result = await api("/query", canaryQuery(marker, started - 1000, Date.now()));
    const verification = verifyCanaryEvents(result, marker, code, state);
    if (verification.confirmed) return { environment: "staging", ...verification, syntheticRequestStatus: response.status, queryValuesAbsent: true };
  }
  throw Error("Canary log not available within the bounded verification window");
}

async function main() {
  if (policyOptions(process.argv.slice(2)).apply) throw Error("Verification is read-only");
  if (existsSync(".dev.vars")) process.loadEnvFile(".dev.vars");
  const token = process.env.CLOUDFLARE_OBSERVABILITY_TOKEN;
  const username = process.env.PULBASE_CHECK_USERNAME, password = process.env.PULBASE_CHECK_PASSWORD;
  if (!token || !username || !password) throw Error("Local verification credentials required");
  console.log(JSON.stringify(await verifyStoredRedaction({
    token, authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`,
  }), null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(() => {
  console.error("Stored-log verification incomplete; credentials and log contents are not logged.");
  process.exitCode = 1;
});
