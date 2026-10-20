import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import WebSocket from "ws";
import { rpcResult } from "./rpc-result.mjs";

export function validateRevocationDrill(config) {
  assert.match(config.name, /^pulbase-revocation-drill-\d{8}$/);
  assert.equal(config.account_id, "60e5472a284dc71bbafbbfac8aa2a940");
  assert.equal(config.workers_dev, false); assert.equal(config.preview_urls, false);
  assert.equal(config.vars?.REVOCATION_DRILL, "synthetic-only-v1");
  assert.equal(config.vars.APP_ENV, "staging");
  for (const key of ["DEVELOPER_AUTH_ENABLED", "CREDIT_PURCHASES_ENABLED", "USAGE_MONITOR_ENABLED"]) assert.equal(config.vars[key], "false");
  assert.equal(config.d1_databases?.length, 1);
  assert.equal(config.d1_databases[0].database_name, config.name);
  assert.equal(config.d1_databases[0].database_id, "9787b59a-a5cb-46f2-b10d-26a0ab679493");
  assert.deepEqual(config.durable_objects?.bindings, [{ name: "CABINET_ROOMS", class_name: "CabinetRoom" }, { name: "ABUSE_GUARDS", class_name: "AbuseGuard" }]);
  assert.deepEqual(config.analytics_engine_datasets, [{ binding: "SECURITY_EVENTS", dataset: "pulbase_service_health" }]);
  assert.ok(config.main.endsWith("src/recovery/revocation-drill.ts"));
  for (const key of ["env", "routes", "route", "triggers", "services", "secrets", "assets", "r2_buckets"]) assert.equal(config[key], undefined);
  return config.name;
}

const origin = "http://127.0.0.1:8798";
async function connect(cabinet, game, cookie, sockets) {
  const socket = new WebSocket(`${origin.replace("http:", "ws:")}/api/cabinets/${cabinet}/ws?gameId=${game}`, { headers: { Cookie: cookie }, handshakeTimeout: 10000 });
  sockets.push(socket);
  const messages = [];
  let closeCode = 0;
  socket.on("message", bytes => messages.push(JSON.parse(String(bytes))));
  socket.on("close", code => { closeCode = code; });
  socket.on("error", () => {});
  await new Promise((resolveOpen, reject) => {
    socket.once("open", resolveOpen); socket.once("error", () => reject(Error("drill_socket_unavailable")));
    socket.once("unexpected-response", (_request, response) => { response.resume(); reject(Error(`drill_upgrade_${response.statusCode}`)); });
  });
  const wait = async (predicate, timeout = 10000) => {
    const deadline = Date.now() + timeout;
    while (!predicate()) {
      if (Date.now() > deadline) throw Error("drill_wait_timeout");
      await new Promise(resolveWait => setTimeout(resolveWait, 100));
    }
  };
  const message = async type => { await wait(() => messages.some(item => item.type === type)); return messages.splice(messages.findIndex(item => item.type === type), 1)[0]; };
  await message("connected");
  return { socket, message, wait, code: () => closeCode };
}

