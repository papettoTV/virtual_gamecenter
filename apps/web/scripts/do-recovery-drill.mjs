import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import WebSocket from "ws";
import { validateRecoveryConfig } from "./recovery-drill.mjs";

export function validateDoRecoveryConfig(config) {
  assert.match(config.name, /^pulbase-recovery-drill-\d{8}-do$/);
  validateRecoveryConfig({ name: config.name, account_id: config.account_id, workers_dev: config.workers_dev, preview_urls: config.preview_urls,
    vars: { RECOVERY_DRILL: config.vars?.RECOVERY_DRILL },
    d1_databases: config.d1_databases?.map(value => ({ ...value, remote: true })), r2_buckets: config.r2_buckets?.map(value => ({ ...value, remote: true })) });
  assert.ok(config.main?.endsWith("src/recovery/worker.ts"));
  assert.equal(config.vars.APP_ENV, "staging");
  for (const key of ["DEVELOPER_AUTH_ENABLED", "CREDIT_PURCHASES_ENABLED", "USAGE_MONITOR_ENABLED"]) assert.equal(config.vars[key], "false");
  assert.deepEqual(config.durable_objects?.bindings, [
    { name: "CABINET_ROOMS", class_name: "CabinetRoom" }, { name: "ABUSE_GUARDS", class_name: "AbuseGuard" }, { name: "RECOVERY_CONTROL", class_name: "RecoveryControl" },
  ]);
  assert.deepEqual(config.ratelimits?.map(value => value.name), ["API_READ_LIMITER", "API_WRITE_LIMITER", "BOOTSTRAP_LIMITER", "BENEFIT_LIMITER", "SOCKET_LIMITER", "AUTH_LIMITER"]);
  assert.ok(config.ratelimits.every(value => /^202610203[1-6]$/.test(value.namespace_id)));
  for (const key of ["env", "routes", "route", "triggers", "services", "secrets"]) assert.equal(config[key], undefined);
  return config.name;
}

function wrangler(configPath, args) {
  const require = createRequire(import.meta.url);
  const packagePath = require.resolve("wrangler/package.json");
  const binary = resolve(dirname(packagePath), require("wrangler/package.json").bin.wrangler);
  return JSON.parse(execFileSync(process.execPath, [binary, ...args, "--config", configPath, "--json"], { encoding: "utf8", timeout: 30000 }));
}

const origin = "http://127.0.0.1:8797";
const sockets = [];
async function connect(cabinetId, cookie = "", blocked = false) {
  return new Promise((resolveConnection, reject) => {
    const socket = new WebSocket(`${origin.replace("http:", "ws:")}/api/cabinets/${cabinetId}/ws?gameId=graze-duel`, { headers: { Cookie: cookie, Origin: origin } });
    sockets.push(socket);
    const queue = [];
    const timer = setTimeout(() => { socket.terminate(); reject(Error("drill_socket_timeout")); }, 10000);
    socket.on("message", raw => { queue.push(JSON.parse(String(raw))); });
    const closed = new Promise(resolveClose => { socket.once("close", code => { resolveClose(code); }); });
    socket.once("open", () => { clearTimeout(timer); blocked ? reject(Error("drill_unexpected_open")) : resolveConnection({ socket, queue, closed }); });
    socket.once("error", error => { clearTimeout(timer); reject(error); });
    socket.once("unexpected-response", (_request, response) => {
      clearTimeout(timer); response.resume();
      if (blocked && response.statusCode === 503) resolveConnection({ blocked: true });
      else reject(Error(`drill_upgrade_${response.statusCode}`));
    });
  });
}

async function message(client, type) {
  const until = Date.now() + 10000;
  while (Date.now() < until) {
    const index = client.queue.findIndex(value => value.type === type);
    if (index >= 0) return client.queue.splice(index, 1)[0];
    await new Promise(resolveWait => setTimeout(resolveWait, 20));
  }
  throw Error(`drill_message_timeout_${type}`);
}

