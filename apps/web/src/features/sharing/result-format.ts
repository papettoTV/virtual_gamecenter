import type { SharedResultDraft } from "../../domain/shared-result";

export function resultMetric(result: SharedResultDraft, key: string): number {
  const value = result.metrics[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function resultTime(milliseconds: number): string {
  const seconds = Math.floor(milliseconds / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
