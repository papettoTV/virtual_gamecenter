export const operationFamilies = {
  start: ["solo_start", "versus_start"],
  login: ["google_login"],
  credit: ["welcome_credit", "registration_credit", "daily_credit"],
};

export function operationExpression(family, column) {
  if (!Object.hasOwn(operationFamilies, family) || !["double1", "double2"].includes(column)) throw Error("invalid_operation_aggregate");
  return `sum(if(blob6 = 'operation-${family}-v1', ${column} * "sampleInterval", 0.0))`;
}

export function operationReportQuery() {
  return `SELECT blob2 AS operation, blob5 AS game, sum(double1 * "sampleInterval") AS eligible, sum(double2 * "sampleInterval") AS failed, sum(double3 * "sampleInterval") AS succeeded, sum(double4 * "sampleInterval") AS rejected, sum(double5 * "sampleInterval") AS cancelled FROM events.analyticsEngine.pulbase_service_health WHERE accountTag = '60e5472a284dc71bbafbbfac8aa2a940' AND blob1 = 'staging' AND blob3 = 'operation-v1' AND timestamp >= NOW() - INTERVAL '20' MINUTE GROUP BY blob2, blob5 LIMIT 64`;
}

export function operationMonthWindow(now = new Date()) {
  const timestamp = now.getTime();
  if (!Number.isFinite(timestamp) || now.getUTCFullYear() < 2000 || now.getUTCFullYear() > 2100) throw Error("invalid_operation_month");
  const japan = new Date(timestamp + 9 * 60 * 60 * 1000);
  const start = Date.UTC(japan.getUTCFullYear(), japan.getUTCMonth(), 1) - 9 * 60 * 60 * 1000;
  const end = Math.max(start, Math.floor((timestamp - 5 * 60 * 1000) / 1000) * 1000);
  return { month: japan.toISOString().slice(0, 7), timeZone: "Asia/Tokyo",
    from: new Date(start).toISOString(), to: new Date(end).toISOString(), ingestionDelayMinutes: 5 };
}

export function monthlyOperationReportQuery(now = new Date()) {
  const window = operationMonthWindow(now);
  return `SELECT blob2 AS operation, blob5 AS game, sum(double1 * "sampleInterval") AS eligible, sum(double2 * "sampleInterval") AS failed, sum(double3 * "sampleInterval") AS succeeded, sum(double4 * "sampleInterval") AS rejected, sum(double5 * "sampleInterval") AS cancelled FROM events.analyticsEngine.pulbase_service_health WHERE accountTag = '60e5472a284dc71bbafbbfac8aa2a940' AND blob1 = 'staging' AND blob3 = 'operation-v1' AND blob7 != 'operation-drill-v1' AND timestamp >= '${window.from}' AND timestamp < '${window.to}' GROUP BY blob2, blob5 LIMIT 64`;
}

export function summarizeMonthlyOperations(rows) {
  return Object.fromEntries(Object.entries(summarizeOperations(rows)).map(([key, value]) => {
    const successRate = value.eligible ? value.succeeded / value.eligible : null;
    const target = key === "start" ? 0.98 : null;
    return [key, { eligible: value.eligible, succeeded: value.succeeded, failed: value.failed,
      rejected: value.rejected, cancelled: value.cancelled, successRate, target,
      targetGap: successRate === null || target === null ? null : successRate - target,
      assessment: successRate === null ? "no_eligible_data" : target === null ? "target_not_set"
        : value.succeeded * 100 >= value.eligible * 98 ? "at_or_above_reference" : "below_reference" }];
  }));
}

export function summarizeOperations(rows) {
  if (!Array.isArray(rows) || rows.length >= 64) throw Error("invalid_operation_report");
  const families = Object.fromEntries(Object.keys(operationFamilies).map(key => [key, { eligible: 0, failed: 0, succeeded: 0, rejected: 0, cancelled: 0 }]));
  for (const row of rows) {
    const family = Object.keys(operationFamilies).find(key => operationFamilies[key].includes(row.operation));
    if (!family) throw Error("invalid_operation_report");
    for (const key of ["eligible", "failed", "succeeded", "rejected", "cancelled"]) {
      const value = Number(row[key]);
      if (!Number.isFinite(value) || value < 0) throw Error("invalid_operation_report");
      families[family][key] += value;
    }
    if (Number(row.failed) + Number(row.succeeded) !== Number(row.eligible)) throw Error("inconsistent_operation_report");
  }
  return Object.fromEntries(Object.entries(families).map(([key, value]) => [key, { ...value,
    failureRate: value.eligible ? value.failed / value.eligible : null,
    warning: value.failed >= 3 && value.failed * 5 >= value.eligible,
    traffic: value.eligible ? "observed" : "no_eligible_data",
  }]));
}
