import { beforeAll, beforeEach, expect, it } from "vitest";
import { env, exports } from "cloudflare:workers";
import { handleFeedback } from "../../src/worker/feedback";
import { handlePlatformRequest } from "../../src/worker/platform";
import { registerGoogleAccount } from "../../src/worker/google-auth";
import { limitRequest } from "../../src/worker/request-protection";
import { migrateTestDatabase } from "../migrate-test-database";

beforeAll(migrateTestDatabase);
beforeEach(async () => { await env.DB.batch([env.DB.prepare("DELETE FROM feedback"), env.DB.prepare("DELETE FROM feedback_rate_buckets")]); });
const options = { APP_ENV: "staging", DB: env.DB };
const payload = () => ({ id: crypto.randomUUID(), category: "good", message: "見ていて楽しかった", gameId: "graze-duel", activity: "spectator" });
function request(body: unknown = payload(), changes: RequestInit = {}) {
  return new Request("https://staging.example/api/feedback", { method: "POST", body: JSON.stringify(body), headers: { Origin: "https://staging.example", "Content-Type": "application/json", "CF-Connecting-IP": "192.0.2.1" }, ...changes });
}
async function send(body: unknown = payload(), changes: RequestInit = {}) { return (await handleFeedback(request(body, changes), options))!; }
async function operator() {
  const response = (await handlePlatformRequest(new Request("http://localhost/api/platform/bootstrap"), env.DB))!;
  const cookie = response.headers.getSetCookie().map(value => value.split(";", 1)[0]).join("; ");
  const { playerId } = await response.json<{ playerId: string }>();
  await registerGoogleAccount(env.DB, { playerId, token: /vgc_session=([^;]+)/.exec(cookie)![1]!, secureCookie: false }, { sub: crypto.randomUUID(), name: "Operator" });
  const account = await env.DB.prepare("SELECT account_id FROM players WHERE id = ?").bind(playerId).first<{ account_id: string }>();
  return { playerId, cookie, accountId: account!.account_id };
}
const operatorRequest = (cookie = "", path = "/operator/feedback") => new Request("https://staging.example" + path, { headers: { Cookie: cookie } });
const localOptions = { APP_ENV: "local", DEVELOPER_AUTH_ENABLED: "true", DB: env.DB };
const localRequest = (cookie = "", path = "/operator/feedback", origin = "http://localhost") => new Request(origin + path, { headers: { Cookie: cookie } });
async function developer() {
  const response = await exports.default.fetch("http://localhost/api/platform/bootstrap");
  const cookie = response.headers.getSetCookie().map(value => value.split(";", 1)[0]).join("; ");
  const initial = await response.json<{ consent: { termsVersion: string; privacyVersion: string } }>();
  const consent = await exports.default.fetch("http://localhost/api/platform/consents", { method: "POST", headers: { Cookie: cookie, "Content-Type": "application/json", Origin: "http://localhost" }, body: JSON.stringify(initial.consent) });
  expect(consent.status).toBe(200);
  const login = await exports.default.fetch("http://localhost/api/platform/auth/developer?returnTo=%2Foperator%2Ffeedback", { headers: { Cookie: cookie }, redirect: "manual" });
  expect(login.status).toBe(302);
  expect(login.headers.get("Location")).toMatch(/\/operator\/feedback\?account=(?:registered|logged_in|registered_without_bonus)$/);
  const session = await exports.default.fetch("http://localhost/api/platform/bootstrap", { headers: { Cookie: cookie } });
  const account = await session.json<{ playerId: string }>();
  return { cookie, playerId: account.playerId };
}

it("lets a locally logged-in developer read submitted feedback through HTML and JSON", async () => {
  const body = { ...payload(), message: "ローカル開発者の閲覧確認" };
  await send(body);
  const owner = await developer();
  const page = await exports.default.fetch("http://localhost/operator/feedback", { headers: { Cookie: owner.cookie } });
  expect(page.status).toBe(200);
  const html = await page.text();
  expect(html).toContain(body.message);
  expect(html).toContain("ローカル開発者用");
  expect(html).not.toContain('href="/operator/operations"');
  expect(page.headers.get("Cache-Control")).toBe("private, no-store");
  const json = (await handleFeedback(localRequest(owner.cookie, "/api/operator/feedback"), localOptions))!;
  expect(json.status).toBe(200);
  expect(await json.json()).toMatchObject({ feedback: [{ id: body.id, message: body.message }] });
});

it("requires developer identity rather than a guest or an allowlisted Google account locally", async () => {
  const owner = await operator();
  expect((await handleFeedback(localRequest(), localOptions))!.status).toBe(401);
  expect((await handleFeedback(localRequest(owner.cookie), { ...localOptions, OPERATOR_ACCOUNT_IDS: owner.accountId }))!.status).toBe(403);
  const guest = (await handlePlatformRequest(new Request("http://localhost/api/platform/bootstrap"), env.DB))!;
  const cookie = guest.headers.getSetCookie().map(value => value.split(";", 1)[0]).join("; ");
  expect((await handleFeedback(localRequest(cookie), localOptions))!.status).toBe(403);
});

