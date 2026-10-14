import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../../src/worker/index";
import { runRetention } from "../../src/worker/data-lifecycle";

vi.mock("../../src/worker/data-lifecycle", () => ({ handleDataLifecycleRequest: vi.fn(), runRetention: vi.fn(async () => {}) }));
beforeEach(() => vi.clearAllMocks());

async function scheduled(cron: string, time: string) {
  const pending: Promise<unknown>[] = [];
  const context = { waitUntil(promise: Promise<unknown>) { pending.push(promise); } };
  await worker.scheduled({ cron, scheduledTime: Date.parse(time), noRetry() {} }, { ...env, USAGE_MONITOR_ENABLED: "false" }, context);
  await Promise.all(pending);
}

describe("scheduled maintenance routing", () => {
  it("never runs retention from the monitoring Cron, including the hourly boundary", async () => {
    for (const minute of ["00", "15", "30", "45"]) await scheduled("0,15,30,45 * * * *", `2026-10-14T00:${minute}:00Z`);
    expect(runRetention).not.toHaveBeenCalled();
  });
  it("preserves the production and local hourly schedule", async () => {
    await scheduled("0 * * * *", "2026-10-14T01:00:00Z");
    expect(runRetention).toHaveBeenCalledTimes(1);
  });
  it("does not execute maintenance for unknown Cron patterns", async () => {
    await scheduled("unknown", "2026-10-14T01:00:00Z");
    expect(runRetention).not.toHaveBeenCalled();
  });
});
