export interface StartReceipt { attemptId: string; token: string }
interface Counts { requested: number; allowed: number; succeeded: number; missing_response: number; rejected: number }

export async function beginStartAttempt(database: D1Database, reservationId: string, playerId: string, now = Date.now()): Promise<void> {
  await database.batch([
    database.prepare(`INSERT OR IGNORE INTO start_slo_attempts (reservation_id, day, created_ms, deadline_ms, receipt_token, expected)
      SELECT r.id, strftime('%Y-%m-%d', ? / 1000, 'unixepoch', '+9 hours'), ?, ? + CASE p.mode WHEN 'solo' THEN 5000 ELSE 30000 END, ?, CASE p.mode WHEN 'solo' THEN 1 ELSE 2 END
      FROM credit_reservations r JOIN play_sessions p ON p.id = r.play_session_id
      WHERE r.id = ? AND r.player_id = ? AND r.status = 'active' AND datetime(r.expires_at) > CURRENT_TIMESTAMP`)
      .bind(now, now, now, crypto.randomUUID(), reservationId, playerId),
    database.prepare(`UPDATE start_slo_config SET coverage_started_ms = ?
      WHERE id = 1 AND coverage_started_ms IS NULL AND EXISTS (SELECT 1 FROM start_slo_attempts WHERE reservation_id = ?)`).bind(now, reservationId),
  ]);
}

export async function allowStartReceipt(database: D1Database, reservationId: string, expected: number, now = Date.now()): Promise<StartReceipt | undefined> {
  const row = await database.prepare(`UPDATE start_slo_attempts SET allowed_ms = COALESCE(allowed_ms, ?)
    WHERE reservation_id = ? AND outcome = 'pending' AND expected = ? AND deadline_ms >= ?
    RETURNING receipt_token`).bind(now, reservationId, expected, now).first<{ receipt_token: string }>();
  return row ? { attemptId: reservationId, token: row.receipt_token } : undefined;
}

export async function acknowledgeStart(database: D1Database, receipt: StartReceipt, seat: 1 | 2, now = Date.now()): Promise<void> {
  await database.prepare(`UPDATE start_slo_attempts
    SET receipt_one = CASE WHEN ? = 1 THEN 1 ELSE receipt_one END,
        receipt_two = CASE WHEN ? = 2 THEN 1 ELSE receipt_two END,
        outcome = CASE WHEN (receipt_one = 1 OR ? = 1) AND (expected = 1 OR receipt_two = 1 OR ? = 2) THEN 'success' ELSE 'pending' END
    WHERE reservation_id = ? AND receipt_token = ? AND allowed_ms IS NOT NULL AND outcome = 'pending' AND deadline_ms >= ? AND ? <= expected`)
    .bind(seat, seat, seat, seat, receipt.attemptId, receipt.token, now, seat).run();
}

export async function rejectStartAttempt(database: D1Database, reservationId: string, playerId: string): Promise<void> {
  await database.prepare(`UPDATE start_slo_attempts SET outcome = 'rejected' WHERE reservation_id = ? AND outcome = 'pending' AND allowed_ms IS NULL
    AND EXISTS (SELECT 1 FROM credit_reservations WHERE id = ? AND player_id = ?)`).bind(reservationId, reservationId, playerId).run();
}

export async function settleStartAttempts(database: D1Database, now = Date.now()): Promise<void> {
  await database.batch([
    database.prepare("UPDATE start_slo_attempts SET outcome = 'missing_response' WHERE outcome = 'pending' AND deadline_ms < ?").bind(now),
    database.prepare("DELETE FROM start_slo_attempts WHERE outcome <> 'pending' AND deadline_ms < ?").bind(now - 2 * 86400_000),
    database.prepare("DELETE FROM start_slo_daily WHERE day < strftime('%Y-%m-%d', ? / 1000, 'unixepoch', '+9 hours')").bind(now - 400 * 86400_000),
    database.prepare("DELETE FROM start_slo_coverage WHERE slot_ms < ?").bind(now - 400 * 86400_000),
  ]);
}

export async function recordStartSloCoverage(database: D1Database, scheduledMs: number, now = Date.now()): Promise<void> {
  const scheduled = Math.round(scheduledMs < 100_000_000_000 ? scheduledMs * 1000 : scheduledMs);
  const slot = Math.floor(scheduled / 900000) * 900000;
  if (!Number.isSafeInteger(scheduled) || scheduled <= 0 || now < scheduled || now - slot > 600_000) throw Error("invalid_start_slo_checkpoint");
  await database.prepare("INSERT OR IGNORE INTO start_slo_coverage(slot_ms) VALUES (?)").bind(slot).run();
}

