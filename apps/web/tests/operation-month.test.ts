import { expect, it } from "vitest";
import { operationMonthWindow, monthlyOperationReportQuery, summarizeMonthlyOperations } from "../src/shared/operation-report.mjs";

it.each([
  ["2026-10-31T14:59:59Z", "2026-10", "2026-09-30T15:00:00.000Z", "2026-10-31T14:54:59.000Z"],
  ["2026-10-31T15:00:00Z", "2026-11", "2026-10-31T15:00:00.000Z", "2026-10-31T15:00:00.000Z"],
  ["2026-12-31T15:06:00Z", "2027-01", "2026-12-31T15:00:00.000Z", "2026-12-31T15:01:00.000Z"],
  ["2028-02-29T15:10:00Z", "2028-03", "2028-02-29T15:00:00.000Z", "2028-02-29T15:05:00.000Z"],
])("uses Japanese calendar boundaries and a five-minute ingestion margin: %s", (timestamp, month, from, to) => {
  expect(operationMonthWindow(new Date(timestamp))).toEqual({ month, from, to, timeZone: "Asia/Tokyo", ingestionDelayMinutes: 5 });
});

it("allows only generated UTC dates and fixed staging data, with drills excluded", () => {
  const query = monthlyOperationReportQuery(new Date("2026-10-21T00:00:00Z"));
  expect(query).toContain("timestamp >= '2026-09-30T15:00:00.000Z'");
  expect(query).toContain("timestamp < '2026-10-20T23:55:00.000Z'");
  expect(query).toContain("blob1 = 'staging'");
  expect(query).toContain("blob7 != 'operation-drill-v1'");
  expect(query).toContain('sum(double1 * "sampleInterval")');
  expect(query).toContain("blob3 = 'operation-v1'");
  expect(query).toMatch(/LIMIT 64$/);
  expect(() => monthlyOperationReportQuery(new Date("invalid"))).toThrow("invalid_operation_month");
});

it.each([[98, 2, "at_or_above_reference"], [97, 3, "below_reference"], [100, 0, "at_or_above_reference"]])(
  "compares estimated success against 98 percent without counting refusals: %s", (succeeded, failed, assessment) => {
    const result = summarizeMonthlyOperations([{ operation: "solo_start", eligible: 100, succeeded, failed, rejected: 999, cancelled: 888 }]);
    expect(result.start).toMatchObject({ successRate: succeeded / 100, target: 0.98, assessment });
    expect(result.start!.targetGap).toBeCloseTo(succeeded / 100 - 0.98);
  });

it("does not invent data, targets or successful monthly SLO assessments", () => {
  const empty = summarizeMonthlyOperations([]);
  expect(empty.start).toMatchObject({ successRate: null, targetGap: null, assessment: "no_eligible_data" });
  const result = summarizeMonthlyOperations([{ operation: "google_login", eligible: "10", succeeded: "9", failed: "1", rejected: 0, cancelled: 5 }]);
  expect(result.login).toMatchObject({ successRate: 0.9, target: null, targetGap: null, assessment: "target_not_set" });
  expect(() => summarizeMonthlyOperations([{ operation: "solo_start", eligible: 99, succeeded: 98, failed: 2, rejected: 0, cancelled: 0 }])).toThrow();
  expect(() => summarizeMonthlyOperations(Array(64).fill({}))).toThrow();
});
