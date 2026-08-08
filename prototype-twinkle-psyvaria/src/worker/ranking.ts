import type { RankingEntry } from "../domain/results";
import { getPlayerIdentity } from "./platform";
import { DEFAULT_GAME_ID, getGameDefinition } from "../domain/game";

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type",
};

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 50;
interface RankingRequest {
  gameId?: unknown;
  elapsedTimeMs?: unknown;
  clearTimeMs?: unknown;
  cleared?: unknown;
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
  const game = getGameDefinition(url.searchParams.get("gameId") ?? DEFAULT_GAME_ID);
  if (!game) return json({ error: "unknown_game" }, 404);
  const limit = clamp(Number(url.searchParams.get("limit") || DEFAULT_LIMIT), 1, MAX_LIMIT);
  const clientVersion = url.searchParams.get("version")?.slice(0, 40);
  const orderBy = type === "score"
    ? "score DESC, cleared DESC, clear_time_ms ASC"
    : "cleared DESC, clear_time_ms ASC, score DESC";
  const query = clientVersion
    ? `SELECT player_name, clear_time_ms AS play_time_ms, cleared, score, max_level,
              defeated_boss_count, created_at
       FROM rankings
       WHERE game_id = ? AND client_version = ?
       ORDER BY ${orderBy}
       LIMIT ?`
    : `SELECT player_name, clear_time_ms AS play_time_ms, cleared, score, max_level,
              defeated_boss_count, created_at
       FROM rankings
       WHERE game_id = ?
       ORDER BY ${orderBy}
       LIMIT ?`;
  const statement = db.prepare(query);
  const rows = clientVersion
    ? await statement.bind(game.id, clientVersion, limit).all<RankingEntry>()
    : await statement.bind(game.id, limit).all<RankingEntry>();

  return json({ type, rankings: rows.results ?? [] });
}

async function postRanking(request: Request, db: D1Database): Promise<Response> {
  const identity = await getPlayerIdentity(request, db);
  if (!identity) return json({ error: "player_session_required" }, 401);

  let body: RankingRequest;
  try {
    body = await request.json<RankingRequest>();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const playerName = identity.playerName;
  const game = getGameDefinition(String(body.gameId || DEFAULT_GAME_ID));
  if (!game) return json({ error: "unknown_game" }, 404);
  const elapsedTimeMs = Number(body.elapsedTimeMs ?? body.clearTimeMs);
  const cleared = body.cleared !== false;
  const score = Number(body.score);
  const maxLevel = Number(body.maxLevel);
  const defeatedBossCount = Number(body.defeatedBossCount ?? 3);
  const clientVersion = String(body.clientVersion || "dev").slice(0, 40);

  if (!Number.isFinite(elapsedTimeMs) || elapsedTimeMs <= 0) return json({ error: "invalid_elapsed_time_ms" }, 400);
  if (!Number.isFinite(score) || score < 0) return json({ error: "invalid_score" }, 400);
  if (!Number.isFinite(maxLevel) || maxLevel < 1) return json({ error: "invalid_max_level" }, 400);

  const resultId = crypto.randomUUID();
  await db.batch([
    db
      .prepare(
        `INSERT INTO rankings (
          game_id, player_name, clear_time_ms, cleared, score, max_level, defeated_boss_count, client_version
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        game.id,
        playerName,
        Math.round(elapsedTimeMs),
        cleared ? 1 : 0,
        Math.round(score),
        Math.round(maxLevel),
        Math.max(0, Math.round(defeatedBossCount)),
        clientVersion,
      ),
    db
      .prepare(
        `INSERT INTO game_results (
          id, game_id, game_version, mode, player_id, player_name, cleared, clear_time_ms,
          score, max_level, defeated_boss_count
        ) VALUES (?, ?, ?, 'solo', ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        resultId,
        game.id,
        clientVersion,
        identity.playerId,
        playerName,
        cleared ? 1 : 0,
        cleared ? Math.round(elapsedTimeMs) : null,
        Math.round(score),
        Math.round(maxLevel),
        Math.max(0, Math.round(defeatedBossCount)),
      ),
  ]);

  return json({ ok: true, resultId });
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}
