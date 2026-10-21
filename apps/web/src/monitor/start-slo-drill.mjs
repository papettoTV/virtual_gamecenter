export const RECEIPT_DRILL_MARKER = "start-receipt-d1-drill-v1";
export const RECEIPT_DRILL_DURATION = 1200000;
export const RECEIPT_DRILL_DATABASE = "9787b59a-a5cb-46f2-b10d-26a0ab679493";

export function startReceiptTarget(env, now) {
  const values = [env.START_SLO_DRILL_KIND, env.START_SLO_DRILL_STARTED_MS, env.START_SLO_DRILL_UNTIL_MS];
  if (values.every(value => value === undefined)) return { database: env.START_SLO_DB, configured: false, fault: false };
  const started = Number(env.START_SLO_DRILL_STARTED_MS), until = Number(env.START_SLO_DRILL_UNTIL_MS);
  if (env.MONITOR_ENVIRONMENT !== "staging" || env.START_SLO_DRILL_KIND !== RECEIPT_DRILL_MARKER
    || !Number.isSafeInteger(now) || !Number.isSafeInteger(started) || !Number.isSafeInteger(until)
    || started <= 0 || started > now || until - started !== RECEIPT_DRILL_DURATION) throw Error("invalid_start_receipt_drill");
  const fault = now < until;
  if (fault && !env.START_SLO_DRILL_DB) throw Error("start_receipt_drill_binding_missing");
  return { database: fault ? env.START_SLO_DRILL_DB : env.START_SLO_DB, configured: true, fault };
}
