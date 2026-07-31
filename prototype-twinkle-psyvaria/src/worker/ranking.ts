import type { RankingEntry } from "../domain/results";

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type",
};

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 50;
const MAX_NAME_LENGTH = 24;

interface RankingRequest {
  playerName?: unknown;
  clearTimeMs?: unknown;
  score?: unknown;
  maxLevel?: unknown;
  defeatedBossCount?: unknown;
  clientVersion?: unknown;
}

export async function handleRankingRequest(request: Request, db: D1Database): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === "OPTIONS") return new Response(null, { headers: JSON_HEADERS });
  if (request.method === "GET") return getRanking(url, db);
  if (request.method === "POST") return postRanking(request, db);
  return json({ error: "method_not_allowed" }, 405);
}

async function getRanking(url: URL, db: D1Database): Promise<Response> {
  const type = url.searchParams.get("type") === "score" ? "score" : "time";
  const limit = clamp(Number(url.searchParams.get("limit") || DEFAULT_LIMIT), 1, MAX_LIMIT);
  const clientVersion = url.searchParams.get("version")?.slice(0, 40);
  const orderBy = type === "score" ? "score DESC, clear_time_ms ASC" : "clear_time_ms ASC, score DESC";
  const query = clientVersion
    ? `SELECT player_name, clear_time_ms, score, max_level, created_at
       FROM rankings
       WHERE client_version = ?
       ORDER BY ${orderBy}
       LIMIT ?`
    : `SELECT player_name, clear_time_ms, score, max_level, created_at
       FROM rankings
       ORDER BY ${orderBy}
       LIMIT ?`;
  const statement = db.prepare(query);
  const rows = clientVersion
    ? await statement.bind(clientVersion, limit).all<RankingEntry>()
    : await statement.bind(limit).all<RankingEntry>();

  return json({ type, rankings: rows.results ?? [] });
}

async function postRanking(request: Request, db: D1Database): Promise<Response> {
  let body: RankingRequest;
  try {
    body = await request.json<RankingRequest>();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const playerName = sanitizeName(body.playerName);
  const clearTimeMs = Number(body.clearTimeMs);
  const score = Number(body.score);
  const maxLevel = Number(body.maxLevel);
  const defeatedBossCount = Number(body.defeatedBossCount ?? 3);
  const clientVersion = String(body.clientVersion || "dev").slice(0, 40);

  if (!playerName) return json({ error: "invalid_player_name" }, 400);
  if (!Number.isFinite(clearTimeMs) || clearTimeMs <= 0) return json({ error: "invalid_clear_time_ms" }, 400);
  if (!Number.isFinite(score) || score < 0) return json({ error: "invalid_score" }, 400);
  if (!Number.isFinite(maxLevel) || maxLevel < 1) return json({ error: "invalid_max_level" }, 400);

  const resultId = crypto.randomUUID();
  await db.batch([
    db
      .prepare(
        `INSERT INTO rankings (player_name, clear_time_ms, score, max_level, client_version)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .bind(playerName, Math.round(clearTimeMs), Math.round(score), Math.round(maxLevel), clientVersion),
    db
      .prepare(
        `INSERT INTO game_results (
          id, game_id, game_version, mode, player_name, cleared, clear_time_ms,
          score, max_level, defeated_boss_count
        ) VALUES (?, 'graze-duel', ?, 'solo', ?, 1, ?, ?, ?, ?)`,
      )
      .bind(
        resultId,
        clientVersion,
        playerName,
        Math.round(clearTimeMs),
        Math.round(score),
        Math.round(maxLevel),
        Math.max(0, Math.round(defeatedBossCount)),
      ),
  ]);

  return json({ ok: true, resultId });
}

function sanitizeName(value: unknown): string {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, MAX_NAME_LENGTH);
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}