it.each(["expired", "revoked", "deleting", "different_identity"])("rejects %s local developer sessions", async kind => {
  const owner = await developer();
  if (kind === "expired") await env.DB.prepare("UPDATE player_sessions SET expires_at = '2000-01-01' WHERE player_id = ?").bind(owner.playerId).run();
  if (kind === "revoked") await env.DB.prepare("DELETE FROM player_sessions WHERE player_id = ?").bind(owner.playerId).run();
  if (kind === "deleting") await env.DB.prepare("UPDATE players SET deletion_requested_at = CURRENT_TIMESTAMP WHERE id = ?").bind(owner.playerId).run();
  if (kind === "different_identity") await env.DB.prepare("UPDATE account_identities SET provider_subject = ? WHERE provider = 'developer' AND account_id = (SELECT account_id FROM players WHERE id = ?)").bind(crypto.randomUUID(), owner.playerId).run();
  expect([401, 403]).toContain((await handleFeedback(localRequest(owner.cookie), localOptions))!.status);
  if (kind === "deleting") await env.DB.prepare("UPDATE players SET deletion_requested_at = NULL WHERE id = ?").bind(owner.playerId).run();
});

it("never enables developer operator access remotely or when developer auth is disabled", async () => {
  const owner = await developer();
  for (const origin of ["https://staging.example", "https://localhost.example", "http://192.168.0.25", "http://10.0.0.1"]) {
    expect((await handleFeedback(localRequest(owner.cookie, "/operator/feedback", origin), localOptions))!.status).toBe(404);
  }
  expect((await handleFeedback(localRequest(owner.cookie), { ...localOptions, DEVELOPER_AUTH_ENABLED: "false" }))!.status).toBe(404);
  expect((await handleFeedback(localRequest(owner.cookie), { ...localOptions, DEVELOPER_AUTH_ENABLED: undefined }))!.status).toBe(404);
  expect((await handleFeedback(localRequest(owner.cookie), { ...localOptions, APP_ENV: "production" }))!.status).toBe(404);
  const account = await env.DB.prepare("SELECT account_id FROM players WHERE id = ?").bind(owner.playerId).first<{ account_id: string }>();
  expect((await handleFeedback(operatorRequest(owner.cookie), { ...localOptions, APP_ENV: "staging", OPERATOR_ACCOUNT_IDS: account!.account_id }))!.status).toBe(403);
});

it("accepts anonymous feedback without a session, stores only declared fields, and retries idempotently", async () => {
  const body = payload();
  expect((await send(body)).status).toBe(200);
  expect((await send(body)).status).toBe(200);
  const saved = await env.DB.prepare("SELECT * FROM feedback WHERE id = ?").bind(body.id).first();
  expect(saved).toMatchObject({ category: body.category, message: body.message, game_id: body.gameId, activity: body.activity });
  expect(Object.keys(saved!).sort()).toEqual(["activity", "browser_type", "category", "created_at", "device_type", "game_id", "id", "message", "player_name"]);
  const quota = await env.DB.prepare("SELECT * FROM feedback_rate_buckets").first();
  expect(quota?.count).toBe(1);
  expect(JSON.stringify(quota)).not.toContain("192.0.2.1");
  expect((await send({ ...body, message: "different" })).status).toBe(409);
});

it("normalizes whitespace and supports site feedback without a game", async () => {
  const body = { ...payload(), gameId: null, activity: "site", message: "  改善希望  " };
  expect((await send(body)).status).toBe(200);
  expect(await env.DB.prepare("SELECT message FROM feedback WHERE id = ?").bind(body.id).first()).toEqual({ message: "改善希望" });
});

it("routes anonymous submissions through the real Worker without bootstrapping a player", async () => {
  const body = payload();
  const response = await exports.default.fetch("http://localhost/api/feedback", { method: "POST", headers: { Origin: "http://localhost", "Content-Type": "application/json" }, body: JSON.stringify(body) });
  expect(response.status).toBe(200);
  expect(await env.DB.prepare("SELECT id FROM feedback WHERE id = ?").bind(body.id).first()).toEqual({ id: body.id });
});

it.each([
  { category: "other" }, { category: ["good"] }, { activity: ["player"] }, { activity: "unknown" },
  { gameId: "missing-game" }, { gameId: null }, { message: " " }, { message: "a".repeat(2001) },
  { id: "not-uuid" }, { playerId: "unwanted" },
])("rejects invalid or undeclared data %j", async change => {
  expect((await send({ ...payload(), ...change })).status).toBe(400);
  expect((await env.DB.prepare("SELECT count(*) AS count FROM feedback").first())?.count).toBe(0);
});

