import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { parseTokenOutput, tokenCommandOptions } from "./observability-policy.mjs";

export function startSloVerificationTarget(args) {
  if (args.join(" ") !== "--environment staging") throw Error("staging_verification_only");
  return "https://develop.virtual-gamecenter.pages.dev";
}

async function main() {
  const origin = startSloVerificationTarget(process.argv.slice(2));
  process.loadEnvFile(".dev.vars");
  const authorization = `Basic ${Buffer.from(`${process.env.PULBASE_CHECK_USERNAME}:${process.env.PULBASE_CHECK_PASSWORD}`).toString("base64")}`;
  if (!process.env.PULBASE_CHECK_USERNAME || !process.env.PULBASE_CHECK_PASSWORD) throw Error("check_credentials_required");
  const { experimental_readRawConfig } = await import("wrangler");
  const { rawConfig } = experimental_readRawConfig({ config: "wrangler.jsonc" });
  const target = rawConfig.env?.staging;
  if (target?.name !== "pulbase-staging" || target.d1_databases?.[0]?.database_name !== "pulbase-staging") throw Error("staging_database_required");
  const token = parseTokenOutput(execFileSync(process.execPath, ["node_modules/wrangler/bin/wrangler.js", "auth", "token", "--json"], tokenCommandOptions()));
  const { default: WebSocket } = await import("ws");
  const sockets = [], attempts = [];
  async function audit(id) {
    assert.match(id, /^[a-f0-9-]{36}$/);
    const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/60e5472a284dc71bbafbbfac8aa2a940/d1/database/${target.d1_databases[0].database_id}/query`, {
      method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ sql: "SELECT allowed_ms, expected, receipt_one, receipt_two, outcome, deadline_ms FROM start_slo_attempts WHERE reservation_id = ?", params: [id] }),
      redirect: "error", signal: AbortSignal.timeout(10000),
    });
    const payload = await response.json();
    if (!response.ok || !payload.success) throw Error("staging_audit_failed");
    return payload.result[0].results[0];
  }
  async function player() {
    const cookies = new Map();
    const api = async (path, body) => {
      const response = await fetch(origin + "/api/platform/" + path, { method: body ? "POST" : "GET", redirect: "error", signal: AbortSignal.timeout(10000),
        headers: { Authorization: authorization, Origin: origin, Cookie: [...cookies].map(([key, value]) => `${key}=${value}`).join("; "), "Content-Type": "application/json" },
        ...(body ? { body: JSON.stringify(body) } : {}) });
      for (const header of response.headers.getSetCookie()) {
        const item = header.split(";", 1)[0], split = item.indexOf("=");
        cookies.set(item.slice(0, split), item.slice(split + 1));
      }
      assert.equal(response.status, 200);
      return response.json();
    };
    await api("bootstrap"); await api("welcome-credit", {});
    return { api, cookie: () => [...cookies].map(([key, value]) => `${key}=${value}`).join("; ") };
  }
  async function connect(cabinet, game, owner, autoAck = true) {
    const socket = new WebSocket(origin.replace("https:", "wss:") + `/api/cabinets/${cabinet}/ws?gameId=${game}`, {
      origin, followRedirects: false, handshakeTimeout: 10000, headers: { Authorization: authorization, ...(owner ? { Cookie: owner.cookie() } : {}) } });
    sockets.push(socket);
    const messages = [];
    socket.on("message", bytes => {
      const message = JSON.parse(String(bytes)); messages.push(message);
      if (autoAck && message.startReceipt) socket.send(JSON.stringify({ type: "startReceipt", ...message.startReceipt }));
    });
    socket.on("error", () => {});
    await new Promise((resolve, reject) => { socket.once("open", resolve); socket.once("error", reject); socket.once("unexpected-response", (_request, response) => { response.resume(); reject(Error("handshake_rejected")); }); });
    async function next(type) {
      const deadline = Date.now() + 10000;
      while (!messages.some(message => message.type === type)) {
        if (Date.now() > deadline || socket.readyState !== WebSocket.OPEN) throw Error("message_timeout");
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      return messages.splice(messages.findIndex(message => message.type === type), 1)[0];
    }
    const send = message => socket.send(JSON.stringify(message));
    await next("connected"); send({ type: "joinCabinet", gameId: game, watch: !owner }); await next("joinedCabinet");
    return { socket, next, send };
  }
  async function reserve(owner, cabinet, game, purpose = "solo") {
    const { reservationId } = await owner.api("credit-reservations", { cabinetId: cabinet, gameId: game, purpose });
    return reservationId;
  }
  async function capture(owner, id) { assert.equal((await owner.api("credit-reservations/" + id + "/capture", {})).status, "captured"); }
  async function finished(id, outcome) {
    for (let check = 0; check < 5; check++) {
      const row = await audit(id);
      if (row?.outcome === outcome) return row;
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    throw Error("slo_outcome_mismatch");
  }
  try {
    const owner = await player();
    for (const game of ["graze-duel", "dot-wave", "deep-sea-salvage"]) {
      const cabinet = crypto.randomUUID(), host = await connect(cabinet, game, owner), viewer = await connect(cabinet, game);
      const id = await reserve(owner, cabinet, game); await capture(owner, id); await capture(owner, id);
      host.send({ type: "startSolo", reservationId: id });
      const permission = await host.next("soloStarted"); assert.equal(permission.startReceipt.attemptId, id);
      const row = await finished(id, "success"); assert.equal(row.expected, 1);
      host.send({ type: "gameKeyframe", seq: 1, snapshot: { gameId: game, version: 1, startSloVerification: true } });
      assert.equal((await viewer.next("viewerKeyframe")).snapshot.startSloVerification, true);
      host.send({ type: "leaveCabinet" }); await viewer.next("playerLeft"); host.socket.close(); viewer.socket.close();
      attempts.push({ game, scenario: "solo_receipt_and_spectating", outcome: "success" });
    }
    for (const scenario of ["request_without_start_message", "permission_without_receipt"]) {
      const cabinet = crypto.randomUUID(), host = await connect(cabinet, "graze-duel", owner, false);
      const id = await reserve(owner, cabinet, "graze-duel"); await capture(owner, id);
      let permission;
      if (scenario === "permission_without_receipt") {
        host.send({ type: "startSolo", reservationId: id }); permission = await host.next("soloStarted");
        const viewer = await connect(cabinet, "graze-duel");
        viewer.send({ type: "startReceipt", ...permission.startReceipt }); viewer.send({ type: "clockPing", sentAt: 1 }); await viewer.next("clockPong"); viewer.socket.close();
      }
      const row = await audit(id);
      assert.equal(row.receipt_one, 0); assert.equal(row.outcome, "pending");
      await new Promise(resolve => setTimeout(resolve, Math.max(0, row.deadline_ms - Date.now() + 150)));
      if (permission) { host.send({ type: "startReceipt", ...permission.startReceipt }); host.send({ type: "clockPing", sentAt: 2 }); await host.next("clockPong"); }
      const after = await audit(id);
      assert.equal(after.receipt_one, 0); assert.ok(after.deadline_ms < Date.now());
      attempts.push({ game: "graze-duel", scenario, expired: true, received: false });
      host.send({ type: "leaveCabinet" }); host.socket.close();
      await owner.api("credit-reservations/" + id + "/release", {});
    }
    const guest = await player(), cabinet = crypto.randomUUID();
    const host = await connect(cabinet, "dot-wave", owner), challenger = await connect(cabinet, "dot-wave", guest, false);
    const solo = await reserve(owner, cabinet, "dot-wave"); await capture(owner, solo);
    host.send({ type: "startSolo", reservationId: solo }); await host.next("soloStarted"); await finished(solo, "success");
    const challenge = await reserve(guest, cabinet, "dot-wave", "challenge");
    challenger.send({ type: "requestChallenge", reservationId: challenge }); await host.next("challengeReceived");
    host.send({ type: "respondChallenge", accept: true });
    const accepted = await host.next("challengeAccepted"); await challenger.next("challengeAccepted");
    await capture(guest, challenge);
    host.send({ type: "versusReady", matchId: accepted.matchId }); challenger.send({ type: "versusReady", matchId: accepted.matchId });
    await host.next("versusCountdown"); const countdown = await challenger.next("versusCountdown");
    let partial;
    for (let check = 0; check < 5; check++) {
      partial = await audit(challenge);
      if (partial.receipt_one === 1) break;
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    assert.equal(partial.receipt_one, 1); assert.equal(partial.receipt_two, 0); assert.equal(partial.outcome, "pending");
    challenger.send({ type: "startReceipt", ...countdown.startReceipt }); challenger.send({ type: "startReceipt", ...countdown.startReceipt });
    const complete = await finished(challenge, "success"); assert.equal(complete.receipt_two, 1);
    attempts.push({ game: "dot-wave", scenario: "versus_both_receipts_duplicate_safe", outcome: "success" });
    console.log(JSON.stringify({ environment: "staging", loadTest: false, existingPlayersChanged: false, attempts, completedAt: new Date().toISOString() }));
  } finally {
    await Promise.all(sockets.map(socket => new Promise(resolve => {
      if (socket.readyState === WebSocket.CLOSED) return resolve();
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "leaveCabinet" }));
      const timer = setTimeout(() => { socket.terminate(); resolve(); }, 2000);
      socket.once("close", () => { clearTimeout(timer); resolve(); }); socket.close();
    })));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(() => {
  console.error("Start SLO staging verification failed; credentials and user details suppressed."); process.exitCode = 1;
});
