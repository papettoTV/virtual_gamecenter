import { getGameDefinition } from "../domain/game";

export async function validatePlayReservation(database: D1Database, reservationId: unknown, playerId: string | undefined, cabinetId: string, gameId: string, mode: string, status: "active" | "captured", usageId?: string, sessionHash?: string): Promise<boolean> {
  const game = getGameDefinition(gameId);
  if (!game || game.status !== "active" || !playerId || typeof reservationId !== "string" || !reservationId) return false;
  const query = `SELECT r.id FROM credit_reservations r JOIN play_sessions p ON p.id = r.play_session_id
    WHERE r.id = ? AND r.player_id = ? AND p.host_player_id = r.player_id AND r.status = ?
      AND p.cabinet_id = ? AND p.game_id = ? AND p.mode = ? AND r.amount = ?
      AND datetime(r.expires_at) > CURRENT_TIMESTAMP
      AND NOT EXISTS (SELECT 1 FROM credit_reservation_uses u WHERE u.reservation_id = r.id)
      AND (? = 'active' OR EXISTS (SELECT 1 FROM credit_ledger_entries e WHERE e.id = 'consume:' || r.id AND e.player_id = r.player_id AND e.amount = -r.amount AND e.entry_type = 'consumed' AND e.balance_type = r.balance_type AND e.play_session_id = p.id AND e.reference_id = r.id))
      ${sessionHash ? `AND EXISTS (SELECT 1 FROM player_sessions session_entry JOIN players owner ON owner.id = session_entry.player_id WHERE session_entry.token_hash = ? AND session_entry.player_id = r.player_id AND datetime(session_entry.expires_at) > CURRENT_TIMESTAMP AND owner.deletion_requested_at IS NULL)` : ""}`;
  const values = [reservationId, playerId, status, cabinetId, gameId, mode, game.creditCost, status];
  if (sessionHash) values.push(sessionHash);
  if (!usageId) return Boolean(await database.prepare(query).bind(...values).first());
  const result = await database.prepare(`INSERT OR IGNORE INTO credit_reservation_uses (reservation_id, usage_id) SELECT id, ? FROM (${query})`)
    .bind(usageId, ...values).run();
  return result.meta.changes === 1;
}

export async function releaseCreditReservationForCabinet(
  database: D1Database,
  reservationId: string,
  cabinetId: string,
  playerId?: string,
): Promise<boolean> {
  const reservation = await database.prepare(
    `SELECT r.id, r.play_session_id, r.status
     FROM credit_reservations r
     INNER JOIN play_sessions p ON p.id = r.play_session_id
     WHERE r.id = ? AND p.cabinet_id = ? AND (? IS NULL OR r.player_id = ?)`,
  ).bind(reservationId, cabinetId, playerId ?? null, playerId ?? null).first<{
    id: string;
    play_session_id: string;
    status: string;
  }>();

  if (!reservation) return false;
  if (reservation.status === "captured") {
    await refundUnusedCapture(database, reservationId);
    return (await database.prepare("SELECT status FROM credit_reservations WHERE id = ?").bind(reservationId).first<{ status: string }>())?.status === "released";
  }
  if (reservation.status !== "active") return false;

  await database.batch([
    database.prepare(
      `UPDATE credit_reservations
       SET status = 'released', updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND status = 'active'`,
    ).bind(reservationId),
    database.prepare(
      `UPDATE play_sessions
       SET status = 'cancelled', ended_at = CURRENT_TIMESTAMP
       WHERE id = ? AND EXISTS (SELECT 1 FROM credit_reservations WHERE id = ? AND status = 'released')`,
    ).bind(reservation.play_session_id, reservationId),
  ]);
  return true;
}

export async function refundUnusedCapture(database: D1Database, reservationId: string): Promise<void> {
  await database.batch([
    database.prepare(`INSERT OR IGNORE INTO credit_ledger_entries (id, player_id, balance_type, entry_type, amount, play_session_id, reference_id)
      SELECT 'refund-start:' || id, player_id, balance_type, 'refunded', amount, play_session_id, id FROM credit_reservations
      WHERE id = ? AND status = 'captured' AND NOT EXISTS (SELECT 1 FROM credit_reservation_uses WHERE reservation_id = credit_reservations.id)`)
      .bind(reservationId),
    database.prepare(`UPDATE credit_reservations SET status = 'released', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'captured'
      AND EXISTS (SELECT 1 FROM credit_ledger_entries WHERE id = 'refund-start:' || credit_reservations.id)`).bind(reservationId),
    database.prepare(`UPDATE play_sessions SET status = 'cancelled', ended_at = CURRENT_TIMESTAMP WHERE id = (SELECT play_session_id FROM credit_reservations WHERE id = ? AND status = 'released')`).bind(reservationId),
  ]);
}

export async function recoverExpiredUnusedCaptures(database: D1Database, playerId: string): Promise<void> {
  const reservations = await database.prepare(`SELECT r.id FROM credit_reservations r
    JOIN play_sessions p ON p.id = r.play_session_id
    WHERE r.player_id = ? AND p.host_player_id = r.player_id AND p.mode = 'solo'
      AND r.status = 'captured' AND datetime(r.expires_at) <= CURRENT_TIMESTAMP
      AND NOT EXISTS (SELECT 1 FROM credit_reservation_uses u WHERE u.reservation_id = r.id)
      AND EXISTS (SELECT 1 FROM credit_ledger_entries e WHERE e.id = 'consume:' || r.id
        AND e.player_id = r.player_id AND e.amount = -r.amount AND e.entry_type = 'consumed'
        AND e.balance_type = r.balance_type AND e.play_session_id = p.id AND e.reference_id = r.id)
    ORDER BY r.expires_at, r.id LIMIT 20`).bind(playerId).all<{ id: string }>();
  for (const reservation of reservations.results) await refundUnusedCapture(database, reservation.id);
}
