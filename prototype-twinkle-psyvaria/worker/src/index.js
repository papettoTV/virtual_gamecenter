const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type",
};

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 50;
const MAX_NAME_LENGTH = 24;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: JSON_HEADERS });
    }

    if (url.pathname === "/api/ranking" && request.method === "GET") {
      return getRanking(url, env);
    }

    if (url.pathname === "/api/ranking" && request.method === "POST") {
      return postRanking(request, env);
    }

    return json({ error: "not_found" }, 404);
  },
};

async function getRanking(url, env) {
  const type = url.searchParams.get("type") === "score" ? "score" : "time";
  const limit = clamp(Number(url.searchParams.get("limit") || DEFAULT_LIMIT), 1, MAX_LIMIT);
  const orderBy = type === "score" ? "score DESC, clear_time_ms ASC" : "clear_time_ms ASC, score DESC";

  const rows = await env.DB.prepare(
    `SELECT player_name, clear_time_ms, score, max_level, created_at
     FROM rankings
     ORDER BY ${orderBy}
     LIMIT ?`,
  )
    .bind(limit)
    .all();

  return json({ type, rankings: rows.results ?? [] });
}

async function postRanking(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const playerName = sanitizeName(body.playerName);
  const clearTimeMs = Number(body.clearTimeMs);
  const score = Number(body.score);
  const maxLevel = Number(body.maxLevel);
  const clientVersion = String(body.clientVersion || "dev").slice(0, 40);

  if (!playerName) return json({ error: "invalid_player_name" }, 400);
  if (!Number.isFinite(clearTimeMs) || clearTimeMs <= 0) return json({ error: "invalid_clear_time_ms" }, 400);
  if (!Number.isFinite(score) || score < 0) return json({ error: "invalid_score" }, 400);
  if (!Number.isFinite(maxLevel) || maxLevel < 1) return json({ error: "invalid_max_level" }, 400);

  await env.DB.prepare(
    `INSERT INTO rankings (player_name, clear_time_ms, score, max_level, client_version)
     VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(playerName, Math.round(clearTimeMs), Math.round(score), Math.round(maxLevel), clientVersion)
    .run();

  return json({ ok: true });
}

function sanitizeName(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, MAX_NAME_LENGTH);
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}
