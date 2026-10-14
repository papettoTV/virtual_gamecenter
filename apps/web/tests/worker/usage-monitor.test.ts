import { afterEach, describe, expect, it, vi } from "vitest";
import { collectUsage, parseUsage, recordUsage, usageQuery } from "../../src/worker/usage-monitor";

const accountId = "60e5472a284dc71bbafbbfac8aa2a940";
const now = Date.parse("2026-10-14T01:15:00Z");
function fixture() {
  return { data: { viewer: { accounts: [{
    workersInvocationsAdaptive: [{ sum: { requests: 80_000 } }],
    pagesFunctionsInvocationsAdaptiveGroups: [{ sum: { requests: 0 } }],
    d1AnalyticsAdaptiveGroups: [{ sum: { rowsRead: 1_000, rowsWritten: 100 } }],
    d1StorageAdaptiveGroups: [{ dimensions: { databaseId: "first" }, max: { databaseSizeBytes: 100 } }, { dimensions: { databaseId: "second" }, max: { databaseSizeBytes: 200 } }],
    durableObjectsInvocationsAdaptiveGroups: [{ dimensions: { type: "http" }, sum: { requests: 10 } }, { dimensions: { type: "hibernation" }, sum: { requests: 200 } }],
    durableObjectsPeriodicGroups: [{ sum: { duration: 1, inboundWebsocketMsgCount: 40, rowsRead: 1, rowsWritten: 2 } }],
    durableObjectsSqlStorageGroups: [{ dimensions: { namespaceId: "first" }, max: { storedBytes: 100 } }],
  }] } }, errors: null };
}
afterEach(() => vi.restoreAllMocks());

describe("account usage monitoring", () => {
  it("queries UTC midnight rather than a rolling day and does not filter out other projects", () => {
    const query = usageQuery(accountId, now);
    expect(query).toContain("2026-10-14T00:00:00.000Z");
    expect(query).not.toContain("scriptName:");
    expect(query).toContain("2026-10-13T01:15:00.000Z");
    expect(() => usageQuery('bad"account', now)).toThrow();
  });
  it("sums storage peaks by unique resource, keeps raw events separate from the 20:1 estimate", () => {
    const snapshot = parseUsage(fixture(), now);
    expect(snapshot.values).toEqual([80_000, 1000, 100, 300, 250, 1, 1, 2, 100]);
    expect(snapshot.estimatedDoBillableRequests).toBe(22);
    expect(snapshot.highestPercent).toBe(80);
    expect(snapshot.day).toBe("2026-10-14");
  });
  it("does not turn missing metrics or partial API errors into zero usage", () => {
    expect(() => parseUsage({ ...fixture(), errors: [{ message: "private failure" }] }, now)).toThrow();
    const missing = fixture();
    Reflect.deleteProperty(missing.data.viewer.accounts[0]!, "d1AnalyticsAdaptiveGroups");
    expect(() => parseUsage(missing, now)).toThrow();
    const invalid = fixture(); invalid.data.viewer.accounts[0]!.workersInvocationsAdaptive[0]!.sum.requests = -1;
    expect(() => parseUsage(invalid, now)).toThrow();
  });
  it("includes Pages Functions in the shared Workers free-quota warning", () => {
    const result = fixture(); result.data.viewer.accounts[0]!.pagesFunctionsInvocationsAdaptiveGroups[0]!.sum.requests = 15_000;
    const snapshot = parseUsage(result, now);
    expect(snapshot.values[0]).toBe(95_000);
    expect(snapshot.highestPercent).toBe(95);
  });
  it("rejects duplicate storage groups and possible response truncation", () => {
    const duplicate = fixture(); duplicate.data.viewer.accounts[0]!.d1StorageAdaptiveGroups[1]!.dimensions.databaseId = "first";
    expect(() => parseUsage(duplicate, now)).toThrow();
    const truncated = fixture(); truncated.data.viewer.accounts[0]!.workersInvocationsAdaptive.push({ sum: { requests: 1 } });
    expect(() => parseUsage(truncated, now)).toThrow();
  });
  it("publishes a bounded snapshot without player identifiers or tokens", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json(fixture()));
    const writeDataPoint = vi.fn();
    await recordUsage(accountId, "test-token", { writeDataPoint }, now, fetcher);
    expect(fetcher.mock.calls[0]![0]).toBe("https://api.cloudflare.com/client/v4/graphql");
    expect(fetcher.mock.calls[0]![1]?.redirect).toBe("manual");
    expect(writeDataPoint.mock.calls[0]![0].doubles[9]).toBe(80);
    expect(JSON.stringify(writeDataPoint.mock.calls)).not.toContain("test-token");
  });
  it("records collection failure rather than a healthy zero and never logs API error details", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const writeDataPoint = vi.fn();
    await recordUsage(accountId, "test-token", { writeDataPoint }, now, async () => { throw new Error("private-token-data"); });
    expect(writeDataPoint.mock.calls[0]![0].blobs[1]).toBe("error");
    expect(writeDataPoint.mock.calls[0]![0].doubles[9]).toBe(-1);
    expect(log).toHaveBeenCalledWith("usage_collection_failed");
  });
  it("rejects oversized responses and sanitizes HTTP failures", async () => {
    await expect(collectUsage(accountId, "test-token", now, async () => new Response("x".repeat(256 * 1024 + 1)))).rejects.toThrow("usage_collection_failed");
    await expect(collectUsage(accountId, "test-token", now, async () => new Response("secret", { status: 403 }))).rejects.toThrow("usage_collection_failed");
    await expect(collectUsage(accountId, "", now)).rejects.toThrow("usage_missing_token");
  });
  it("rejects redirects without forwarding the metrics token to another destination", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(null, { status: 302, headers: { Location: "https://example.com" } }));
    await expect(collectUsage(accountId, "test-token", now, fetcher)).rejects.toThrow("usage_collection_failed");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]![1]?.redirect).toBe("manual");
  });
});
