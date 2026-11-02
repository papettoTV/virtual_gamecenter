import { beforeAll, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { feedbackDevice, feedbackJapanTime, feedbackPlayerName } from "../../src/worker/feedback-context";
import { handleFeedback } from "../../src/worker/feedback";
import { handlePlatformRequest } from "../../src/worker/platform";
import { registerGoogleAccount } from "../../src/worker/google-auth";
import { migrateTestDatabase } from "../migrate-test-database";

beforeAll(migrateTestDatabase);

it.each([
  ["Mozilla/5.0 (Windows NT 10.0) Chrome/140.0 Safari/537.36", "PC", "Chrome"],
  ["Mozilla/5.0 (iPhone; CPU iPhone OS 26_0) Version/26.0 Mobile/15E148 Safari/604.1", "スマホ", "Safari"],
  ["Mozilla/5.0 (Linux; Android 16; Pixel) Chrome/140.0 Mobile Safari/537.36", "スマホ", "Chrome"],
  ["Mozilla/5.0 (iPad; CPU OS 26_0) Version/26.0 Safari/604.1", "タブレット", "Safari"],
  ["Mozilla/5.0 (Linux; Android 16) Chrome/140.0 Safari/537.36", "タブレット", "Chrome"],
  ["Mozilla/5.0 (Windows NT 10.0) Chrome/140.0 Safari/537.36 Edg/140.0", "PC", "Edge"],
  ["Mozilla/5.0 (iPhone) CriOS/140.0 Mobile Safari/604.1", "スマホ", "Chrome"],
  ["Mozilla/5.0 (iPhone) FxiOS/144.0 Safari/604.1", "スマホ", "Firefox"],
  ["Mozilla/5.0 (Windows NT 10.0) Chrome/140.0 OPR/120.0", "PC", "Opera"],
  ["Mozilla/5.0 (Linux; Android 16) SamsungBrowser/25.0 Chrome/140.0 Mobile Safari/537.36", "スマホ", "Samsung Internet"],
  [null, "不明", "不明"], ["unknown", "不明", "不明"], ["Chrome/".repeat(200), "不明", "不明"],
])("classifies bounded user agent %s without retaining its detail", (agent, device, browser) => {
  expect(feedbackDevice(agent)).toEqual({ device, browser });
});

it("formats UTC dates in Japan time across midnight and year boundaries", () => {
  expect(feedbackJapanTime("2026-10-26 22:58:50")).toBe("2026/10/27 07:58:50 JST");
  expect(feedbackJapanTime("2026-12-31 15:30:00")).toBe("2027/01/01 00:30:00 JST");
  expect(feedbackJapanTime("invalid")).toBe("未記録");
});

async function guest() {
  const response = (await handlePlatformRequest(new Request("http://localhost/api/platform/bootstrap"), env.DB))!;
  const cookie = response.headers.getSetCookie().map(value => value.split(";", 1)[0]).join("; ");
  return { ...await response.json<{ playerId: string; playerName: string }>(), cookie };
}

it("records the server-side display name snapshot and coarse device info, not client-supplied identity", async () => {
  const player = await guest();
  await registerGoogleAccount(env.DB, { playerId: player.playerId, token: /vgc_session=([^;]+)/.exec(player.cookie)![1]!, secureCookie: false }, { sub: crypto.randomUUID(), name: '<Test & "name">' });
  const id = crypto.randomUUID();
  const payload = { id, category: "good", message: "context test", gameId: null, activity: "site" };
  const request = () => new Request("http://localhost/api/feedback", { method: "POST", headers: { Origin: "http://localhost", "Content-Type": "application/json", Cookie: player.cookie, "User-Agent": "Mozilla/5.0 (iPhone) Version/26.0 Mobile Safari/604.1" }, body: JSON.stringify(payload) });
  expect((await handleFeedback(request(), { APP_ENV: "local", DB: env.DB }))!.status).toBe(200);
  const row = await env.DB.prepare("SELECT * FROM feedback WHERE id = ?").bind(id).first();
  expect(row).toMatchObject({ player_name: '<Test & "name">', device_type: "スマホ", browser_type: "Safari" });
  expect(JSON.stringify(row)).not.toContain("Mozilla");
  expect(JSON.stringify(row)).not.toContain(player.playerId);
  await env.DB.prepare("UPDATE accounts SET display_name = 'Changed' WHERE id = (SELECT account_id FROM players WHERE id = ?)").bind(player.playerId).run();
  expect((await handleFeedback(request(), { APP_ENV: "local", DB: env.DB }))!.status).toBe(200);
  expect(await env.DB.prepare("SELECT player_name FROM feedback WHERE id = ?").bind(id).first()).toEqual({ player_name: '<Test & "name">' });
  const account = await env.DB.prepare("SELECT account_id FROM players WHERE id = ?").bind(player.playerId).first<{ account_id: string }>();
  const response = (await handleFeedback(new Request("https://staging.example/operator/feedback", { headers: { Cookie: player.cookie } }), { APP_ENV: "staging", DB: env.DB, OPERATOR_ACCOUNT_IDS: account!.account_id }))!;
  const html = await response.text();
  expect(html).toContain("&lt;Test &amp; &quot;name&quot;&gt;");
  expect(html).not.toContain('<Test & "name">');
});

it("uses guest system names and does not identify missing, expired, or deleting sessions", async () => {
  const player = await guest();
  const request = new Request("http://localhost/", { headers: { Cookie: player.cookie } });
  expect(await feedbackPlayerName(request, env.DB)).toBe(player.playerName);
  expect(await feedbackPlayerName(new Request("http://localhost/"), env.DB)).toBeNull();
  await env.DB.prepare("UPDATE player_sessions SET expires_at = '2000-01-01' WHERE player_id = ?").bind(player.playerId).run();
  expect(await feedbackPlayerName(request, env.DB)).toBeNull();
  const deleting = await guest();
  await env.DB.prepare("UPDATE players SET deletion_requested_at = CURRENT_TIMESTAMP WHERE id = ?").bind(deleting.playerId).run();
  expect(await feedbackPlayerName(new Request("http://localhost/", { headers: { Cookie: deleting.cookie } }), env.DB)).toBeNull();
});