async function api(path, cookie, body) {
  const response = await fetch(`${origin}/api/${path}`, { method: body ? "POST" : "GET", headers: { Cookie: cookie, Origin: origin, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined, redirect: "manual", signal: AbortSignal.timeout(10000) });
  return { response, data: await response.json() };
}

async function exerciseStop(operator, configPath) {
  assert.equal((await operator.status()).mode, "open");
  const clients = [];
  for (const player of ["recovery-drill-deleted", "recovery-drill-survivor"]) {
    const cabinetId = crypto.randomUUID();
    const cookie = `vgc_session=${player}`;
    const host = await connect(cabinetId, cookie); const viewer = await connect(cabinetId);
    for (const [client, watch] of [[host, false], [viewer, true]]) {
      client.socket.send(JSON.stringify({ type: "joinCabinet", gameId: "graze-duel", watch })); await message(client, "joinedCabinet");
    }
    const reservation = await api("platform/credit-reservations", cookie, { cabinetId, gameId: "graze-duel", purpose: "solo" });
    assert.equal(reservation.response.status, 200);
    assert.equal((await api(`platform/credit-reservations/${reservation.data.reservationId}/capture`, cookie, {})).response.status, 200);
    host.socket.send(JSON.stringify({ type: "startSolo", reservationId: reservation.data.reservationId })); await message(host, "soloStarted");
    host.socket.send(JSON.stringify({ type: "gameKeyframe", seq: 1, snapshot: { gameId: "graze-duel", state: { elapsedTime: 1 } } })); await message(viewer, "viewerKeyframe");
    clients.push(host, viewer);
  }
  const bookmark = wrangler(configPath, ["d1", "time-travel", "info", "DB"]).bookmark;
  const stopped = await operator.stop(); assert.equal(stopped.error, undefined);
  assert.deepEqual(await Promise.all(clients.map(client => client.closed)), [1012, 1012, 1012, 1012]);
  assert.equal((await fetch(origin, { signal: AbortSignal.timeout(10000) })).status, 503);
  assert.equal((await api("platform/bootstrap", "")).response.status, 503);
  assert.equal((await api("platform/credit-reservations", "vgc_session=recovery-drill-survivor", {})).response.status, 503);
  await connect(stopped.cabinetIds[0], "", true);
  assert.equal((await operator.resume()).error, "recovery_not_ready");
  const state = await operator.rooms();
  assert.equal(state.admissions, 0);
  assert.ok(state.rooms.length >= 2);
  assert.ok(state.rooms.every(room => room.suspended && !room.connections));
  return { action: "exercise-stop", bookmark, activeCabinets: 2, closedSockets: 4, closeCode: 1012, blockedHttpAndWs: true, admissionsReturned: true, rooms: state.rooms.length };
}

async function verifyResumed(operator, database) {
  assert.equal((await operator.status()).mode, "open");
  const state = await operator.rooms();
  assert.ok(state.rooms.every(room => !room.suspended && room.status === "empty" && !room.hasReplay && !room.connections));
  assert.equal(state.admissions, 0);
  assert.equal((await api("platform/credits", "vgc_session=recovery-drill-deleted")).response.status, 401);
  assert.equal((await api("platform/credits", "vgc_session=recovery-drill-survivor")).response.status, 401);
  const viewer = await connect(state.rooms[0].id);
  viewer.socket.send(JSON.stringify({ type: "joinCabinet", gameId: "graze-duel", watch: true })); await message(viewer, "joinedCabinet");
  assert.ok(!viewer.queue.some(value => value.type === "viewerKeyframe"));
  viewer.socket.close(); await viewer.closed;
  const token = randomUUID();
  const hash = createHash("sha256").update(token).digest("hex");
  await database.prepare("INSERT INTO player_sessions (token_hash, player_id, expires_at) VALUES (?, 'recovery-drill-survivor', datetime('now', '+1 day'))").bind(hash).run();
  const cookie = `vgc_session=${token}`;
  const client = await connect(state.rooms[1].id, cookie);
  client.socket.send(JSON.stringify({ type: "joinCabinet", gameId: "graze-duel" })); await message(client, "joinedCabinet");
  const reservation = await api("platform/credit-reservations", cookie, { cabinetId: state.rooms[1].id, gameId: "graze-duel", purpose: "solo" });
  assert.equal(reservation.response.status, 200);
  assert.equal((await api(`platform/credit-reservations/${reservation.data.reservationId}/capture`, cookie, {})).response.status, 200);
  client.socket.send(JSON.stringify({ type: "startSolo", reservationId: reservation.data.reservationId })); await message(client, "soloStarted");
  const wallet = await database.prepare("SELECT free_balance, purchased_balance FROM credit_wallets WHERE player_id = 'recovery-drill-survivor'").first();
  assert.deepEqual(wallet, { free_balance: 3, purchased_balance: 5 });
  client.socket.close(); await client.closed;
  return { action: "verify-resumed", oldSessionsRejected: true, noStalePlayback: true, spectatorReconnect: true, freshSessionAndPlay: true, freeBalance: 3, syntheticPurchasedBalance: 5 };
}

async function main() {
  const [configPath, action] = process.argv.slice(2);
  assert.ok(["status", "stop", "reconcile", "resume", "rooms", "deleteFixture", "exercise-stop", "verify-resumed"].includes(action));
  const config = JSON.parse(await readFile(configPath, "utf8"));
  const name = validateDoRecoveryConfig(config);
  const info = wrangler(configPath, ["d1", "info", "DB"]);
  assert.equal(info.name, name); assert.equal(info.uuid, config.d1_databases[0].database_id);
  const temporary = await mkdtemp(join(tmpdir(), "pulbase-do-drill-"));
  const proxyConfig = join(temporary, "wrangler.json");
  await writeFile(proxyConfig, JSON.stringify({ name: "pulbase-recovery-operator-local", account_id: config.account_id, compatibility_date: "2026-07-26",
    services: [{ binding: "OPERATOR", service: name, entrypoint: "RecoveryOperator", remote: true }],
    d1_databases: config.d1_databases.map(value => ({ ...value, remote: true })) }), { mode: 0o600 });
  const { getPlatformProxy } = await import("wrangler");
  let proxy;
  let succeeded = false;
  try {
    proxy = await getPlatformProxy({ configPath: proxyConfig, envFiles: [], persist: false, remoteBindings: true });
    const operator = proxy.env.OPERATOR;
    const result = action === "exercise-stop" ? await exerciseStop(operator, configPath) : action === "verify-resumed" ? await verifyResumed(operator, proxy.env.DB) : await operator[action]();
    assert.equal(result.error, undefined);
    console.log(JSON.stringify(result));
    succeeded = true;
  } finally {
    for (const socket of sockets) socket.terminate();
    if (!succeeded && proxy && ["exercise-stop", "verify-resumed"].includes(action)) await proxy.env.OPERATOR.stop().catch(() => {});
    await proxy?.dispose(); await rm(temporary, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => {
  console.error(`do_recovery_drill_failed: ${error instanceof Error ? error.message : "unknown"}`);
  process.exitCode = 1;
});
