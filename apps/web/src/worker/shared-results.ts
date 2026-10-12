import { getGameDefinition } from "../domain/game";
import type { SharedResult, SharedResultDraft } from "../domain/shared-result";
import { getPlayerIdentity } from "./platform";
import { presentResult } from "../features/sharing/result-presenters";

export type { SharedResult, SharedResultDraft } from "../domain/shared-result";

export interface SharedResultsEnv {
  ASSETS: Fetcher;
}

interface ResultRow {
  id: string;
  owner_id: string;
  player_name: string;
  game_id: string;
  game_version: string;
  elapsed_time_ms: number;
  cleared: number;
  score: number;
  metrics_json: string;
  created_at: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_BODY_BYTES = 16_384;
const METRIC_RULES: Record<string, Record<string, "number" | "species" | readonly string[]>> = {
  "graze-duel": { maxLevel: "number", defeatedBossCount: "number", mode: ["solo", "versus"], outcome: ["win", "lose", "draw"] },
  "deep-sea-salvage": { maxDepth: "number", discoveredCount: "number", speciesIds: "species", totalSpeciesCount: "number" },
  "dot-wave": { mode: ["solo", "versus"], outcome: ["win", "lose", "draw"], turns: "number", remainingHp: "number" },
  "mochi-beat": { completedSets: "number", accuracy: "number" },
};

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonnegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER;
}

export function validateSharedResultDraft(value: unknown): SharedResultDraft | null {
  if (!object(value) || typeof value.id !== "string" || !UUID.test(value.id)) return null;
  const game = typeof value.gameId === "string" ? getGameDefinition(value.gameId) : null;
  if (!game || !METRIC_RULES[game.id]) return null;
  if (typeof value.gameVersion !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(value.gameVersion)) return null;
  if (!nonnegative(value.elapsedTimeMs) || !Number.isSafeInteger(value.elapsedTimeMs)
    || !nonnegative(value.score) || typeof value.cleared !== "boolean" || !object(value.metrics)) return null;
  const rules = METRIC_RULES[game.id]!;
  const metrics: SharedResultDraft["metrics"] = {};
  for (const key of Object.keys(value.metrics).sort()) {
    if (!Object.hasOwn(rules, key)) return null;
    const rule = rules[key];
    const metric = value.metrics[key];
    if (rule === "number") {
      if (!nonnegative(metric)) return null;
    } else if (rule === "species") {
      if (typeof metric !== "string" || metric.length > 2048 || !/^(?:[a-zA-Z0-9_-]+(?:,[a-zA-Z0-9_-]+)*)?$/.test(metric)) return null;
    } else if (!Array.isArray(rule) || typeof metric !== "string" || !rule.includes(metric)) return null;
    metrics[key] = metric as number | string;
  }
  return { id: value.id.toLowerCase(), gameId: game.id, gameVersion: value.gameVersion,
    elapsedTimeMs: value.elapsedTimeMs, cleared: value.cleared, score: value.score, metrics };
}

function publicResult(row: ResultRow): SharedResult {
  return { id: row.id, gameId: row.game_id, gameVersion: row.game_version,
    elapsedTimeMs: row.elapsed_time_ms, cleared: row.cleared === 1, score: row.score,
    metrics: JSON.parse(row.metrics_json), playerName: row.player_name, createdAt: row.created_at };
}

export async function getSharedResult(db: D1Database, id: string): Promise<SharedResult | null> {
  if (!UUID.test(id)) return null;
  const row = await db.prepare("SELECT * FROM shared_results WHERE id = ? AND EXISTS (SELECT 1 FROM players WHERE id = shared_results.owner_id AND deletion_requested_at IS NULL) AND NOT EXISTS (SELECT 1 FROM data_deletions WHERE player_id = shared_results.owner_id AND status = 'pending')").bind(id.toLowerCase()).first<ResultRow>();
  return row ? publicResult(row) : null;
}

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}

async function readDraft(request: Request): Promise<unknown> {
  if (!request.body) return null;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      length += chunk.value.byteLength;
      if (length > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new RangeError("payload_too_large");
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder().decode(bytes));
}