export function startSloPeriods(now = Date.now()) {
  const japan = new Date(now + 9 * 3600_000);
  if (!Number.isFinite(now) || japan.getUTCFullYear() < 2000 || japan.getUTCFullYear() > 2100) throw Error("invalid_slo_time");
  return [0, -1].map(offset => {
    const from = Date.UTC(japan.getUTCFullYear(), japan.getUTCMonth() + offset, 1) - 9 * 3600_000;
    const to = Date.UTC(japan.getUTCFullYear(), japan.getUTCMonth() + offset + 1, 1) - 9 * 3600_000;
    return { month: new Date(from + 9 * 3600_000).toISOString().slice(0, 7), from, to };
  });
}

export function assessStartSlo(counts: Counts, expired: number, coverage: number | null, period: { from: number; to: number }, now: number, checkpoints: number) {
  for (const value of [...Object.values(counts), expired, checkpoints]) if (!Number.isSafeInteger(value) || value < 0) throw Error("invalid_start_slo_counts");
  const missing = counts.missing_response + expired, eligible = counts.requested - counts.rejected;
  const pending = eligible - counts.succeeded - missing;
  if (pending < 0 || counts.allowed > counts.requested || counts.succeeded > counts.allowed) throw Error("inconsistent_start_slo_counts");
  const rate = eligible ? counts.succeeded / eligible : null;
  const assessment = coverage === null ? "not_instrumented" : coverage > period.from ? "insufficient_coverage"
    : now < period.to + 600000 ? "collecting" : pending ? "unresolved" : checkpoints !== (period.to - period.from) / 900000 ? "coverage_gap" : !eligible ? "no_data"
    : counts.succeeded * 100 >= eligible * 98 ? "passed" : "failed";
  return { ...counts, missing_response: missing, eligible, pending, successRate: rate, target: 0.98, assessment,
    checkpoints, expectedCheckpoints: (period.to - period.from) / 900000 };
}

export async function collectStartSloReport(database: D1Database, now = Date.now()) {
  const periods = startSloPeriods(now), fromDay = periods[1]!.month + "-01";
  const results = await database.batch([
    database.prepare("SELECT coverage_started_ms FROM start_slo_config WHERE id = 1"),
    database.prepare(`SELECT substr(day, 1, 7) AS month, SUM(requested) AS requested, SUM(allowed) AS allowed, SUM(succeeded) AS succeeded,
      SUM(missing_response) AS missing_response, SUM(rejected) AS rejected FROM start_slo_daily WHERE day >= ? GROUP BY substr(day, 1, 7) LIMIT 4`).bind(fromDay),
    database.prepare(`SELECT substr(day, 1, 7) AS month, COUNT(*) AS expired FROM start_slo_attempts WHERE outcome = 'pending' AND deadline_ms < ? AND day >= ?
      GROUP BY substr(day, 1, 7) LIMIT 4`).bind(now, fromDay),
    ...periods.map(period => database.prepare("SELECT COUNT(*) AS checkpoints FROM start_slo_coverage WHERE slot_ms > ? AND slot_ms <= ?").bind(period.from, period.to)),
  ]);
  const config = results[0]!.results[0] as { coverage_started_ms: number | null } | undefined;
  if (!config || results[1]!.results.length > 2 || results[2]!.results.length > 2) throw Error("invalid_start_slo_report");
  const coverage = config.coverage_started_ms;
  if (coverage !== null && (!Number.isSafeInteger(coverage) || coverage > now)) throw Error("invalid_start_slo_coverage");
  const rows = results[1]!.results as Array<Counts & { month: string }>;
  const expired = results[2]!.results as Array<{ month: string; expired: number }>;
  if ([...rows, ...expired].some(row => !periods.some(period => period.month === row.month))) throw Error("invalid_start_slo_period");
  return { checkedAt: new Date(now).toISOString(), source: "d1-exact-v1", coverageStartedAt: coverage === null ? null : new Date(coverage).toISOString(),
    boundary: "accepted_credit_capture_to_permission_receipt", periods: periods.map((period, index) => {
      const row = rows.find(row => row.month === period.month);
      const counts = row ? { requested: row.requested, allowed: row.allowed, succeeded: row.succeeded, missing_response: row.missing_response, rejected: row.rejected }
        : { requested: 0, allowed: 0, succeeded: 0, missing_response: 0, rejected: 0 };
      return { month: period.month, from: new Date(period.from).toISOString(), to: new Date(period.to).toISOString(),
        ...assessStartSlo(counts, expired.find(row => row.month === period.month)?.expired ?? 0, coverage, period, now,
          (results[3 + index]!.results[0] as { checkpoints: number }).checkpoints) };
    }) };
}
