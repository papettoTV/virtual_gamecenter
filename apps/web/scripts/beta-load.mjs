import { readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import WebSocket from "ws";

const origin = "https://develop.virtual-gamecenter.pages.dev";
const probe = process.argv.includes("--probe");
const capacityOnly = process.argv.includes("--capacity-only");
const duration = Number(process.env.LOAD_DURATION_SECONDS ?? 120);
if (!process.argv.includes("--confirm-staging") || !Number.isInteger(duration) || duration < 30 || duration > 300) throw Error("検証環境専用です。--confirm-staging と30〜300秒の実行時間が必要です。");
const access = JSON.parse(await readFile(process.env.PULBASE_LOAD_AUTH_FILE ?? "/tmp/pulbase-staging-access.json", "utf8"));
const authorization = "Basic " + Buffer.from(access.username + ":" + access.password).toString("base64");
const gameIds = ["graze-duel", "deep-sea-salvage", "dot-wave"];
const sockets = [];
const results = { environment: "staging", startedAt: new Date().toISOString(), probe, duration, profiles: [] };
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const assert = (value, message) => { if (!value) throw Error(message); };
async function api(path, cookie = "", body) {
  const response = await fetch(origin + "/api/" + path, { method: body === undefined ? "GET" : "POST", headers: { Authorization: authorization, Cookie: cookie, Origin: origin, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(10_000) });
  const data = await response.json();
  assert(response.ok, `API ${path.split("/")[0]} status=${response.status} error=${data.error}`);
  return { data, cookie: response.headers.getSetCookie().map(value => value.split(";", 1)[0]).join("; ") };
}
async function connect(cabinet, gameId, cookie = "") {
  const started = performance.now();
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(origin.replace("https:", "wss:") + `/api/cabinets/${cabinet}/ws?gameId=${gameId}`, { headers: { Authorization: authorization, Origin: origin, Cookie: cookie }, handshakeTimeout: 10_000 });
    const queue = [];
    socket.on("message", raw => { queue.push(JSON.parse(String(raw))); if (queue.length > 1000) queue.shift(); });
    socket.on("error", () => {});
    socket.once("open", () => { sockets.push(socket); resolve({ socket, queue, status: 101, handshakeMs: performance.now() - started }); });
    socket.once("error", reject);
    socket.once("unexpected-response", (_request, response) => { let body = ""; response.on("data", chunk => { body += chunk; }); response.once("end", () => { socket.terminate(); resolve({ status: response.statusCode, error: body.startsWith("{") ? JSON.parse(body).error : "non_json_response" }); }); });
  });
}
async function waitMessage(client, type, predicate = () => true) {
  const started = performance.now();
  while (performance.now() - started < 10_000) {
    const index = client.queue.findIndex(message => message.type === type && predicate(message));
    if (index >= 0) return client.queue.splice(index, 1)[0];
    await sleep(10);
  }
  throw Error(`message timeout: ${type}`);
}
function send(client, message) { client.socket.send(JSON.stringify(message)); }
async function closeAll() {
  await Promise.all(sockets.splice(0).map(socket => new Promise(resolve => {
    if (socket.readyState === WebSocket.CLOSED) return resolve();
    const timeout = setTimeout(() => { socket.terminate(); resolve(); }, 3000);
    socket.once("close", () => { clearTimeout(timeout); resolve(); });
    socket.close();
  })));
  await sleep(2000);
}
function percentile(values, fraction) { return values.length ? Math.round([...values].sort((first, second) => first - second)[Math.ceil(values.length * fraction) - 1]) : null; }
async function profile(cabinetCount) {
  const clients = [];
  const cabinets = Array.from({ length: cabinetCount }, (_, index) => ({ id: randomUUID(), gameId: gameIds[index % gameIds.length] }));
  const report = { cabinets: cabinetCount, participants: 24, accepted: 0, rejected: 0, sentFrames: 0, receivedFrames: 0, expectedFrames: 0, unexpectedClose: 0, applicationErrors: 0, pingMs: [], deliveryMs: [], handshakeMs: [], polls: 0 };
  for (let index = 0; index < 24; index += 1) {
    const cabinet = cabinets[index % cabinetCount];
    const host = index < cabinetCount && !probe;
    let cookie = "";
    if (!probe) {
      const bootstrap = await api("platform/bootstrap"); cookie = bootstrap.cookie;
      if (host) await api("platform/welcome-credit", cookie, {});
    }
    const client = await connect(cabinet.id, cabinet.gameId, cookie);
    if (client.status !== 101) { report.rejected += 1; continue; }
    report.accepted += 1; report.handshakeMs.push(client.handshakeMs);
    if (probe) continue;
    Object.assign(client, { cabinet, host, cookie, lastSequence: 0, pingAt: 0 });
    send(client, { type: "joinCabinet", gameId: cabinet.gameId, watch: !host });
    await waitMessage(client, "joinedCabinet");
    if (host) {
      const reservation = await api("platform/credit-reservations", cookie, { cabinetId: cabinet.id, gameId: cabinet.gameId, purpose: "solo" });
      await api(`platform/credit-reservations/${reservation.data.reservationId}/capture`, cookie, {});
      send(client, { type: "startSolo", reservationId: reservation.data.reservationId });
      await waitMessage(client, "soloStarted");
      send(client, { type: "gameKeyframe", seq: 0, snapshot: { gameId: cabinet.gameId, state: { elapsedTime: 0 } } });
    }
    client.queue.length = 0;
    client.socket.on("close", () => { report.unexpectedClose += 1; });
    client.socket.on("message", raw => {
      const message = JSON.parse(String(raw));
      if (message.type === "error") report.applicationErrors += 1;
      if (message.type === "clockPong" && client.pingAt) { report.pingMs.push(performance.now() - client.pingAt); client.pingAt = 0; }
      if (!host && message.type === "viewerMotionFrame" && message.seq > client.lastSequence) {
        client.lastSequence = message.seq; report.receivedFrames += 1;
        report.deliveryMs.push(Math.max(0, Date.now() - message.frame.sentAt));
      }
    });
    clients.push(client);
  }
  if (probe) return report;
  assert(report.accepted === 24, "normal connection rejected");
  const hosts = clients.filter(client => client.host);
  const started = performance.now(); let tick = 0;
  while (performance.now() - started < duration * 1000) {
    tick += 1;
    for (const host of hosts) {
      if (tick % 20 === 1) send(host, { type: "gameKeyframe", seq: tick, snapshot: { gameId: host.cabinet.gameId, state: { elapsedTime: tick / 20, padding: "x".repeat(8192) } } });
      send(host, { type: "gameMotionFrame", seq: tick, frame: { sentAt: Date.now(), gameId: host.cabinet.gameId, state: { x: tick % 300, y: 200, padding: "x".repeat(1024) } } });
      report.sentFrames += 1;
      report.expectedFrames += clients.filter(client => !client.host && client.cabinet === host.cabinet).length;
    }
    if (tick % 100 === 1) for (const client of clients) { client.pingAt = performance.now(); send(client, { type: "clockPing", sentAt: Date.now() }); }
    if (tick % 200 === 1) {
      await Promise.all(clients.flatMap(client => gameIds.map(async gameId => {
        const response = await api(`cabinets?gameId=${gameId}`, client.cookie);
        for (const cabinet of cabinets.filter(item => item.gameId === gameId)) assert(response.data.cabinets.some(item => item.cabinetId === cabinet.id), "active cabinet disappeared from directory");
        report.polls += 1;
      })));
    }
    await sleep(50);
  }
  await sleep(1500);
  for (const client of clients.filter(client => !client.host)) assert(client.lastSequence === tick, "viewer did not receive the final frame");
  Object.assign(report, { pingP95Ms: percentile(report.pingMs, .95), deliveryP95Ms: percentile(report.deliveryMs, .95), handshakeP95Ms: percentile(report.handshakeMs, .95), elapsedSeconds: Math.round((performance.now() - started) / 1000) });
  delete report.pingMs; delete report.deliveryMs; delete report.handshakeMs;
  assert(report.unexpectedClose === 0 && report.applicationErrors === 0, "unexpected disconnect or application error");
  assert(report.receivedFrames / report.expectedFrames >= .99 && report.deliveryP95Ms < 1000 && report.pingP95Ms < 1000, "delivery SLO failed");
  for (const client of clients) client.socket.removeAllListeners("close");
  return report;
}
async function capacityRecovery() {
  const cabinets = [randomUUID(), randomUUID(), randomUUID()];
  for (let index = 0; index < 64; index += 1) assert((await connect(cabinets[index % 3], gameIds[index % 3])).status === 101, "released NAT capacity was not restored");
  const denied = await connect(cabinets[0], gameIds[0]);
  assert(denied.status === 429 && denied.error === "distributed_rate_limited", "NAT upper bound was not enforced");
  await closeAll();
  assert((await connect(cabinets[0], gameIds[0])).status === 101, "capacity was not restored after the upper-bound test");
  return { accepted: 64, overflowRejected: true, capacityReturned: true };
}
try {
  for (const count of capacityOnly ? [] : probe ? [6] : [6, 1]) {
    const report = await profile(count); results.profiles.push(report); console.log(JSON.stringify(report));
    await closeAll();
    if (!probe && count === 6) await sleep(65_000);
  }
  if (!probe) { if (!capacityOnly) await sleep(65_000); results.capacityRecovery = await capacityRecovery(); console.log(JSON.stringify(results.capacityRecovery)); }
  results.success = true;
} catch (error) { results.success = false; results.error = error.message; process.exitCode = 1; console.error(JSON.stringify({ success: false, error: error.message })); }
finally { await closeAll(); results.finishedAt = new Date().toISOString(); await writeFile(process.env.LOAD_REPORT_PATH ?? "/tmp/pulbase-beta-load.json", JSON.stringify(results, null, 2)); }
