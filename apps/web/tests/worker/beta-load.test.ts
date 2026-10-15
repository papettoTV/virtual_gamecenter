import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { IP_LIMITS, SHARD_LIMITS } from "../../src/worker/abuse-guard";
import { CABINET_IP_CONNECTION_LIMIT } from "../../src/worker/request-protection";

const key = (index: number) => index.toString(16).padStart(64, "0");
const guard = () => env.ABUSE_GUARDS.getByName(`beta-load:${crypto.randomUUID()}`);

describe("free beta shared-network capacity", () => {
  it("admits 24 different people behind one NAT across six cabinets and returns capacity", async () => {
    const instance = guard();
    const cabinets = Array.from({ length: 6 }, () => crypto.randomUUID());
    const admissions = Array.from({ length: 24 }, (_, index) => ({ id: crypto.randomUUID(), cabinet: cabinets[index % 6]!, player: key(index + 1) }));
    const decisions = await Promise.all(admissions.map(item => instance.admit(item.id, item.cabinet, key(999), item.player)));
    expect(decisions.every(decision => decision.success)).toBe(true);
    expect(await instance.admissionCount(key(999))).toBe(24);
    await Promise.all(admissions.map(item => instance.release(item.id, item.cabinet)));
    expect(await instance.admissionCount(key(999))).toBe(0);
    expect(CABINET_IP_CONNECTION_LIMIT).toBeGreaterThanOrEqual(24);
  });
  it("admits 96 people on twelve networks without exhausting global capacity", async () => {
    const instance = guard();
    const decisions = await Promise.all(Array.from({ length: 96 }, (_, index) => instance.admit(crypto.randomUUID(), crypto.randomUUID(), key(Math.floor(index / 8) + 1), key(index + 100))));
    expect(decisions.every(decision => decision.success)).toBe(true);
  });
  it("allows 24 arrivals and one minute of three-game browsing on one network", async () => {
    const instance = guard();
    const arrivals = await Promise.all(Array.from({ length: 24 }, () => instance.consume("bootstrap", key(1))));
    expect(arrivals.every(decision => decision.success)).toBe(true);
    const polls = await Promise.all(Array.from({ length: 24 * 3 * 6 }, () => instance.consume("read", key(1))));
    expect(polls.every(decision => decision.success)).toBe(true);
    expect(Math.min(IP_LIMITS.read[1], SHARD_LIMITS.read[1])).toBeGreaterThanOrEqual(24 * 3 * 6 * 60);
  });
  it("does not grant a single verified player the larger NAT allowance", async () => {
    const instance = guard();
    for (let index = 0; index < 10; index += 1) expect((await instance.consume("bootstrap", key(1), key(2), false)).success).toBe(true);
    expect((await instance.consume("bootstrap", key(1), key(2), false)).success).toBe(false);
  });
});
