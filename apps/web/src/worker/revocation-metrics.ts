export interface RevocationSummary {
  rooms: number;
  failed: number;
  retries: number;
  directoryFailed: boolean;
}

export function recordRevocation(
  metrics: Pick<AnalyticsEngineDataset, "writeDataPoint"> | undefined,
  summary: RevocationSummary,
): void {
  if (!metrics) return;
  try {
    metrics.writeDataPoint({
      indexes: ["staging-revocation"],
      blobs: ["staging", summary.directoryFailed ? "directory" : "rooms", "revocation-v1"],
      doubles: [summary.directoryFailed || summary.failed > 0 ? 1 : 0, summary.failed, summary.rooms, summary.retries],
    });
  } catch {
    console.warn("session_revocation_metrics_failed");
  }
}
