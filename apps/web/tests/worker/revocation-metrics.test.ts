import { expect, it, vi } from "vitest";
import { recordRevocation } from "../../src/worker/revocation-metrics";

it("does not let a telemetry failure interrupt session invalidation or leak details", () => {
  const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    expect(() => recordRevocation({ writeDataPoint() { throw Error("private bearer token"); } }, { rooms: 1, failed: 1, retries: 0, directoryFailed: false })).not.toThrow();
    expect(warning).toHaveBeenCalledExactlyOnceWith("session_revocation_metrics_failed");
    expect(() => recordRevocation(undefined, { rooms: 0, failed: 0, retries: 0, directoryFailed: false })).not.toThrow();
  } finally { warning.mockRestore(); }
});

it("records a successful revocation without falsely clearing another failed logout", () => {
  const writeDataPoint = vi.fn();
  recordRevocation({ writeDataPoint }, { rooms: 2, failed: 0, retries: 0, directoryFailed: false });
  expect(writeDataPoint.mock.calls[0]![0].doubles).toEqual([0, 0, 2, 0]);
});