export async function handleSharedResultsRequest(
  request: Request, db: D1Database, env?: SharedResultsEnv,
): Promise<Response | null> {
  const url = new URL(request.url);
  const collection = url.pathname === "/api/results";
  const match = /^\/(api\/results|results)\/([^/]+)$/.exec(url.pathname);
  if (!collection && !match) return null;
  if (collection) {
    if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
    const origin = request.headers.get("Origin");
    if (origin && origin !== url.origin) return json({ error: "invalid_origin" }, 403);
    const identity = await getPlayerIdentity(request, db);
    if (!identity) return json({ error: "player_session_required" }, 401);
    let value: unknown;
    try { value = await readDraft(request); }
    catch (error) { return json({ error: error instanceof RangeError ? "payload_too_large" : "invalid_json" }, error instanceof RangeError ? 413 : 400); }
    const draft = validateSharedResultDraft(value);
    if (!draft) return json({ error: "invalid_result" }, 400);
    const inserted = await db.prepare(
      `INSERT INTO shared_results (id, owner_id, player_name, game_id, game_version, elapsed_time_ms, cleared, score, metrics_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`,
    ).bind(draft.id, identity.playerId, identity.playerName, draft.gameId, draft.gameVersion,
      draft.elapsedTimeMs, draft.cleared ? 1 : 0, draft.score, JSON.stringify(draft.metrics)).run();
    const row = await db.prepare("SELECT * FROM shared_results WHERE id = ?").bind(draft.id).first<ResultRow>();
    if (!row) return json({ error: "result_save_failed" }, 500);
    const saved = publicResult(row);
    if (row.owner_id !== identity.playerId || saved.gameId !== draft.gameId || saved.gameVersion !== draft.gameVersion
      || saved.elapsedTimeMs !== draft.elapsedTimeMs || saved.cleared !== draft.cleared || saved.score !== draft.score
      || row.metrics_json !== JSON.stringify(draft.metrics)) return json({ error: "result_id_conflict" }, 409);
    return json({ result: saved }, inserted.meta.changes > 0 ? 201 : 200);
  }
  if (request.method !== "GET") return json({ error: "method_not_allowed" }, 405);
  if (!UUID.test(match![2]!)) return json({ error: "invalid_result_id" }, 400);
  const saved = await getSharedResult(db, match![2]!);
  if (!saved) return json({ error: "result_not_found" }, 404);
  if (match![1] === "api/results") return json({ result: saved });
  if (!env) return json({ error: "assets_required" }, 503);
  const shell = await env.ASSETS.fetch(new Request(new URL("/index.html", url), { method: "GET" }));
  if (!shell.ok || !shell.headers.get("content-type")?.includes("text/html")) return json({ error: "result_page_unavailable" }, 503);
  return rewriteResultPage(shell, saved, url.origin);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
}

export function renderResultMetadata(result: SharedResult, origin: string): string {
  const base = new URL(origin);
  if (!/^https?:$/.test(base.protocol) || !UUID.test(result.id)) throw new Error("invalid_result_url");
  const game = getGameDefinition(result.gameId);
  const presentation = presentResult(result);
  const title = `${game?.title ?? result.gameId} | ${presentation.headline} | PULBASE`;
  const description = `${result.playerName} · ${presentation.details.join(" · ")}`;
  const canonical = new URL(`/results/${result.id}`, base.origin).href;
  const image = new URL(`/results/${result.id}/image.png`, base.origin).href;
  return `<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<link rel="canonical" href="${escapeHtml(canonical)}">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="PULBASE">
<meta property="og:url" content="${escapeHtml(canonical)}">
<meta property="og:image" content="${escapeHtml(image)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escapeHtml(title)}">
<meta name="twitter:description" content="${escapeHtml(description)}">
<meta name="twitter:image" content="${escapeHtml(image)}">`;
}

export function rewriteResultPage(shell: Response, result: SharedResult, origin: string): Response {
  const metadata = renderResultMetadata(result, origin);
  const headers = new Headers(shell.headers);
  for (const header of ["content-length", "etag", "last-modified", "content-encoding"]) headers.delete(header);
  headers.set("Cache-Control", "no-store");
  headers.set("X-Content-Type-Options", "nosniff");
  return new HTMLRewriter()
    .on('title, meta[name="description"], meta[property^="og:"], meta[name^="twitter:"], link[rel="canonical"]', { element(element) { element.remove(); } })
    .on("head", { element(element) { element.append(metadata, { html: true }); } })
    .on("body", { element(element) {
      const presentation = presentResult(result);
      element.prepend(`<main id="result-preview" style="max-width:760px;margin:40px auto;padding:24px;font-family:system-ui"><h1>${escapeHtml(presentation.title)} ${escapeHtml(presentation.headline)}</h1>${presentation.details.map(detail => `<p>${escapeHtml(detail)}</p>`).join("")}<p>${escapeHtml(result.playerName)} / ${escapeHtml(result.createdAt)}</p><p>プレイ終了時の記録です。リプレイ映像ではありません。</p><a href="/?game=${encodeURIComponent(result.gameId)}">自分も挑戦</a> · <a href="/">開催中のライブを見る</a></main>`, { html: true });
    } })
    .transform(new Response(shell.body, { status: 200, headers }));
}