async function main() {
  const [configPath, action] = process.argv.slice(2);
  if (!["exercise", "quiesce"].includes(action)) throw Error("Use <drill-config> exercise|quiesce");
  const config = JSON.parse(await readFile(configPath, "utf8"));
  const name = validateRevocationDrill(config);
  const temporary = await mkdtemp(join(tmpdir(), "pulbase-revocation-proxy-"));
  const proxyConfig = join(temporary, "wrangler.json");
  await writeFile(proxyConfig, JSON.stringify({ name: "pulbase-revocation-proxy-local", account_id: config.account_id, compatibility_date: "2026-07-26",
    main: resolve("src/recovery/revocation-proxy.mjs"), services: [{ binding: "DRILL", service: name, remote: true }, { binding: "OPERATOR", service: name, entrypoint: "RevocationOperator", remote: true }] }), { mode: 0o600 });
  const require = createRequire(import.meta.url);
  const binary = resolve(dirname(require.resolve("wrangler/package.json")), require("wrangler/package.json").bin.wrangler);
  const server = spawn(process.execPath, [binary, "dev", "--config", proxyConfig, "--ip", "127.0.0.1", "--port", "8798"], {
    detached: true, stdio: ["ignore", "ignore", "ignore"], env: { ...process.env, WRANGLER_WRITE_LOGS: "false", WRANGLER_SEND_METRICS: "false" },
  });
  const sockets = [];
  const cabinets = [];
  const report = { environment: "isolated-staging-drill", startedAt: new Date().toISOString(), loadTest: false, games: [] };
  let proxy;
  let stage = "proxy-ready";
  try {
    let ready = false;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      if (server.exitCode !== null) throw Error("drill_proxy_stopped");
      try { const response = await fetch(`${origin}/__drill/ready`, { signal: AbortSignal.timeout(1000) }); ready = response.headers.get("X-Revocation-Drill") === "synthetic-only-v1"; await response.body?.cancel(); } catch {}
      if (ready) break;
      await new Promise(resolveWait => setTimeout(resolveWait, 500));
    }
    assert.equal(ready, true);
    stage = "operator-connection";
    const { getPlatformProxy } = await import("wrangler");
    proxy = await getPlatformProxy({ configPath: proxyConfig, envFiles: [], persist: false, remoteBindings: true });
    const operator = proxy.env.OPERATOR;
    if (action === "quiesce") {
      const result = await rpcResult(operator.quiesce());
      cabinets.push(...result.cabinetIds);
      assert.equal(result.admissions, 0);
      console.log(JSON.stringify({ environment: "isolated-staging-drill", quiescentCabinets: result.cabinetIds.length, admissions: 0 }));
      return;
    }
    for (const game of ["graze-duel", "dot-wave", "deep-sea-salvage"]) {
      stage = `${game}:prepare`;
      const fixture = await rpcResult(operator.prepare(game)); cabinets.push(fixture.cabinet);
      stage = `${game}:connect`;
      const old = await connect(fixture.cabinet, game, fixture.cookies[0], sockets);
      stage = `${game}:connect-valid`;
      const valid = await connect(fixture.cabinet, game, fixture.cookies[1], sockets);
      stage = `${game}:connect-viewer`;
      const viewer = await connect(fixture.cabinet, game, "", sockets);
      for (const [client, watch] of [[old, false], [valid, true], [viewer, true]]) {
        client.socket.send(JSON.stringify({ type: "joinCabinet", gameId: game, watch })); await client.message("joinedCabinet");
      }
      await operator.fault(fixture.cabinet, true);
      stage = `${game}:faulty-logout`;
      const started = Date.now();
      const failedLogout = await rpcResult(operator.logout(fixture.cookies[0]));
      console.log(JSON.stringify({ stage, status: failedLogout.status, invalidated: failedLogout.invalidated, before: failedLogout.before, after: failedLogout.after }));
      assert.equal(failedLogout.status, 200); assert.equal(failedLogout.invalidated, true);
      assert.equal(failedLogout.before, 1); assert.equal(failedLogout.after, 1);
      await old.wait(() => old.code() !== 0, 90000);
      stage = `${game}:verify-close`;
      assert.equal(old.code(), 1008);
      const idleClosedMs = Date.now() - started;
      assert.equal(valid.code(), 0); assert.equal(viewer.code(), 0);
      for (const client of [valid, viewer]) { client.socket.send(JSON.stringify({ type: "clockPing", sentAt: 1 })); await client.message("clockPong"); }
      await operator.fault(fixture.cabinet, false);
      stage = `${game}:recover`;
      const fresh = await connect(fixture.cabinet, game, fixture.cookies[2], sockets);
      fresh.socket.send(JSON.stringify({ type: "joinCabinet", gameId: game })); await fresh.message("joinedCabinet");
      const recoveredLogout = await rpcResult(operator.logout(fixture.cookies[2]));
      console.log(JSON.stringify({ stage, status: recoveredLogout.status, invalidated: recoveredLogout.invalidated, before: recoveredLogout.before, after: recoveredLogout.after }));
      assert.equal(recoveredLogout.status, 200); assert.equal(recoveredLogout.invalidated, true);
      assert.equal(recoveredLogout.before, 1); assert.equal(recoveredLogout.after, 0);
      fresh.socket.send(JSON.stringify({ type: "clockPing", sentAt: 2 }));
      await fresh.wait(() => fresh.code() !== 0); assert.equal(fresh.code(), 1008);
      const rpcClientCloseObserved = true;
      fresh.socket.close();
      valid.socket.close(); viewer.socket.close();
      stage = `${game}:cleanup`;
      await operator.cleanup(fixture.cabinet);
      let admissions = -1;
      for (let attempt = 0; attempt < 10; attempt += 1) {
        admissions = (await rpcResult(operator.status(fixture.cabinet))).admissions;
        if (admissions === 0) break;
        await new Promise(resolveWait => setTimeout(resolveWait, 500));
      }
      assert.equal(admissions, 0);
      const result = { game, idleClosedMs, closedWithoutSending: true, unaffectedSessionsPreserved: true, rpcRecovered: true, rpcClientCloseObserved, admissions };
      report.games.push(result); console.log(JSON.stringify(result));
    }
    report.completedAt = new Date().toISOString(); report.passed = true;
    console.log(JSON.stringify(report));
  } catch (error) {
    console.error(JSON.stringify({ stage, errorKind: error instanceof Error ? error.name : "unknown", safeReason: error instanceof Error && /^drill_[a-z_0-9]+$/.test(error.message) ? error.message : "operation_failed" }));
    throw Error("drill_failed");
  } finally {
    if (proxy) for (const cabinet of cabinets) { try { await proxy.env.OPERATOR.fault(cabinet, false); } catch {} }
    for (const socket of sockets) socket.terminate();
    try { process.kill(-server.pid, "SIGTERM"); } catch {}
    await proxy?.dispose(); await rm(temporary, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(() => { console.error("revocation_drill_failed; details suppressed"); process.exitCode = 1; });
