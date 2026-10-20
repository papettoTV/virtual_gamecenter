import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { rpcResult } from "./rpc-result.mjs";

export function healthDrillCommand(args) {
  if (args.length !== 3 || args[0] !== "--environment" || args[1] !== "staging"
    || !["start", "status", "recover", "finish"].includes(args[2])) throw Error("staging_health_drill_only");
  return args[2];
}

async function main() {
  const command = healthDrillCommand(process.argv.slice(2));
  process.env.WRANGLER_WRITE_LOGS = "false";
  process.env.WRANGLER_SEND_METRICS = "false";
  const directory = await mkdtemp(join(tmpdir(), "pulbase-health-drill-"));
  let proxy;
  try {
    const configPath = join(directory, "wrangler.json");
    await writeFile(configPath, JSON.stringify({ name: "pulbase-health-drill-local", account_id: "60e5472a284dc71bbafbbfac8aa2a940", compatibility_date: "2026-10-20",
      services: [{ binding: "OPERATOR", service: "pulbase-service-monitor", entrypoint: "HealthDrillOperator", remote: true }] }), { mode: 0o600 });
    const { getPlatformProxy } = await import("wrangler");
    proxy = await getPlatformProxy({ configPath, envFiles: [], persist: false, remoteBindings: true });
    const result = await rpcResult(proxy.env.OPERATOR[command]());
    console.log(JSON.stringify({ environment: "staging", command, checkedAt: new Date().toISOString(), result }));
  } finally { await proxy?.dispose(); await rm(directory, { recursive: true, force: true }); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(() => {
  console.error("health_drill_failed; details suppressed"); process.exitCode = 1;
});
