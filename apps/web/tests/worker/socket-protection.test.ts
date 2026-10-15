import { env, exports } from "cloudflare:workers";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { migrateTestDatabase } from "../migrate-test-database";
import { CABINET_CONNECTION_LIMIT, CABINET_IP_CONNECTION_LIMIT, WS_MESSAGE_LIMIT } from "../../src/worker/request-protection";

beforeAll(migrateTestDatabase);
afterAll(async () => { await new Promise(resolve => setTimeout(resolve, 200)); });
const sockets: WebSocket[] = [];
afterEach(() => { for (const socket of sockets.splice(0)) socket.close(); vi.restoreAllMocks(); });
async function upgrade(cabinet: string, headers: Record<string, string> = {}) {
  const response = await exports.default.fetch(`http://localhost/api/cabinets/${cabinet}/ws?gameId=deep-sea-salvage`, { headers: { Upgrade: "websocket", ...headers } });
  if (response.webSocket) { response.webSocket.accept(); sockets.push(response.webSocket); }
  return response;
}
function closed(socket: WebSocket): Promise<number> {
  return new Promise(resolve => socket.addEventListener("close", event => resolve(event.code), { once: true }));
}

describe("WebSocket protection", () => {
  it("enforces the cabinet cap even with parallel handshakes", async () => {
    const cabinet = crypto.randomUUID();
    const responses = await Promise.all(Array.from({ length: CABINET_CONNECTION_LIMIT + 4 }, () => upgrade(cabinet)));
    expect(responses.filter(response => response.status === 101)).toHaveLength(CABINET_CONNECTION_LIMIT);
    expect(responses.filter(response => response.status === 429)).toHaveLength(4);
  });
  it("limits concurrent connections per address without blocking another address", async () => {
    const cabinet = crypto.randomUUID();
    const responses = await Promise.all(Array.from({ length: CABINET_IP_CONNECTION_LIMIT + 1 }, () => upgrade(cabinet, { "CF-Connecting-IP": "192.0.2.11" })));
    expect(responses.filter(response => response.status === 101)).toHaveLength(CABINET_IP_CONNECTION_LIMIT);
    expect(responses.filter(response => response.status === 429)).toHaveLength(1);
    expect((await upgrade(cabinet, { "CF-Connecting-IP": "192.0.2.12" })).status).toBe(101);
  });
  it("limits a player's session to four concurrent connections per cabinet", async () => {
    const bootstrap = await exports.default.fetch("http://localhost/api/platform/bootstrap");
    const cookie = bootstrap.headers.get("set-cookie")!.split(";", 1)[0]!;
    const cabinet = crypto.randomUUID();
    const responses = await Promise.all(Array.from({ length: 5 }, () => upgrade(cabinet, { Cookie: cookie })));
    expect(responses.filter(response => response.status === 101)).toHaveLength(4);
    expect(responses.filter(response => response.status === 429)).toHaveLength(1);
  });
  it("closes oversized UTF-8 payloads with 1009 and keeps another spectator connected", async () => {
    const cabinet = crypto.randomUUID();
    const offender = (await upgrade(cabinet)).webSocket!;
    const observer = (await upgrade(cabinet)).webSocket!;
    const close = closed(offender);
    offender.send("あ".repeat(Math.ceil(WS_MESSAGE_LIMIT / 3) + 1));
    expect(await close).toBe(1009);
    const reply = new Promise<string>(resolve => observer.addEventListener("message", event => { if (JSON.parse(event.data as string).type === "clockPong") resolve(event.data as string); }));
    observer.send(JSON.stringify({ type: "clockPing", sentAt: 1 }));
    expect(JSON.parse(await reply).sentAt).toBe(1);
  });
  it("closes binary messages with 1003", async () => {
    const socket = (await upgrade(crypto.randomUUID())).webSocket!;
    const close = closed(socket);
    socket.send(new Uint8Array(2));
    expect(await close).toBe(1003);
  });
  it("limits control commands and high-frequency frames before business processing", async () => {
    vi.spyOn(Date, "now").mockReturnValue(Date.now());
    for (const type of ["clockPing", "gameMotionFrame"]) {
      const cabinet = crypto.randomUUID();
      const socket = (await upgrade(cabinet)).webSocket!;
      const close = closed(socket);
      for (let index = 0; index < 130; index += 1) socket.send(JSON.stringify({ type, sentAt: index, seq: index, frame: {} }));
      expect(await close).toBe(1008);
    }
  }, 10_000);
  it("counts invalid JSON against the message budget", async () => {
    vi.spyOn(Date, "now").mockReturnValue(Date.now());
    const cabinet = crypto.randomUUID();
    const socket = (await upgrade(cabinet)).webSocket!;
    const close = closed(socket);
    for (let index = 0; index < 130; index += 1) socket.send("{");
    expect(await close).toBe(1008);
  });
});
