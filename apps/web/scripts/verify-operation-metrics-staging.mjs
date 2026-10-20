import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

const origin = "https://develop.virtual-gamecenter.pages.dev";

export function operationVerificationTarget(args) {
  if (args.join(" ") !== "--environment staging") throw Error("staging_verification_only");
  return origin;
}

async function main() {
  operationVerificationTarget(process.argv.slice(2));
  process.loadEnvFile(".dev.vars");
  const username = process.env.PULBASE_CHECK_USERNAME, password = process.env.PULBASE_CHECK_PASSWORD;
  if (!username || !password) throw Error("check_credentials_required");
  const authorization = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
  const cookies = new Map();
  async function api(path, method = "GET", body) {
    const response = await fetch(`${origin}${path}`, { method, redirect: "manual", signal: AbortSignal.timeout(10000),
      headers: { Authorization: authorization, Origin: origin, Cookie: [...cookies].map(([key, value]) => `${key}=${value}`).join("; "), "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    for (const header of response.headers.getSetCookie()) {
      const item = header.split(";", 1)[0], split = item.indexOf("=");
      if (/max-age=0/i.test(header)) cookies.delete(item.slice(0, split));
      else cookies.set(item.slice(0, split), item.slice(split + 1));
    }
    return response;
  }
  const bootstrap = await api("/api/platform/bootstrap");
  assert.equal(bootstrap.status, 200);
  const initial = await bootstrap.json(); assert.equal(initial.accountRegistered, false);
  assert.equal((await api("/api/platform/welcome-credit", "POST")).status, 200);
  const report = { environment: "staging", loadTest: false, games: [], oauth: "not_run", dailyRefilled: 0 };
  const { default: WebSocket } = await import("ws");
  async function connect(cabinet, game, watch) {
    const socket = new WebSocket(`${origin.replace("https:", "wss:")}/api/cabinets/${cabinet}/ws?gameId=${game}`, {
      origin, handshakeTimeout: 10000, followRedirects: false,
      headers: { Authorization: authorization, ...(watch ? {} : { Cookie: [...cookies].map(([key, value]) => `${key}=${value}`).join("; ") }) },
    });
    const messages = [];
    socket.on("message", value => messages.push(JSON.parse(String(value)))); socket.on("error", () => {});
    await new Promise((resolve, reject) => {
      socket.once("open", resolve); socket.once("error", () => reject(Error("socket_failed")));
      socket.once("unexpected-response", (_request, response) => { response.resume(); reject(Error("socket_rejected")); });
    }).catch(error => { socket.terminate(); throw error; });
    async function message(type) {
      const deadline = Date.now() + 10000;
      while (!messages.some(item => item.type === type)) {
        if (Date.now() > deadline || socket.readyState !== WebSocket.OPEN) throw Error("message_timeout");
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      return messages.splice(messages.findIndex(item => item.type === type), 1)[0];
    }
    const send = value => socket.send(JSON.stringify(value));
    try {
      await message("connected");
      send({ type: "joinCabinet", gameId: game, watch }); await message("joinedCabinet");
      return { socket, message, send };
    } catch (error) { socket.terminate(); throw error; }
  }
  for (const game of ["graze-duel", "dot-wave", "deep-sea-salvage"]) {
    const cabinet = crypto.randomUUID();
    const clients = [];
    let reservationId;
    try {
      const host = await connect(cabinet, game, false); clients.push(host);
      const viewer = await connect(cabinet, game, true); clients.push(viewer);
      const reservation = await api("/api/platform/credit-reservations", "POST", { cabinetId: cabinet, gameId: game, purpose: "solo" });
      assert.equal(reservation.status, 200); ({ reservationId } = await reservation.json());
      assert.equal((await api(`/api/platform/credit-reservations/${reservationId}/capture`, "POST")).status, 200);
      host.send({ type: "startSolo", reservationId }); await host.message("soloStarted");
      host.send({ type: "gameKeyframe", seq: 1, snapshot: { gameId: game, version: 1, operationVerification: true } });
      assert.equal((await viewer.message("viewerKeyframe")).snapshot.operationVerification, true);
      host.send({ type: "stopSolo" }); host.send({ type: "clockPing", sentAt: 1 }); await host.message("clockPong");
      host.send({ type: "startSolo", reservationId }); await host.message("error");
      host.send({ type: "leaveCabinet" }); await viewer.message("playerLeft");
      report.games.push({ game, started: true, anonymousSpectating: true, reusedCreditRejected: true });
    } finally {
      for (const client of clients) if (client.socket.readyState === WebSocket.OPEN) { client.send({ type: "leaveCabinet" }); client.socket.close(); }
      if (reservationId) await api(`/api/platform/credit-reservations/${reservationId}/release`, "POST");
      await Promise.all(clients.map(client => new Promise(resolve => {
        if (client.socket.readyState === WebSocket.CLOSED) return resolve();
        const timer = setTimeout(() => { client.socket.terminate(); resolve(); }, 3000);
        client.socket.once("close", () => { clearTimeout(timer); resolve(); });
      })));
    }
  }
  const credits = await (await api("/api/platform/credits")).json();
  assert.equal(credits.creditPolicy.refilledAmount, 1); report.dailyRefilled = 1;
  await api("/api/platform/consents", "POST", { termsVersion: initial.consent.termsVersion, privacyVersion: initial.consent.privacyVersion });
  const auth = await api("/api/platform/auth/google/start?returnTo=%2F"); assert.equal(auth.status, 302);
  const provider = new URL(auth.headers.get("Location")); assert.equal(provider.origin, "https://accounts.google.com");
  const callback = await api(`/api/platform/auth/google/callback?state=${encodeURIComponent(provider.searchParams.get("state"))}&error=access_denied`);
  assert.equal(callback.status, 302); assert.equal(new URL(callback.headers.get("Location")).searchParams.get("reason"), "cancelled");
  report.oauth = "valid_state_cancelled_no_google_request";
  console.log(JSON.stringify({ ...report, completedAt: new Date().toISOString() }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(() => {
  console.error("operation_staging_verification_failed; details suppressed"); process.exitCode = 1;
});
