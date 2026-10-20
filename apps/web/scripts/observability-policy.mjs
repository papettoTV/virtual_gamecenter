import { execFileSync } from "node:child_process";
import { isDeepStrictEqual } from "node:util";
import { pathToFileURL } from "node:url";

const account = "60e5472a284dc71bbafbbfac8aa2a940";
const worker = "pulbase-staging";
const endpoint = `https://api.cloudflare.com/client/v4/accounts/${account}/workers/scripts/${worker}/script-settings`;

export function tokenCommandOptions(environment = process.env) {
  return {
    encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    env: { ...environment, WRANGLER_WRITE_LOGS: "false", WRANGLER_SEND_METRICS: "false" },
  };
}

export function parseTokenOutput(output) {
  try {
    const auth = JSON.parse(output);
    if (typeof auth.token !== "string" || !auth.token) throw Error();
    return auth.token;
  } catch { throw Error("Cloudflare authentication output unavailable; details suppressed"); }
}

export function policyOptions(args) {
  if (args.length < 2 || args[0] !== "--environment" || args[1] !== "staging"
    || (args.length !== 2 && (args.length !== 3 || args[2] !== "--apply"))) {
    throw Error("Use --environment staging [--apply]; production and target overrides are forbidden");
  }
  return { apply: args.length === 3 };
}

function validate(settings) {
  const observability = settings?.observability;
  if (observability?.enabled !== true || observability.logs?.enabled !== true
    || observability.logs?.persist !== true || observability.logs?.invocation_logs !== true
    || typeof observability.redact_query_string !== "boolean") {
    throw Error("Monitoring settings are missing or unsupported; no changes made");
  }
  return observability;
}

function summary(settings, changed) {
  const observability = validate(settings);
  const rate = observability.logs.head_sampling_rate ?? observability.head_sampling_rate;
  return {
    environment: "staging", worker, changed,
    queryRedaction: observability.redact_query_string,
    logsEnabled: true, logsPersisted: true, invocationLogs: true,
    logSampleRate: Number.isFinite(rate) && rate >= 0 && rate <= 1 ? rate : null,
    tracesEnabled: observability.traces?.enabled === true,
    logpushEnabled: settings.logpush === true,
    tailConsumerCount: Array.isArray(settings.tail_consumers) ? settings.tail_consumers.length : 0,
  };
}

export async function enforceObservabilityPolicy(token, { apply = false } = {}, request = fetch) {
  async function api(method, body) {
    let response;
    try {
      response = await request(endpoint, {
        method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        ...(body ? { body: JSON.stringify(body) } : {}),
        redirect: "error", signal: AbortSignal.timeout(15_000),
      });
      const payload = await response.json();
      if (!response.ok || payload?.success !== true || !payload.result) throw Error();
      return payload.result;
    } catch { throw Error("Cloudflare policy request failed; response details suppressed"); }
  }
  const before = await api("GET");
  const observability = validate(before);
  if (observability.redact_query_string || !apply) return summary(before, false);
  const expected = { ...observability, redact_query_string: true };
  await api("PATCH", { observability: expected });
  const after = await api("GET");
  if (!isDeepStrictEqual(after.observability, expected)
    || !isDeepStrictEqual(after.logpush, before.logpush)
    || !isDeepStrictEqual(after.tail_consumers, before.tail_consumers)) {
    throw Error("Policy verification failed; inspect staging settings before further changes");
  }
  return summary(after, true);
}

async function main() {
  const options = policyOptions(process.argv.slice(2));
  const token = parseTokenOutput(execFileSync(process.execPath, ["node_modules/wrangler/bin/wrangler.js", "auth", "token", "--json"], tokenCommandOptions()));
  const result = await enforceObservabilityPolicy(token, options);
  console.log(JSON.stringify(result, null, 2));
  if (!result.queryRedaction) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(() => {
  console.error("Staging log policy check failed; authentication and response details are not logged.");
  process.exitCode = 1;
});
