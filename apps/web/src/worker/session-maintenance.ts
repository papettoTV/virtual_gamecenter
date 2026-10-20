export async function activateSessionSweeps(
  database: D1Database,
  rooms: { getByName(name: string): { activateSessionSweep(): Promise<void> } },
  cursor = "",
): Promise<{ visited: number; next: string | null }> {
  if (typeof cursor !== "string" || !/^[a-zA-Z0-9-]{0,128}$/.test(cursor)) throw Error("invalid_sweep_cursor");
  const rows = await database.prepare(
    "SELECT DISTINCT cabinet_id FROM player_cabinets WHERE cabinet_id > ? ORDER BY cabinet_id LIMIT 50",
  ).bind(cursor).all<{ cabinet_id: string }>();
  const results = await Promise.allSettled(rows.results.map(row => rooms.getByName(row.cabinet_id).activateSessionSweep()));
  if (results.some(result => result.status === "rejected")) throw Error("sweep_activation_incomplete");
  return { visited: rows.results.length, next: rows.results.length === 50 ? rows.results.at(-1)!.cabinet_id : null };
}
