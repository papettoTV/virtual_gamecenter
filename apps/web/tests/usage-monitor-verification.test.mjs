import test from "node:test";
import assert from "node:assert/strict";
import { verifyMonitoringRecords } from "../scripts/verify-usage-monitor.mjs";

const now = Date.parse("2026-10-14T11:10:00Z");
function records() {
  return [0, 1, 2, 3].map(index => ({
    blob2: "ok", double10: 0.5, double12: (Date.parse("2026-10-14T11:00:14Z") - index * 900_000) / 1000,
    ...Object.fromEntries(Array.from({ length: 9 }, (_, metric) => [`double${metric + 1}`, 10])),
  }));
}
test("4回の正常な15分実行を確認する", () => assert.equal(verifyMonitoringRecords(records().reverse(), now).consecutiveSnapshots, 4));
test("空データや単発の手動成功だけでは完了扱いにしない", () => {
  for (const sample of [undefined, [], records().slice(0, 1)]) assert.throws(() => verifyMonitoringRecords(sample, now));
});
test("取得失敗や欠落した指標を拒否する", () => {
  const failed = records(); failed[1].blob2 = "error";
  assert.throws(() => verifyMonitoringRecords(failed, now));
  const missing = records(); delete missing[1].double5;
  assert.throws(() => verifyMonitoringRecords(missing, now));
});
test("停止と未来のタイムスタンプを拒否する", () => {
  assert.throws(() => verifyMonitoringRecords(records(), now + 3600_000));
  assert.throws(() => verifyMonitoringRecords(records(), now - 3600_000));
});
test("実行の欠落と重複を拒否する", () => {
  const gap = records(); gap[3].double12 -= 900;
  assert.throws(() => verifyMonitoringRecords(gap, now));
  const duplicate = records(); duplicate[2].double12 = duplicate[1].double12;
  assert.throws(() => verifyMonitoringRecords(duplicate, now));
});
test("予定時刻から大きく離れた手動試験を拒否する", () => {
  const manual = records().map(row => ({ ...row, double12: row.double12 + 240 }));
  assert.throws(() => verifyMonitoringRecords(manual, now));
});
