import { env } from "cloudflare:workers";
import { describe, expect, it, vi } from "vitest";
import worker from "../../src/worker/index";
import { API_BODY_LIMIT, boundRequestBody, limitRequest, type ProtectionEnv } from "../../src/worker/request-protection";

describe("request protection", () => {
  it("checks real streamed bytes without Content-Length, including UTF-8 and cancellation", async () => {
    let cancelled = false;
    const stream = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode("あ".repeat(30_000))); }, cancel() { cancelled = true; } });
    const response = await boundRequestBody(new Request("https://example.test/api/test", { method: "POST", body: stream }));
    expect(response).toBeInstanceOf(Response);
    expect((response as Response).status).toBe(413);
    expect(cancelled).toBe(true);
  });
  it("preserves a body exactly at the boundary and its authentication headers", async () => {
    const body = "a".repeat(API_BODY_LIMIT);
    const bounded = await boundRequestBody(new Request("https://example.test/api/test", { method: "POST", body, headers: { Cookie: "session=test", Origin: "https://example.test" } }));
    expect(bounded).toBeInstanceOf(Request);
    expect(await (bounded as Request).text()).toBe(body);
    expect((bounded as Request).headers.get("cookie")).toBe("session=test");
  });
  it("rejects excessive declared sizes and compressed bodies before parsing", async () => {
    const cases: Array<Record<string, string>> = [{ "Content-Length": String(API_BODY_LIMIT + 1) }, { "Content-Encoding": "gzip" }];
    for (const headers of cases) {
      const response = await boundRequestBody(new Request("https://example.test/api/test", { method: "POST", body: "{}", headers }));
      expect([413, 415]).toContain((response as Response).status);
    }
  });
  it("times out stalled body streams and cancels the reader", async () => {
    vi.useFakeTimers();
    try {
      let cancelled = false;
      const pending = boundRequestBody(new Request("https://example.test/api/test", { method: "POST", body: new ReadableStream({ cancel() { cancelled = true; } }) }));
      await vi.advanceTimersByTimeAsync(5001);
      expect((await pending as Response).status).toBe(408);
      expect(cancelled).toBe(true);
    } finally { vi.useRealTimers(); }
  });
  it.each([
    ["/api/platform/bootstrap", "GET", "BOOTSTRAP_LIMITER"],
    ["/api/platform/welcome-credit", "POST", "BENEFIT_LIMITER"],
    ["/api/platform/profile", "PATCH", "API_WRITE_LIMITER"],
    ["/api/platform/auth/google/start", "GET", "AUTH_LIMITER"],
    ["/api/ranking", "GET", "API_READ_LIMITER"],
    ["/api/cabinets/example/ws", "GET", "SOCKET_LIMITER"],
  ])("throttles %s before business operations without exposing identity", async (path, method, binding) => {
    const limit = vi.fn(async () => ({ success: false }));
    const response = await limitRequest(new Request("https://example.test" + path, { method, headers: { "CF-Connecting-IP": "192.0.2.3", Cookie: "vgc_session=private-token", ...(binding === "SOCKET_LIMITER" ? { Upgrade: "websocket" } : {}) } }), { APP_ENV: "staging", [binding]: { limit } });
    expect(response?.status).toBe(429);
    expect(response?.headers.get("retry-after")).toBe("60");
    expect(JSON.stringify(limit.mock.calls)).not.toContain("192.0.2.3");
    expect(JSON.stringify(limit.mock.calls)).not.toContain("private-token");
  });
  it("requires both the address and session budgets and fails closed on limiter failure", async () => {
    const request = new Request("https://example.test/api/ranking", { headers: { Cookie: "vgc_session=token", "CF-Connecting-IP": "192.0.2.4" } });
    const limit = vi.fn().mockResolvedValueOnce({ success: true }).mockResolvedValueOnce({ success: false });
    expect((await limitRequest(request, { APP_ENV: "staging", API_READ_LIMITER: { limit } }))?.status).toBe(429);
    expect(limit).toHaveBeenCalledTimes(2);
    expect((await limitRequest(request, { APP_ENV: "staging" }))?.status).toBe(503);
    const broken: ProtectionEnv = { APP_ENV: "staging", API_READ_LIMITER: { limit: async () => { throw Error("secret"); } } };
    expect(await (await limitRequest(request, broken))?.text()).not.toContain("secret");
  });
  it("does not throttle signed webhooks, assets or cheap health checks", async () => {
    for (const path of ["/api/platform/stripe/webhook", "/assets/icon.png", "/api/health"]) expect(await limitRequest(new Request("https://example.test" + path), { APP_ENV: "staging" })).toBe(null);
  });
  it("bounds a webhook before its signature processing and leaves authentication required", async () => {
    const response = await worker.fetch(new Request("http://localhost/api/platform/stripe/webhook", { method: "POST", body: "a".repeat(256 * 1024 + 1) }), env);
    expect(response.status).toBe(413);
    const unsigned = await worker.fetch(new Request("http://localhost/api/platform/stripe/webhook", { method: "POST", body: "{}" }), env);
    expect(unsigned.ok).toBe(false);
  });
});
