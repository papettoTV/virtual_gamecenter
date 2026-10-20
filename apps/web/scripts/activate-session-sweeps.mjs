import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { rpcResult } from "./rpc-result.mjs";

async function main() {
  if (process.argv.slice(2).join(" ") !== "--environment staging") throw Error("staging_only");
  process.env.WRANGLER_WRITE_LOGS = "false";
  process.env.WRANGLER_SEND_METRICS = "false";
  const directory = await mkdtemp(join(tmpdir(), "pulbase-session-activation-"));
  const configPath = join(directory, "wrangler.json");
  await writeFile(configPath, JSON.stringify({ name: "pulbase-session-activation-local", account_id: "60e5472a284dc71bbafbbfac8aa2a940", compatibility_date: "2026-07-26",
    services: [{ binding: "OPERATOR", service: "pulbase-staging", entrypoint: "SessionMaintenance", remote: true }] }), { mode: 0o600 });
  let proxy;
  try {
    const { getPlatformProxy } = await import("wrangler");
    proxy = await getPlatformProxy({ configPath, envFiles: [], persist: false, remoteBindings: true });
    let cursor = "", visited = 0;
    for (let batch = 0; batch < 10; batch += 1) {
      const result = await rpcResult(proxy.env.OPERATOR.activate(cursor));
      if (result.error) throw Error("activation_denied");
      visited += result.visited;
      if (result.next === null) {
        console.log(JSON.stringify({ environment: "staging", visited, complete: true })); return;
      }
      cursor = result.next;
    }
    throw Error("activation_batch_limit");
  } finally { await proxy?.dispose(); await rm(directory, { recursive: true, force: true }); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(() => { console.error("session_sweep_activation_failed; details suppressed"); process.exitCode = 1; });
