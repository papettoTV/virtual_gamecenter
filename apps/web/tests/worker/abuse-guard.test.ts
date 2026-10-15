import { env, exports } from "cloudflare:workers";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { migrateTestDatabase } from "../migrate-test-database";
import { GLOBAL_CABINET_LIMIT, GLOBAL_CONNECTION_LIMIT, GLOBAL_IP_CONNECTION_LIMIT } from "../../src/worker/abuse-guard";
import { hashIdentifier } from "../../src/worker/identity-hash";

beforeAll(migrateTestDatabase);
afterEach(() => vi.restoreAllMocks());
afterAll(async () => { await new Promise(resolve => setTimeout(resolve, 200)); });
const key = (index: number) => index.toString(16).padStart(64, "0");
const guard = () => env.ABUSE_GUARDS.getByName(`test:${crypto.randomUUID()}`);

describe("distributed abuse guard", () => {
  it("shares actor budgets across request sources and persists decisions", async () => {
    const name = `test:${crypto.randomUUID()}`;
    const first = env.ABUSE_GUARDS.getByName(name);
    const results = await Promise.all(Array.from({ length: 12 }, () => first.consume("bootstrap", key(1), key(1), false)));
    expect(results.filter(result => result.success)).toHaveLength(10);
    expect((await env.ABUSE_GUARDS.getByName(name).consume("bootstrap", key(1), key(1), false)).success).toBe(false);
    expect((await first.consume("bootstrap", key(2), key(2), false)).success).toBe(true);
  });
  it("bounds distributed anonymous traffic with the shared shard budget", async () => {
    const instance = guard();
    const results = await Promise.all(Array.from({ length: 64 }, (_, index) => instance.consume("bootstrap", key(index + 1))));
    expect(results.filter(result => result.success)).toHaveLength(60);
    expect(results.filter(result => !result.success).every(result => result.retryAfter > 0)).toBe(true);
  });
  it("shares a verified player budget independently of IP and does not double-charge the shard", async () => {
    const instance = guard();
    for (let index = 0; index < 10; index += 1) expect((await instance.consume("auth", key(999), key(999), false)).success).toBe(true);
    expect((await instance.consume("auth", key(999), key(999), false)).success).toBe(false);
    expect((await instance.consume("auth", key(1))).success).toBe(true);
  });
  it("limits one address and player across different cabinets and releases capacity idempotently", async () => {
    const instance = guard();
    const ids: [string, string][] = [];
    for (let index = 0; index < 8; index += 1) {
      const id = crypto.randomUUID(), cabinet = crypto.randomUUID(); ids.push([id, cabinet]);
      expect((await instance.admit(id, cabinet, key(index + 1), key(999))).success).toBe(true);
    }
    expect((await instance.admit(crypto.randomUUID(), crypto.randomUUID(), key(20), key(999))).success).toBe(false);
    await instance.release(...ids[0]!); await instance.release(...ids[0]!);
    expect((await instance.admit(crypto.randomUUID(), crypto.randomUUID(), key(20), key(999))).success).toBe(true);
    const ipOnly = guard();
    for (let index = 0; index < GLOBAL_IP_CONNECTION_LIMIT; index += 1) expect((await ipOnly.admit(crypto.randomUUID(), crypto.randomUUID(), key(1))).success).toBe(true);
    expect((await ipOnly.admit(crypto.randomUUID(), crypto.randomUUID(), key(1))).success).toBe(false);
  });
  it("atomically caps all cabinet connections under parallel distributed admission", async () => {
    const instance = guard(); const cabinet = crypto.randomUUID();
    const decisions = await Promise.all(Array.from({ length: GLOBAL_CONNECTION_LIMIT + 4 }, (_, index) => instance.admit(crypto.randomUUID(), cabinet, key(index + 1))));
    expect(decisions.filter(result => result.success)).toHaveLength(GLOBAL_CONNECTION_LIMIT);
  });
  it("caps distinct cabinet allocation even when connections are immediately released", async () => {
    const instance = guard();
    const admissions = Array.from({ length: GLOBAL_CABINET_LIMIT }, (_, index) => ({ id: crypto.randomUUID(), cabinet: crypto.randomUUID(), ip: key(index + 1) }));
    const decisions = await Promise.all(admissions.map(item => instance.admit(item.id, item.cabinet, item.ip)));
    expect(decisions.every(result => result.success)).toBe(true);
    await Promise.all(admissions.map(item => instance.release(item.id, item.cabinet)));
    expect((await instance.admit(crypto.randomUUID(), crypto.randomUUID(), key(999))).success).toBe(false);
  }, 15_000);
  it("rejects invalid internal keys and preserves the health bypass", async () => {
    expect((await guard().consume("read", "raw-ip")).success).toBe(false);
    expect((await exports.default.fetch("http://localhost/api/health", { headers: { "CF-Connecting-IP": "192.0.2.9" } })).status).toBe(200);
  });
  it("recovers expired budgets and abandoned handshakes without dropping fresh admissions", async () => {
    const instance = guard(); const clock = vi.spyOn(Date, "now"); const start = Date.now();
    clock.mockReturnValue(start);
    const old = crypto.randomUUID(), cabinet = crypto.randomUUID();
    expect((await instance.admit(old, cabinet, key(1))).success).toBe(true);
    await instance.reconcileConnections();
    expect((await instance.admit(old, crypto.randomUUID(), key(1))).success).toBe(false);
    for (let index = 0; index < 10; index += 1) await instance.consume("bootstrap", key(1), key(1), false);
    expect((await instance.consume("bootstrap", key(1), key(1), false)).success).toBe(false);
    clock.mockReturnValue(start + 120_000);
    await instance.reconcileConnections();
    expect((await instance.admit(old, crypto.randomUUID(), key(1))).success).toBe(true);
    expect((await instance.consume("bootstrap", key(1), key(1), false)).success).toBe(true);
  });
  it("keeps the daily benefit ceiling after a minute reset and recovers on the next UTC day", async () => {
    const instance = guard(); const start = Math.ceil(Date.now() / 86_400_000) * 86_400_000; const clock = vi.spyOn(Date, "now").mockReturnValue(start);
    for (let minute = 0; minute < 2; minute += 1) {
      clock.mockReturnValue(start + minute * 60_000);
      const decisions = await Promise.all(Array.from({ length: 10 }, () => instance.consume("benefit", key(1), key(1), false)));
      expect(decisions.every(result => result.success)).toBe(true);
    }
    clock.mockReturnValue(start + 120_000);
    const denied = await instance.consume("benefit", key(1), key(1), false);
    expect(denied.success).toBe(false); expect(denied.retryAfter).toBeGreaterThan(60);
    clock.mockReturnValue(start + 86_400_000);
    expect((await instance.consume("benefit", key(1), key(1), false)).success).toBe(true);
  });
  it("returns the admission immediately when player data is deleted", async () => {
    const bootstrap = await exports.default.fetch("http://localhost/api/platform/bootstrap");
    const player = await bootstrap.json<{ playerId: string }>();
    const cookie = bootstrap.headers.get("set-cookie")?.split(";", 1)[0]!;
    const cabinet = crypto.randomUUID();
    const ip = await hashIdentifier(`${env.APP_ENV}:ip:192.0.2.190`);
    const admission = env.ABUSE_GUARDS.getByName("admission");
    const response = await exports.default.fetch(`http://localhost/api/cabinets/${cabinet}/ws?gameId=deep-sea-salvage`, { headers: { Upgrade: "websocket", Cookie: cookie, "CF-Connecting-IP": "192.0.2.190" } });
    expect(response.status).toBe(101);
    response.webSocket!.accept();
    try {
      expect(await admission.admissionCount(ip)).toBe(1);
      await env.CABINET_ROOMS.getByName(cabinet).removePlayerData(player.playerId);
      expect(await admission.admissionCount(ip)).toBe(0);
    } finally { response.webSocket!.close(); }
  });
  it("enforces the all-cabinet address cap through Worker routing and ignores forged admission headers", async () => {
    const sockets: WebSocket[] = [];
    try {
      for (let index = 0; index <= GLOBAL_IP_CONNECTION_LIMIT; index += 1) {
        const cabinet = crypto.randomUUID(), forged = crypto.randomUUID();
        const response = await exports.default.fetch(`http://localhost/api/cabinets/${cabinet}/ws?gameId=deep-sea-salvage`, { headers: { Upgrade: "websocket", "CF-Connecting-IP": "192.0.2.189", "X-Pulbase-Admission": forged } });
        expect(response.status).toBe(index < GLOBAL_IP_CONNECTION_LIMIT ? 101 : 429);
        if (response.webSocket) {
          response.webSocket.accept(); sockets.push(response.webSocket);
          expect(await env.CABINET_ROOMS.getByName(cabinet).activeAdmissionIds()).not.toContain(forged);
        }
      }
    } finally {
      for (const socket of sockets) socket.close();
      const ip = await hashIdentifier(`${env.APP_ENV}:ip:192.0.2.189`);
      await vi.waitFor(async () => { expect(await env.ABUSE_GUARDS.getByName("admission").admissionCount(ip)).toBe(0); });
    }
  });
});
