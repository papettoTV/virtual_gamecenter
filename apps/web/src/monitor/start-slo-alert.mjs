import { RECEIPT_DRILL_MARKER, startReceiptTarget } from "./start-slo-drill.mjs";

export function startReceiptExpression(column) {
  if (!["double1", "double4"].includes(column)) throw Error("invalid_start_receipt_column");
  return `argMax(${column}, if(blob3 = 'start-receipt-v1', double4, 0.0))`;
}

export async function collectStartAlert(database, now = Date.now()) {
  if (!Number.isSafeInteger(now) || now <= 0) throw Error("invalid_start_alert_time");
  const to = Math.floor(now / 60000) * 60000, from = to - 1200000;
  const results = await database.batch([
    database.prepare(`SELECT COALESCE(SUM(requested), 0) AS requested, COALESCE(SUM(rejected), 0) AS rejected,
      COALESCE(SUM(missing_response), 0) AS missing FROM start_slo_alert_buckets WHERE bucket_ms >= ? AND bucket_ms < ?`).bind(from, to),
    database.prepare("SELECT COUNT(*) AS expired FROM start_slo_attempts WHERE outcome = 'pending' AND deadline_ms >= ? AND deadline_ms < ?").bind(from, to),
    database.prepare("SELECT started_ms FROM start_slo_alert_config WHERE id = 1"),
  ]);
  const counts = results[0]?.results?.[0], pending = results[1]?.results?.[0], config = results[2]?.results?.[0];
  if (!counts || !pending || !config || ![counts.requested, counts.rejected, counts.missing, pending.expired, config.started_ms]
    .every(value => Number.isSafeInteger(value) && value >= 0) || config.started_ms > now) throw Error("invalid_start_alert_counts");
  const eligible = counts.requested - counts.rejected, missing = counts.missing + pending.expired;
  if (eligible < 0 || missing > eligible) throw Error("inconsistent_start_alert_counts");
  return { from, to, eligible, missing, code: missing >= 3 && missing * 5 >= eligible ? 9 : 0, complete: config.started_ms <= from };
}

export async function recordStartAlert(env, now = Date.now()) {
  let point, target;
  try {
    target = startReceiptTarget(env, now);
    const result = await collectStartAlert(target.database, now);
    point = { indexes: ["staging-start-receipt"], blobs: ["staging", result.complete ? "ok" : "warmup", "start-receipt-v1"],
      doubles: [result.code, result.eligible, result.missing, now / 1000, result.complete ? 1 : 0] };
  } catch {
    point = { indexes: ["staging-start-receipt"], blobs: ["staging", "error", "start-receipt-v1"], doubles: [10, 0, 0, now / 1000, 0] };
    console.warn("start_receipt_collection_failed");
  }
  if (target?.configured) point.blobs.push(RECEIPT_DRILL_MARKER, target.fault ? "fault" : "expired");
  env.HEALTH_EVENTS.writeDataPoint(point);
  return point;
}
