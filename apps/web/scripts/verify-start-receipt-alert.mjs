import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import { startSloVerificationTarget } from "./verify-start-slo-staging.mjs";
import { parseTokenOutput, tokenCommandOptions } from "./observability-policy.mjs";

export async function verifyMissingStarts(args) {
  const normal = args.length === 3 && args[2] === "normal";
  const origin = startSloVerificationTarget(normal ? args.slice(0, 2) : args);
  process.loadEnvFile(".dev.vars");
  if (!process.env.PULBASE_CHECK_USERNAME || !process.env.PULBASE_CHECK_PASSWORD) throw Error("check_credentials_required");
  const authorization = `Basic ${Buffer.from(`${process.env.PULBASE_CHECK_USERNAME}:${process.env.PULBASE_CHECK_PASSWORD}`).toString("base64")}`;
  const token = normal ? parseTokenOutput(execFileSync(process.execPath, ["node_modules/wrangler/bin/wrangler.js", "auth", "token", "--json"], tokenCommandOptions())) : null;
  const cleanups = [], sockets = [];
  try {
    for (let index = 0; index < (normal ? 1 : 3); index++) {
      const cookies = new Map();
      const api = async (path, body) => {
        const response = await fetch(origin + "/api/platform/" + path, { method: body ? "POST" : "GET", redirect: "error", signal: AbortSignal.timeout(10000),
          headers: { Authorization: authorization, Origin: origin, Cookie: [...cookies].map(([key, value]) => `${key}=${value}`).join("; "), "Content-Type": "application/json" },
          body: body ? JSON.stringify(body) : undefined });
        for (const value of response.headers.getSetCookie()) { const part = value.split(";", 1)[0], separator = part.indexOf("="); cookies.set(part.slice(0, separator), part.slice(separator + 1)); }
        assert.equal(response.status, 200);
        return response.json();
      };
      await api("bootstrap"); await api("welcome-credit", {});
      const cabinetId = crypto.randomUUID();
      let socket, permission, joined;
      if (normal) {
        const { default: WebSocket } = await import("ws");
        socket = new WebSocket(origin.replace("https:", "wss:") + `/api/cabinets/${cabinetId}/ws?gameId=graze-duel`, {
          origin, followRedirects: false, handshakeTimeout: 10000, headers: { Authorization: authorization, Cookie: [...cookies].map(([key, value]) => `${key}=${value}`).join("; ") } });
        sockets.push(socket); socket.on("error", () => {});
        socket.on("message", bytes => {
          const message = JSON.parse(String(bytes));
          if (message.type === "soloStarted") permission = message;
          if (message.type === "joinedCabinet") joined = message;
        });
        await new Promise((resolve, reject) => { socket.once("open", resolve); socket.once("error", reject); socket.once("unexpected-response", (_request, response) => { response.resume(); reject(Error("handshake_rejected")); }); });
        socket.send(JSON.stringify({ type: "joinCabinet", gameId: "graze-duel", watch: false }));
        const until = Date.now() + 4000;
        while (!joined && Date.now() < until) await new Promise(resolve => setTimeout(resolve, 20));
        assert.ok(joined);
      }
      const { reservationId } = await api("credit-reservations", { cabinetId, gameId: "graze-duel", purpose: "solo" });
      assert.match(reservationId, /^[a-f0-9-]{36}$/);
      cleanups.push(() => api(`credit-reservations/${reservationId}/release`, {}));
      await api(`credit-reservations/${reservationId}/capture`, {});
      if (normal) {
        socket.send(JSON.stringify({ type: "startSolo", reservationId }));
        const until = Date.now() + 4000;
        while (!permission && Date.now() < until) await new Promise(resolve => setTimeout(resolve, 20));
        assert.equal(permission?.startReceipt?.attemptId, reservationId);
        socket.send(JSON.stringify({ type: "startReceipt", attemptId: reservationId, token: permission.startReceipt.token }));
        let confirmed = false;
        for (let check = 0; check < 5; check++) {
          const response = await fetch("https://api.cloudflare.com/client/v4/accounts/60e5472a284dc71bbafbbfac8aa2a940/d1/database/c49b03c7-e616-4acb-96a8-2837ff62034f/query", {
            method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, redirect: "error", signal: AbortSignal.timeout(10000),
            body: JSON.stringify({ sql: "SELECT outcome FROM start_slo_attempts WHERE reservation_id = ?", params: [reservationId] }),
          });
          const payload = await response.json();
          if (!response.ok || !payload.success) throw Error("staging_receipt_audit_failed");
          if (payload.result[0]?.results[0]?.outcome === "success") { confirmed = true; break; }
          await new Promise(resolve => setTimeout(resolve, 200));
        }
        assert.ok(confirmed);
        socket.send(JSON.stringify({ type: "leaveCabinet" })); socket.close();
      }
    }
    if (!normal) await new Promise(resolve => setTimeout(resolve, 65000));
    return { environment: "staging", accepted: normal ? 1 : 3, intentionallyMissing: normal ? 0 : 3, wsConnections: normal ? 1 : 0, finishedAt: new Date().toISOString() };
  } finally {
    for (const socket of sockets) socket.close();
    const released = await Promise.allSettled(cleanups.map(release => release()));
    if (released.some(result => result.status === "rejected")) throw Error("synthetic_reservation_cleanup_failed");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) verifyMissingStarts(process.argv.slice(2)).then(result => console.log(JSON.stringify(result))).catch(() => {
  console.error("start_receipt_verification_failed; details suppressed; do not retry without checking staging records"); process.exitCode = 1;
});
