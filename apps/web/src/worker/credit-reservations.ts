export async function releaseCreditReservationForCabinet(
  database: D1Database,
  reservationId: string,
  cabinetId: string,
): Promise<boolean> {
  const reservation = await database.prepare(
    `SELECT r.id, r.play_session_id, r.status
     FROM credit_reservations r
     INNER JOIN play_sessions p ON p.id = r.play_session_id
     WHERE r.id = ? AND p.cabinet_id = ?`,
  ).bind(reservationId, cabinetId).first<{
    id: string;
    play_session_id: string;
    status: string;
  }>();

  if (!reservation || reservation.status !== "active") return false;

  await database.batch([
    database.prepare(
      `UPDATE credit_reservations
       SET status = 'released', updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND status = 'active'`,
    ).bind(reservationId),
    database.prepare(
      `UPDATE play_sessions
       SET status = 'cancelled', ended_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
    ).bind(reservation.play_session_id),
  ]);
  return true;
}
