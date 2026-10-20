import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import WebSocket from "ws";

const origin = "https://develop.virtual-gamecenter.pages.dev";
const sockets = [];
async function connect(cabinet, game, cookie, authorization) {
  const socket = new WebSocket(`${origin.replace("https:", "wss:")}/api/cabinets/${cabinet}/ws?gameId=${game}`, {
    headers: { Cookie: cookie, Authorization: authorization, Origin: origin }, handshakeTimeout: 10000,
  });
  sockets.push(socket);
  let code = 0;
  const messages = [];
  socket.on("message", bytes => messages.push(JSON.parse(String(bytes))));
  socket.on("close", value => { code = value; });
  socket.on("error", () => {});
  await new Promise((resolveOpen, reject) => { socket.once("open", resolveOpen); socket.once("error", () => reject(Error("socket_failed"))); });
  const wait = async (predicate, timeout = 10000) => {
    const until = Date.now() + timeout;
    while (!predicate()) { if (Date.now() > until) throw Error("verification_timeout"); await new Promise(resolveWait => setTimeout(resolveWait, 100)); }
  };
  const message = async type => { await wait(() => messages.some(item => item.type === type)); return messages.splice(messages.findIndex(item => item.type === type), 1)[0]; };
  await message("connected");
  return { socket, message, wait, code: () => code };
}

async function main() {
  if (process.argv.slice(2).join(" ") !== "--environment staging") throw Error("staging_only");
  process.env.WRANGLER_WRITE_LOGS = "false"; process.env.WRANGLER_SEND_METRICS = "false";
  process.loadEnvFile(".dev.vars");
  if (!process.env.PULBASE_CHECK_USERNAME || !process.env.PULBASE_CHECK_PASSWORD) throw Error("check_credentials_missing");
  const authorization = `Basic ${Buffer.from(`${process.env.PULBASE_CHECK_USERNAME}:${process.env.PULBASE_CHECK_PASSWORD}`).toString("base64")}`;
  async function guest() {
    const response = await fetch(`${origin}/api/platform/bootstrap`, { headers: { Authorization: authorization }, redirect: "manual", signal: AbortSignal.timeout(10000) });
    assert.equal(response.status, 200);
    const body = await response.json(); assert.equal(body.accountRegistered, false);
    const cookie = response.headers.getSetCookie().map(value => value.split(";", 1)[0]).find(value => value.startsWith("vgc_session="));
    assert.ok(cookie);
    return { playerId: body.playerId, cookie, hash: createHash("sha256").update(cookie.slice("vgc_session=".length)).digest("hex") };
  }
  const directory = await mkdtemp(join(tmpdir(), "pulbase-idle-staging-"));
  const configPath = join(directory, "wrangler.json");
  await writeFile(configPath, JSON.stringify({ name: "pulbase-idle-staging-local", account_id: "60e5472a284dc71bbafbbfac8aa2a940", compatibility_date: "2026-07-26",
    d1_databases: [{ binding: "DB", database_name: "pulbase-staging", database_id: "c49b03c7-e616-4acb-96a8-2837ff62034f", remote: true }] }), { mode: 0o600 });
  let proxy;
  try {
    const { getPlatformProxy } = await import("wrangler");
    proxy = await getPlatformProxy({ configPath, envFiles: [], persist: false, remoteBindings: true });
    for (const game of ["graze-duel", "dot-wave", "deep-sea-salvage"]) {
      const oldGuest = await guest(), validGuest = await guest(), cabinet = crypto.randomUUID();
      const old = await connect(cabinet, game, oldGuest.cookie, authorization);
      const valid = await connect(cabinet, game, validGuest.cookie, authorization);
      const viewer = await connect(cabinet, game, "", authorization);
      for (const [client, watch] of [[old, false], [valid, true], [viewer, true]]) {
        client.socket.send(JSON.stringify({ type: "joinCabinet", gameId: game, watch })); await client.message("joinedCabinet");
      }
      const started = Date.now();
      const updated = await proxy.env.DB.prepare("UPDATE player_sessions SET expires_at = '2000-01-01' WHERE token_hash = ? AND player_id = ? AND NOT EXISTS (SELECT 1 FROM players WHERE id = ? AND account_id IS NOT NULL)")
        .bind(oldGuest.hash, oldGuest.playerId, oldGuest.playerId).run();
      assert.equal(updated.meta.changes, 1);
      await old.wait(() => old.code() !== 0, 90000); assert.equal(old.code(), 1008);
      assert.equal(valid.code(), 0); assert.equal(viewer.code(), 0);
      for (const client of [valid, viewer]) { client.socket.send(JSON.stringify({ type: "clockPing", sentAt: 1 })); await client.message("clockPong"); }
      console.log(JSON.stringify({ environment: "staging", game, idleClosedMs: Date.now() - started, code: 1008, noMessagesAfterExpiry: true, validPreserved: true, anonymousPreserved: true, loadTest: false }));
      valid.socket.close(); viewer.socket.close();
    }
  } finally { for (const socket of sockets) socket.terminate(); await proxy?.dispose(); await rm(directory, { recursive: true, force: true }); }
}

main().catch(() => { console.error("staging_idle_verification_failed; details suppressed"); process.exitCode = 1; });
