import { beforeAll, expect, it, vi } from "vitest";
import { env } from "cloudflare:workers";
import { handleOperatorRequest, collectOperationReport, collectMonthlyOperationReport } from "../../src/worker/operator-dashboard";
import { handlePlatformRequest } from "../../src/worker/platform";
import { registerGoogleAccount } from "../../src/worker/google-auth";
import { migrateTestDatabase } from "../migrate-test-database";

beforeAll(migrateTestDatabase);

async function player(registered = true) {
  const response = (await handlePlatformRequest(new Request("http://localhost/api/platform/bootstrap"), env.DB))!;
  const cookie = response.headers.getSetCookie().map(value => value.split(";", 1)[0]).join("; ");
  const { playerId } = await response.json<{ playerId: string }>();
  if (registered) await registerGoogleAccount(env.DB, { playerId, token: /vgc_session=([^;]+)/.exec(cookie)![1]!, secureCookie: false }, { sub: crypto.randomUUID(), name: "Operator test" });
  const account = await env.DB.prepare("SELECT account_id FROM players WHERE id = ?").bind(playerId).first<{ account_id: string }>();
  return { playerId, cookie, accountId: account?.account_id ?? "" };
}
const row = { operation: "solo_start", game: "graze-duel", eligible: 10, failed: 3, succeeded: 7, rejected: 2, cancelled: 1 };
const request = (cookie = "", path = "/operator/operations", method = "GET") => new Request("https://staging.example" + path, { method, headers: { Cookie: cookie } });
const config = { APP_ENV: "staging", DB: env.DB, CLOUDFLARE_METRICS_TOKEN: "private-test-token" };

it("only serves fixed staging routes and fails closed without operator configuration", async () => {
  const fetcher = vi.fn();
  expect(await handleOperatorRequest(request("", "/"), config, fetcher)).toBeNull();
  for (const APP_ENV of ["local", "production", undefined]) expect((await handleOperatorRequest(request(), { ...config, APP_ENV }, fetcher))!.status).toBe(404);
  expect((await handleOperatorRequest(request(), config, fetcher))!.status).toBe(503);
  expect(fetcher).not.toHaveBeenCalled();
});

it("rejects missing sessions, guests, unrelated accounts and method/query/cross-site attempts without querying metrics", async () => {
  const owner = await player(), guest = await player(false), other = await player();
  const options = { ...config, OPERATOR_ACCOUNT_IDS: owner.accountId }, fetcher = vi.fn();
  for (const [cookie, status] of [["", 401], [guest.cookie, 403], [other.cookie, 403]] as const) {
    expect((await handleOperatorRequest(request(cookie), options, fetcher))!.status).toBe(status);
  }
  expect((await handleOperatorRequest(request(owner.cookie, "/operator/operations", "POST"), options, fetcher))!.status).toBe(405);
  expect((await handleOperatorRequest(request(owner.cookie, "/api/operator/operations?sql=SELECT"), options, fetcher))!.status).toBe(403);
  const crossSite = request(owner.cookie); crossSite.headers.set("Sec-Fetch-Site", "cross-site");
  expect((await handleOperatorRequest(crossSite, options, fetcher))!.status).toBe(403);
  expect(fetcher).not.toHaveBeenCalled();
});

it("renders responsive operator counts, warning rates and no-data states without exposing identities or secrets", async () => {
  const owner = await player();
  const fetcher = vi.fn(async () => Response.json({ data: [row] }));
  const response = (await handleOperatorRequest(request(owner.cookie), { ...config, OPERATOR_ACCOUNT_IDS: owner.accountId }, fetcher))!;
  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  expect(response.headers.get("Content-Security-Policy")).toContain("frame-ancestors 'none'");
  expect(response.headers.get("X-Robots-Tag")).toContain("noindex");
  const html = await response.text();
  for (const text of ["30.0%", "要確認", "対象なし", "キャンセル", "集計を更新", "viewport"]) expect(html).toContain(text);
  for (const text of [owner.accountId, owner.playerId, config.CLOUDFLARE_METRICS_TOKEN, "<script", "setInterval"]) expect(html).not.toContain(text);
  expect(fetcher).toHaveBeenCalledTimes(2);
  const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe("https://api.cloudflare.com/client/v4/analytics/sql");
  expect(init.redirect).toBe("manual");
  expect(init.body).toContain("INTERVAL '20' MINUTE");
  const monthlyCall = fetcher.mock.calls[1] as unknown as [string, RequestInit];
  expect(monthlyCall[1].body).toContain("blob7 != 'operation-drill-v1'");
  for (const text of ["今月のサーバー処理", "98%", "目標水準未満（参考）", "月間SLOの達成判定ではありません", "日本時間"]) expect(html).toContain(text);
  const navigation = request(owner.cookie);
  navigation.headers.set("Sec-Fetch-Site", "cross-site");
  navigation.headers.set("Sec-Fetch-Mode", "navigate");
  navigation.headers.set("Sec-Fetch-Dest", "document");
  expect((await handleOperatorRequest(navigation, { ...config, OPERATOR_ACCOUNT_IDS: owner.accountId }, fetcher))!.status).toBe(200);
});

