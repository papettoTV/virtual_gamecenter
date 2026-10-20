import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { validateRevocationDrill } from "./revocation-drill.mjs";
import { rpcResult } from "./rpc-result.mjs";

export function validateOperationDrill(config) {
  assert.equal(config.main, "../src/recovery/operation-drill.ts");
  assert.equal(config.vars?.OPERATION_DRILL, "synthetic-only-v1");
  assert.equal(config.name, "pulbase-revocation-drill-20261020");
  return validateRevocationDrill({ ...config, main: "../src/recovery/revocation-drill.ts" });
}

async function main() {
  const [action, ...extra] = process.argv.slice(2);
  if (extra.length || !["start-fail", "start-recover", "login-fail", "credit-fail", "credit-recover", "quiesce"].includes(action)) throw Error("operation_drill_action_required");
  const config = JSON.parse(await readFile(new URL("../config/operation-drill.json", import.meta.url)));
  const service = validateOperationDrill(config);
  const temporary = await mkdtemp(join(tmpdir(), "pulbase-operation-proxy-"));
  let proxy;
  try {
    const configPath = join(temporary, "wrangler.json");
    await writeFile(configPath, JSON.stringify({ name: "pulbase-operation-proxy-local", account_id: config.account_id, compatibility_date: "2026-07-26",
      main: resolve("src/recovery/revocation-proxy.mjs"), services: [{ binding: "OPERATOR", service, entrypoint: "OperationOperator", remote: true },
        { binding: "CLEANUP", service, entrypoint: "RevocationOperator", remote: true }] }), { mode: 0o600 });
    const { getPlatformProxy } = await import("wrangler");
    proxy = await getPlatformProxy({ configPath, envFiles: [], persist: false, remoteBindings: true });
    const [family, mode] = action.split("-");
    const result = action === "quiesce" ? await rpcResult(proxy.env.CLEANUP.quiesce()) : await rpcResult(proxy.env.OPERATOR.exercise(family, mode));
    console.log(JSON.stringify(action === "quiesce" ? { environment: "isolated-staging-drill", stoppedCabinets: result.cabinetIds.length, admissions: result.admissions } : result));
  } finally { await proxy?.dispose(); await rm(temporary, { recursive: true, force: true }); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => {
  console.error(JSON.stringify({ error: "operation_drill_failed", kind: error?.name,
    reason: /operation_drill_[a-z_]+/.exec(error?.message ?? "")?.[0] ?? "private_details_suppressed", retry: "inspect_execution_record_first" })); process.exitCode = 1;
});
