import { getGameDefinition } from "../domain/game";

export type Operation = "solo_start" | "versus_start" | "google_login" | "welcome_credit" | "registration_credit" | "daily_credit";
export type OperationOutcome = "success" | "failure" | "rejected" | "cancelled" | "noop";
export type OperationMetrics = Pick<AnalyticsEngineDataset, "writeDataPoint"> | undefined;

export function operationMetrics(env: { APP_ENV?: string; SECURITY_EVENTS?: OperationMetrics }): OperationMetrics {
  return env.APP_ENV === "staging" ? env.SECURITY_EVENTS : undefined;
}

export function recordOperation(metrics: OperationMetrics, operation: Operation, outcome: OperationOutcome, gameId?: string): void {
  if (!metrics || outcome === "noop") return;
  if (!["solo_start", "versus_start", "google_login", "welcome_credit", "registration_credit", "daily_credit"].includes(operation)
    || !["success", "failure", "rejected", "cancelled"].includes(outcome)) return;
  const game = operation.endsWith("_start") ? getGameDefinition(gameId)?.id ?? "unknown" : "none";
  const family = operation.endsWith("_start") ? "start" : operation === "google_login" ? "login" : "credit";
  try {
    metrics.writeDataPoint({ indexes: [`staging-operation-${operation}`],
      blobs: ["staging", operation, "operation-v1", outcome, game, `operation-${family}-v1`],
      doubles: [outcome === "success" || outcome === "failure" ? 1 : 0, outcome === "failure" ? 1 : 0,
        outcome === "success" ? 1 : 0, outcome === "rejected" ? 1 : 0, outcome === "cancelled" ? 1 : 0],
    });
  } catch { console.warn("operation_metrics_failed"); }
}

export async function observeOperation<Value>(metrics: OperationMetrics, operation: Operation, run: () => Promise<Value>,
  outcome: (value: Value) => OperationOutcome = () => "success", gameId?: string): Promise<Value> {
  try {
    const value = await run();
    recordOperation(metrics, operation, outcome(value), gameId);
    return value;
  } catch (error) {
    recordOperation(metrics, operation, "failure", gameId);
    throw error;
  }
}