it("returns the same aggregates via authenticated JSON and never treats empty data as healthy", async () => {
  const owner = await player();
  const response = (await handleOperatorRequest(request(owner.cookie, "/api/operator/operations"), { ...config, OPERATOR_ACCOUNT_IDS: owner.accountId }, async () => Response.json({ data: [] })))!;
  const report = await response.json<{ families: Record<string, { failureRate: number | null; eligible: number }> }>();
  expect(report.families.start).toMatchObject({ failureRate: null, eligible: 0 });
});

it.each(["expired", "revoked", "deleting", "permission_removed"])("immediately denies %s operator sessions", async kind => {
  const owner = await player();
  const fetcher = vi.fn();
  if (kind === "expired") await env.DB.prepare("UPDATE player_sessions SET expires_at = '2000-01-01' WHERE player_id = ?").bind(owner.playerId).run();
  if (kind === "revoked") await env.DB.prepare("DELETE FROM player_sessions WHERE player_id = ?").bind(owner.playerId).run();
  if (kind === "deleting") await env.DB.prepare("UPDATE players SET deletion_requested_at = CURRENT_TIMESTAMP WHERE id = ?").bind(owner.playerId).run();
  const response = (await handleOperatorRequest(request(owner.cookie), { ...config, OPERATOR_ACCOUNT_IDS: kind === "permission_removed" ? "different" : owner.accountId }, fetcher))!;
  expect([401, 403]).toContain(response.status);
  expect(fetcher).not.toHaveBeenCalled();
});

it.each(["upstream", "malformed", "oversized", "missing", "inconsistent", "limit", "api_error", "network"])("fails closed on %s reports", async kind => {
  const fetcher: typeof fetch = async () => {
    if (kind === "network") throw Error("private failure");
    if (kind === "upstream") return new Response("private failure", { status: 403 });
    if (kind === "malformed") return new Response("not json");
    if (kind === "oversized") return new Response("x".repeat(65537));
    if (kind === "missing") return Response.json({});
    if (kind === "api_error") return Response.json({ success: false, errors: ["private failure"], data: [] });
    return Response.json({ data: kind === "limit" ? Array(64).fill(row) : [{ ...row, eligible: 999 }] });
  };
  await expect(collectOperationReport("test", fetcher)).rejects.toThrow();
});

it("shows a generic error rather than stale or zero values on failed collection", async () => {
  const owner = await player();
  const response = (await handleOperatorRequest(request(owner.cookie), { ...config, OPERATOR_ACCOUNT_IDS: owner.accountId }, async () => { throw Error("private failure"); }))!;
  expect(response.status).toBe(503);
  expect(await response.text()).not.toContain("private failure");
});

it("never substitutes the short window for a failed monthly query", async () => {
  const owner = await player();
  let calls = 0;
  const fetcher: typeof fetch = async () => {
    if (++calls === 2) throw Error("private monthly failure");
    return Response.json({ data: [row] });
  };
  const response = (await handleOperatorRequest(request(owner.cookie), { ...config, OPERATOR_ACCOUNT_IDS: owner.accountId }, fetcher))!;
  expect(response.status).toBe(503);
  expect(await response.text()).not.toContain("30.0%");
});

it("returns fixed, provisional monthly JSON without leaking private identifiers", async () => {
  const owner = await player();
  const response = (await handleOperatorRequest(request(owner.cookie, "/api/operator/operations"), { ...config, OPERATOR_ACCOUNT_IDS: owner.accountId },
    async () => Response.json({ data: [] })))!;
  const result = await response.json<{ monthly: { provisional: boolean; window: { timeZone: string }; measurementBoundary: string; families: { start: { successRate: number | null; assessment: string } } } }>();
  expect(result.monthly).toMatchObject({ provisional: true, measurementBoundary: "server_operation_only", window: { timeZone: "Asia/Tokyo" } });
  expect(result.monthly.families.start).toMatchObject({ successRate: null, assessment: "no_eligible_data" });
  expect(JSON.stringify(result)).not.toContain(owner.accountId);
});

it.each(["oversized", "inconsistent", "api_error", "network"])("rejects invalid monthly response: %s", async kind => {
  const fetcher: typeof fetch = async () => {
    if (kind === "network") throw Error("private");
    if (kind === "oversized") return new Response("x".repeat(65537));
    return Response.json(kind === "api_error" ? { success: false, errors: ["private"], data: [] } : { data: [{ ...row, eligible: 99 }] });
  };
  await expect(collectMonthlyOperationReport("test", fetcher)).rejects.toThrow();
});