it("rejects bad JSON, origin, media types, methods, oversized and cross-site requests", async () => {
  expect((await send(payload(), { body: "bad json" })).status).toBe(400);
  expect((await send(payload(), { headers: { Origin: "https://evil.example", "Content-Type": "application/json" } })).status).toBe(403);
  expect((await send(payload(), { headers: { Origin: "https://staging.example", "Content-Type": "text/plain" } })).status).toBe(415);
  expect((await send(payload(), { method: "GET", body: null })).status).toBe(405);
  expect((await send(payload(), { body: "x".repeat(8193) })).status).toBe(413);
  expect((await send(payload(), { headers: { Origin: "https://staging.example", "Content-Type": "application/json", "Sec-Fetch-Site": "cross-site" } })).status).toBe(403);
});

it("atomically enforces twenty daily submissions on one shared address, allowing retries", async () => {
  const bodies = Array.from({ length: 21 }, payload);
  const responses = await Promise.all(bodies.map(body => send(body)));
  expect(responses.filter(response => response.status === 200)).toHaveLength(20);
  const blocked = responses.find(response => response.status === 429)!;
  expect(blocked.headers.get("Retry-After")).toBe("86400");
  const successful = bodies[responses.findIndex(response => response.status === 200)];
  expect((await send(successful)).status).toBe(200);
  expect((await env.DB.prepare("SELECT count(*) AS count FROM feedback").first())?.count).toBe(20);
  expect((await env.DB.prepare("SELECT count FROM feedback_rate_buckets").first())?.count).toBe(20);
});

it("makes concurrent equal retries idempotent and rejects conflicting retries", async () => {
  const body = payload();
  const responses = await Promise.all([send(body), send({ ...body, message: "different" })]);
  expect(responses.map(response => response.status).sort()).toEqual([200, 409]);
  const saved = await env.DB.prepare("SELECT message FROM feedback WHERE id = ?").bind(body.id).first<{ message: string }>();
  expect((await send({ ...body, message: saved!.message })).status).toBe(200);
  expect((await env.DB.prepare("SELECT count(*) AS count FROM feedback").first())?.count).toBe(1);
});

it("fails closed without a trusted address or database availability", async () => {
  const noAddress = request(); noAddress.headers.delete("CF-Connecting-IP");
  expect((await handleFeedback(noAddress, options))!.status).toBe(503);
  expect((await handleFeedback(request(), { ...options, DB: { prepare() { throw Error("private detail"); } } as unknown as D1Database }))!.status).toBe(503);
  expect(await handleFeedback(new Request("https://staging.example/"), options)).toBeNull();
});

it("protects the operator page with the shared read limiter", async () => {
  expect((await limitRequest(operatorRequest(), { APP_ENV: "staging", API_READ_LIMITER: { limit: async () => ({ success: false }) } }))!.status).toBe(429);
});

it("only lets configured, active Google operators read feedback and escapes all text", async () => {
  const owner = await operator();
  const config = { ...options, OPERATOR_ACCOUNT_IDS: owner.accountId };
  expect((await handleFeedback(operatorRequest(), config))!.status).toBe(401);
  expect((await handleFeedback(operatorRequest(owner.cookie), options))!.status).toBe(503);
  expect((await handleFeedback(operatorRequest(owner.cookie), { ...config, APP_ENV: "production" }))!.status).toBe(404);
  expect((await handleFeedback(operatorRequest(owner.cookie), { ...config, OPERATOR_ACCOUNT_IDS: "other" }))!.status).toBe(403);
  await send({ ...payload(), message: '<script>alert("x")</script>' });
  const response = (await handleFeedback(operatorRequest(owner.cookie), config))!;
  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  expect(response.headers.get("Content-Security-Policy")).toContain("frame-ancestors 'none'");
  const html = await response.text();
  expect(html).toContain("&lt;script&gt;");
  expect(html).not.toContain("<script>");
  expect(html).not.toContain(owner.accountId);
  expect(html).toContain("日時（日本時間）");
  expect(html).toContain("JST");
  expect(html).toContain("未記録");
  expect((await handleFeedback(operatorRequest(owner.cookie, "/api/operator/feedback?page=1"), config))!.status).toBe(200);
  expect((await handleFeedback(operatorRequest(owner.cookie, "/api/operator/feedback?page=0"), config))!.status).toBe(400);
  const crossSite = operatorRequest(owner.cookie); crossSite.headers.set("Sec-Fetch-Site", "cross-site");
  expect((await handleFeedback(crossSite, config))!.status).toBe(403);
  expect((await handleFeedback(operatorRequest(owner.cookie, "/api/operator/feedback?sql=SELECT"), config))!.status).toBe(400);
  expect((await handleFeedback(operatorRequest(owner.cookie, "/api/operator/feedback?page=999"), config))!.status).toBe(200);
  await env.DB.prepare("UPDATE player_sessions SET expires_at = '2000-01-01' WHERE player_id = ?").bind(owner.playerId).run();
  expect((await handleFeedback(operatorRequest(owner.cookie), config))!.status).toBe(401);
});
