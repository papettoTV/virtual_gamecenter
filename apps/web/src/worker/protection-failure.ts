export function protectionFailureKind(error: unknown): string {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (/network connection lost|connection reset|disconnected/.test(message)) return "connection_lost";
  if (/overloaded|too many|queue.*full/.test(message)) return "overloaded";
  if (/timeout|timed out/.test(message)) return "timeout";
  if (/d1_error|d1 error/.test(message)) return "database";
  if (/durable object|rpc/.test(message)) return "durable_object";
  return "unknown";
}

export function protectionFailureInfo(error: unknown) {
  return {
    cause: protectionFailureKind(error),
    retryable: Boolean(error && typeof error === "object" && "retryable" in error && error.retryable === true),
    overloaded: Boolean(error && typeof error === "object" && "overloaded" in error && error.overloaded === true),
  };
}

export async function withProtectionRetry<T>(operation: () => Promise<T>, onRetry: (attempt: number, info: ReturnType<typeof protectionFailureInfo>) => void, wait = (milliseconds: number) => new Promise<void>(resolve => setTimeout(resolve, milliseconds))): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try { return await operation(); }
    catch (error) {
      const info = protectionFailureInfo(error);
      if (attempt >= 2 || info.overloaded || info.cause === "overloaded" || (!info.retryable && info.cause !== "connection_lost")) throw error;
      onRetry(attempt + 1, info);
      await wait(100 * 2 ** attempt + Math.floor(Math.random() * 100));
    }
  }
}
