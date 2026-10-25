import { getGameDefinition } from "../domain/game";
import { boundRequestBody, clientAddressKey } from "./request-protection";
import { hashIdentifier } from "./identity-hash";
import { operatorAccess } from "./operator-access";

interface FeedbackEnv { APP_ENV?: string; OPERATOR_ACCOUNT_IDS?: string; DB: D1Database }
interface FeedbackRow { id: string; category: string; message: string; game_id: string | null; activity: string; created_at: string }
const headers = { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow" };
const reply = (status: number, error: string) => Response.json({ error }, { status, headers });
const escape = (value: string) => value.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);

export async function handleFeedback(request: Request, env: FeedbackEnv): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname === "/operator/feedback" || url.pathname === "/api/operator/feedback") {
    if (request.method !== "GET") return reply(405, "method_not_allowed");
    if (request.headers.get("Sec-Fetch-Site") === "cross-site") return reply(403, "invalid_origin");
    const page = url.searchParams.get("page") ?? "1";
    if ([...url.searchParams.keys()].some(key => key !== "page") || !/^[1-9]\d{0,2}$/.test(page)) return reply(400, "invalid_page");
    try {
      const denied = await operatorAccess(request, env);
      if (denied) return reply(denied.status, denied.message);
      const rows = await env.DB.prepare("SELECT id, category, message, game_id, activity, created_at FROM feedback WHERE created_at >= datetime('now', '-90 days') ORDER BY created_at DESC, id DESC LIMIT 50 OFFSET ?")
        .bind((Number(page) - 1) * 50).all<FeedbackRow>();
      if (url.pathname.startsWith("/api/")) return Response.json({ feedback: rows.results, page: Number(page) }, { headers });
      const labels: Record<string, string> = { good: "よかった", concern: "気になった", bug: "不具合", player: "プレイ", spectator: "観戦", site: "サイト利用" };
      const body = rows.results.map(row => `<tr><td>${escape(row.created_at)} UTC</td><td>${labels[row.category]}</td><td>${escape(row.game_id ? getGameDefinition(row.game_id)?.title ?? row.game_id : "サイト全体")} / ${labels[row.activity]}</td><td style="white-space:pre-wrap;overflow-wrap:anywhere">${escape(row.message)}</td></tr>`).join("");
      return new Response(`<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>フィードバック | 運営者専用</title><style>body{font:16px system-ui;background:#090b18;color:#f4f7ff;padding:24px}a{color:#69f7ff}table{border-collapse:collapse;width:100%}td,th{border:1px solid #536078;padding:12px;text-align:left;vertical-align:top}</style><h1>フィードバック</h1><p>非公開・直近90日 / ${page}ページ目・最大50件</p><p><a href="/operator/operations">運営者画面</a> / <a href="/">サイトに戻る</a></p><table><thead><tr><th>日時</th><th>種別</th><th>対象</th><th>内容</th></tr></thead><tbody>${body}</tbody></table><p>${Number(page) > 1 ? `<a href="?page=${Number(page) - 1}">前へ</a> ` : ""}${rows.results.length === 50 && Number(page) < 999 ? `<a href="?page=${Number(page) + 1}">次へ</a>` : ""}</p></html>`, { headers: { ...headers, "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'" } });
    } catch { return reply(503, "feedback_unavailable"); }
  }
  if (url.pathname !== "/api/feedback") return null;
  if (request.method !== "POST") return reply(405, "method_not_allowed");
  if (request.headers.get("Origin") !== url.origin || request.headers.get("Sec-Fetch-Site") === "cross-site") return reply(403, "invalid_origin");
  if (!/^application\/json(?:;|$)/i.test(request.headers.get("Content-Type") ?? "")) return reply(415, "json_required");
  const bounded = await boundRequestBody(request, 8192);
  if (bounded instanceof Response) return bounded;
  let body: Record<string, unknown>;
  try { body = await bounded.json(); } catch { return reply(400, "invalid_json"); }
  if (!body || typeof body !== "object" || Array.isArray(body)
    || Object.keys(body).some(key => !["id", "category", "message", "gameId", "activity"].includes(key))
    || typeof body.id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.id)
    || typeof body.category !== "string" || !["good", "concern", "bug"].includes(body.category)
    || typeof body.message !== "string" || !body.message.trim() || body.message.length > 2000
    || typeof body.activity !== "string" || !["player", "spectator", "site"].includes(body.activity)
    || (body.gameId !== null && (typeof body.gameId !== "string" || !getGameDefinition(body.gameId)))
    || (body.activity !== "site" && body.gameId === null)) return reply(400, "invalid_feedback");
  const { id, category, activity, gameId } = body;
  const message = body.message.trim();
  try {
    const existing = await env.DB.prepare("SELECT category, message, game_id, activity FROM feedback WHERE id = ?").bind(id).first<FeedbackRow>();
    if (existing) return existing.category === category && existing.message === message && existing.game_id === gameId && existing.activity === activity
      ? Response.json({ accepted: true }, { headers }) : reply(409, "id_conflict");
    const address = await clientAddressKey(request, env.APP_ENV);
    if (!address && env.APP_ENV !== "local") return reply(503, "feedback_unavailable");
    const day = new Date().toISOString().slice(0, 10);
    const bucket = await hashIdentifier(`${day}:${address ?? "local"}`);
    const results = await env.DB.batch([
      env.DB.prepare(`INSERT INTO feedback_rate_buckets (bucket, count, last_id, expires_at) VALUES (?, 1, ?, datetime('now', '+1 day'))
        ON CONFLICT(bucket) DO UPDATE SET count = count + 1, last_id = excluded.last_id WHERE count < 20 AND NOT EXISTS (SELECT 1 FROM feedback WHERE id = ?)`)
        .bind(bucket, id, id),
      env.DB.prepare(`INSERT OR IGNORE INTO feedback (id, category, message, game_id, activity)
        SELECT ?, ?, ?, ?, ? FROM feedback_rate_buckets WHERE bucket = ? AND last_id = ?`).bind(id, category, message, gameId, activity, bucket, id),
    ]);
    if (!results[1]?.meta.changes) {
      const saved = await env.DB.prepare("SELECT category, message, game_id, activity FROM feedback WHERE id = ?").bind(id).first<FeedbackRow>();
      if (!saved) return new Response(JSON.stringify({ error: "rate_limited" }), { status: 429, headers: { ...headers, "Content-Type": "application/json", "Retry-After": "86400" } });
      if (saved.category !== category || saved.message !== message || saved.game_id !== gameId || saved.activity !== activity) return reply(409, "id_conflict");
    }
    return Response.json({ accepted: true }, { headers });
  } catch { return reply(503, "feedback_unavailable"); }
}
