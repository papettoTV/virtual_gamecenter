import { env } from "cloudflare:workers";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import worker from "../../src/worker/index";
import { recordStartSloCoverage, settleStartAttempts } from "../../src/worker/start-slo";
import { runRetention } from "../../src/worker/data-lifecycle";

vi.mock("../../src/worker/start-slo", async original => ({
  ...await original<typeof import("../../src/worker/start-slo")>(), recordStartSloCoverage: vi.fn(async () => {}), settleStartAttempts: vi.fn(async () => {}),
}));
vi.mock("../../src/worker/data-lifecycle", async original => ({
  ...await original<typeof import("../../src/worker/data-lifecycle")>(), runRetention: vi.fn(async () => {}),
}));
beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.clearAllMocks());
const event = (cron: string): ScheduledController => ({ cron, scheduledTime: Date.now(), noRetry() {} });
const config = { ...env, APP_ENV: "staging" as const, RECOVERY_CONTROL: undefined, USAGE_MONITOR_ENABLED: "false" as const };
function context() {
  const pending: Promise<unknown>[] = [];
  return { pending, waitUntil(promise: Promise<unknown>) { pending.push(promise); void promise.catch(() => {}); } };
}

it("uses the existing quarter-hour Cron without requiring the Analytics Engine monitor", async () => {
  const ctx = context(), scheduled = event("0,15,30,45 * * * *");
  await worker.scheduled(scheduled, config, ctx);
  await Promise.all(ctx.pending);
  const calls = vi.mocked(recordStartSloCoverage).mock.calls;
  expect(calls.length).toBe(1);
  expect(calls[0]![0] === env.DB).toBe(true);
  expect(calls[0]![1]).toBe(scheduled.scheduledTime);
  expect(vi.mocked(settleStartAttempts).mock.calls.length).toBe(0);
});

it("does not block privacy retention when SLO housekeeping fails and still reports the failure", async () => {
  vi.mocked(settleStartAttempts).mockRejectedValueOnce(Error("synthetic SLO failure"));
  const ctx = context();
  await worker.scheduled(event("0 * * * *"), config, ctx);
  await expect(Promise.all(ctx.pending)).rejects.toThrow("start_slo_maintenance_failed");
  expect(vi.mocked(runRetention).mock.calls.length).toBe(1);
});

it("never enables staging SLO coverage in production", async () => {
  const ctx = context();
  await worker.scheduled(event("0,15,30,45 * * * *"), { ...config, APP_ENV: "production" }, ctx);
  await Promise.all(ctx.pending);
  expect(vi.mocked(recordStartSloCoverage).mock.calls.length).toBe(0);
});
