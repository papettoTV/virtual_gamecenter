import { env, exports } from "cloudflare:workers";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { handlePlatformRequest, getPlayerConnectionIdentity } from "../../src/worker/platform";
import { registerGoogleAccount } from "../../src/worker/google-auth";
import { migrateTestDatabase } from "../migrate-test-database";

beforeAll(migrateTestDatabase);
const sockets: WebSocket[] = [];
afterEach(() => { for (const socket of sockets.splice(0)) socket.close(); vi.restoreAllMocks(); });

it.each(["permanent", "transient", "always-transient", "overloaded", "directory"])("finishes logout safely on %s revocation failure", async mode => {
  const bootstrap = await exports.default.fetch("http://localhost/api/platform/bootstrap");
  const { playerId } = await bootstrap.json<{ playerId: string }>();
  const cookie = bootstrap.headers.get("set-cookie")!.split(";", 1)[0]!;
  await registerGoogleAccount(env.DB, { playerId, token: cookie.split("=")[1]!, secureCookie: false }, { sub: crypto.randomUUID(), name: "RPC test" });
  const cabinets = [crypto.randomUUID(), crypto.randomUUID()];
  for (const cabinet of cabinets) await env.DB.prepare("INSERT INTO player_cabinets (player_id, cabinet_id) VALUES (?, ?)").bind(playerId, cabinet).run();
  const calls = [0, 0];
  const ids = cabinets.map(name => env.CABINET_ROOMS.idFromName(name));
  const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
  const rooms = {
    idFromName: (name: string) => env.CABINET_ROOMS.idFromName(name),
    get: (id: DurableObjectId) => ({
      revokeSession: async () => {
        const index = ids.findIndex(candidate => candidate.equals(id));
        calls[index]! += 1;
        if (index !== 0) return;
        if (mode === "transient" && calls[index] === 1) throw Error(`Network connection lost. ${cookie}`);
        if (mode === "always-transient") throw Error(`Network connection lost. ${cookie}`);
        if (mode === "permanent") throw Error(`private ${cookie}`);
        if (mode === "overloaded") throw Object.assign(Error(`private ${cookie}`), { overloaded: true, retryable: true });
      },
    }),
  };
  const database = mode !== "directory" ? env.DB : new Proxy(env.DB, {
    get(target, key) {
      if (key === "prepare") return (query: string) => query.startsWith("SELECT cabinet_id FROM player_cabinets")
        ? { bind: () => ({ all: async () => { throw Error(`private ${cookie}`); } }) } : target.prepare(query);
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const response = await handlePlatformRequest(new Request("http://localhost/api/platform/auth/logout", { method: "POST", headers: { Cookie: cookie } }), database, {}, rooms);
  expect(response?.status).toBe(200);
  const result = await response!.json<{ playerId: string; accountRegistered: boolean }>();
  expect(result.accountRegistered).toBe(false);
  expect(result.playerId).not.toBe(playerId);
  const guestCookie = response!.headers.get("set-cookie")!.split(";", 1)[0]!;
  expect(await getPlayerConnectionIdentity(new Request("http://localhost/", { headers: { Cookie: cookie } }), env.DB)).toBeNull();
  expect(await getPlayerConnectionIdentity(new Request("http://localhost/", { headers: { Cookie: guestCookie } }), env.DB)).toMatchObject({ playerId: result.playerId });
  expect(calls).toEqual(mode === "directory" ? [0, 0] : mode === "transient" ? [2, 1] : mode === "always-transient" ? [3, 1] : [1, 1]);
  expect(JSON.stringify(warning.mock.calls)).not.toContain(cookie);
  if (mode === "transient") expect(warning.mock.calls.map(call => call[0])).toEqual(["session_revocation_retry"]);
  else if (mode === "always-transient") expect(warning.mock.calls.map(call => call[0])).toEqual(["session_revocation_retry", "session_revocation_retry", "session_revocation_incomplete"]);
  else expect(warning.mock.calls.map(call => call[0])).toEqual(["session_revocation_incomplete"]);
});

it("rejects the old socket after an RPC failure while anonymous spectators continue", async () => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const bootstrap = await exports.default.fetch("http://localhost/api/platform/bootstrap");
  const { playerId } = await bootstrap.json<{ playerId: string }>();
  const cookie = bootstrap.headers.get("set-cookie")!.split(";", 1)[0]!;
  await registerGoogleAccount(env.DB, { playerId, token: cookie.split("=")[1]!, secureCookie: false }, { sub: crypto.randomUUID(), name: "Fallback test" });
  const cabinet = crypto.randomUUID();
  async function connect(sessionCookie: string) {
    const response = await exports.default.fetch(`http://localhost/api/cabinets/${cabinet}/ws?gameId=graze-duel`, { headers: { Upgrade: "websocket", Cookie: sessionCookie } });
    const socket = response.webSocket!; socket.accept(); sockets.push(socket);
    const messages: Array<{ type: string; sentAt?: number }> = [];
    socket.addEventListener("message", event => { messages.push(JSON.parse(String(event.data))); });
    return { socket, messages };
  }
  const old = await connect(cookie);
  const viewer = await connect("");
  const response = await handlePlatformRequest(new Request("http://localhost/api/platform/auth/logout", { method: "POST", headers: { Cookie: cookie } }), env.DB, {}, {
    idFromName: name => env.CABINET_ROOMS.idFromName(name),
    get: () => ({ revokeSession: async () => { throw Error("permanent unavailable"); } }),
  });
  expect(response?.status).toBe(200);
  const closed = new Promise<number>((resolve, reject) => {
    const timer = setTimeout(() => reject(Error("Old socket stayed authorized")), 3000);
    old.socket.addEventListener("close", event => { clearTimeout(timer); resolve(event.code); }, { once: true });
  });
  old.socket.send(JSON.stringify({ type: "clockPing", sentAt: 1 }));
  expect(await closed).toBe(1008);
  expect(old.messages.some(message => message.type === "clockPong")).toBe(false);
  viewer.socket.send(JSON.stringify({ type: "clockPing", sentAt: 2 }));
  await expect.poll(() => viewer.messages.some(message => message.type === "clockPong" && message.sentAt === 2)).toBe(true);
});
