import type { CabinetState } from "../domain/cabinet";

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};

export interface CabinetDirectoryEntry {
  cabinetId: string;
  gameId: string;
  status: CabinetState["status"];
  playerCount: number;
  spectatorCount: number;
  updatedAt: number;
}

interface CabinetDirectoryRow {
  cabinet_id: string;
  game_id: string;
  status: CabinetState["status"];
  player_count: number;
  spectator_count: number;
  updated_at: number;
}

export async function handleCabinetDirectoryRequest(
  request: Request,
  db: D1Database,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== "/api/cabinets") return null;
  if (request.method !== "GET") {
    return Response.json({ error: "method_not_allowed" }, { status: 405, headers: JSON_HEADERS });
  }

  const gameId = url.searchParams.get("gameId") || "graze-duel";
  const rows = await db
    .prepare(
      `SELECT cabinet_id, game_id, status, player_count, spectator_count, updated_at
       FROM cabinet_directory
       WHERE game_id = ? AND player_count > 0
       ORDER BY spectator_count DESC, updated_at DESC`,
    )
    .bind(gameId)
    .all<CabinetDirectoryRow>();

  const cabinets: CabinetDirectoryEntry[] = (rows.results ?? []).map((row) => ({
    cabinetId: row.cabinet_id,
    gameId: row.game_id,
    status: row.status,
    playerCount: row.player_count,
    spectatorCount: row.spectator_count,
    updatedAt: row.updated_at,
  }));

  return Response.json({ cabinets }, { headers: JSON_HEADERS });
}

export async function syncCabinetDirectory(
  db: D1Database,
  state: CabinetState,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO cabinet_directory (
         cabinet_id, game_id, status, player_count, spectator_count, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(cabinet_id) DO UPDATE SET
         game_id = excluded.game_id,
         status = excluded.status,
         player_count = excluded.player_count,
         spectator_count = excluded.spectator_count,
         updated_at = excluded.updated_at`,
    )
    .bind(
      state.cabinetId,
      state.gameId,
      state.status,
      state.playerCount,
      state.spectatorCount,
      state.updatedAt,
    )
    .run();
}
