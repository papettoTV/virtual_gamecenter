export const USAGE_LIMITS = [100_000, 5_000_000, 100_000, 5_000_000_000, 100_000, 13_000, 5_000_000, 100_000, 5_000_000_000] as const;
export const USAGE_METRICS = ["workers_requests", "d1_rows_read", "d1_rows_written", "d1_storage_bytes", "do_raw_requests", "do_duration_gbs", "do_rows_read", "do_rows_written", "do_storage_bytes"] as const;

export interface UsageSnapshot {
  day: string;
  observedAt: number;
  values: number[];
  highestPercent: number;
  estimatedDoBillableRequests: number;
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("usage_invalid_response");
  return value as Record<string, unknown>;
}

function number(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new Error("usage_invalid_metric");
  return value;
}

function groups(account: Record<string, unknown>, name: string, limit: number): Record<string, unknown>[] {
  const value = account[name];
  if (!Array.isArray(value) || value.length >= limit) throw new Error("usage_incomplete_response");
  return value.map(object);
}

function total(account: Record<string, unknown>, name: string, field: string): number {
  return groups(account, name, 2).reduce((sum, group) => sum + number(object(group.sum)[field]), 0);
}

function storage(account: Record<string, unknown>, name: string, identifier: string, field: string): number {
  const identifiers = new Set<string>();
  return groups(account, name, 1000).reduce((sum, group) => {
    const id = object(group.dimensions)[identifier];
    if (typeof id !== "string" || identifiers.has(id)) throw new Error("usage_invalid_storage_groups");
    identifiers.add(id);
    return sum + number(object(group.max)[field]);
  }, 0);
}

export function usageQuery(accountId: string, now: number): string {
  if (!/^[a-f0-9]{32}$/i.test(accountId) || !Number.isFinite(now)) throw new Error("usage_invalid_configuration");
  const end = new Date(now).toISOString();
  const start = end.slice(0, 10) + "T00:00:00.000Z";
  const storageStart = new Date(now - 86_400_000).toISOString();
  const daily = `filter:{datetime_geq:"${start}",datetime_leq:"${end}"}`;
  const stored = `filter:{datetime_geq:"${storageStart}",datetime_leq:"${end}"}`;
  return `{viewer{accounts(filter:{accountTag:"${accountId}"}){
    workersInvocationsAdaptive(limit:2,${daily}){sum{requests}}
    pagesFunctionsInvocationsAdaptiveGroups(limit:2,${daily}){sum{requests}}
    d1AnalyticsAdaptiveGroups(limit:2,${daily}){sum{rowsRead rowsWritten}}
    d1StorageAdaptiveGroups(limit:1000,${stored}){dimensions{databaseId} max{databaseSizeBytes}}
    durableObjectsInvocationsAdaptiveGroups(limit:100,${daily}){dimensions{type} sum{requests}}
    durableObjectsPeriodicGroups(limit:2,${daily}){sum{duration inboundWebsocketMsgCount rowsRead rowsWritten}}
    durableObjectsSqlStorageGroups(limit:1000,${stored}){dimensions{namespaceId} max{storedBytes}}
  }}}`;
}

export function parseUsage(result: unknown, now: number): UsageSnapshot {
  const response = object(result);
  if (response.errors !== null && response.errors !== undefined && (!Array.isArray(response.errors) || response.errors.length)) throw new Error("usage_api_error");
  const accounts = object(object(response.data).viewer).accounts;
  if (!Array.isArray(accounts) || accounts.length !== 1) throw new Error("usage_account_unavailable");
  const account = object(accounts[0]);
  const invocations = groups(account, "durableObjectsInvocationsAdaptiveGroups", 100);
  let requests = 0;
  let hibernationMessages = 0;
  for (const group of invocations) {
    const type = object(group.dimensions).type;
    if (typeof type !== "string") throw new Error("usage_invalid_invocation_type");
    const count = number(object(group.sum).requests);
    if (type === "hibernation") hibernationMessages += count;
    else requests += count;
  }
  const incoming = total(account, "durableObjectsPeriodicGroups", "inboundWebsocketMsgCount");
  const values = [
    total(account, "workersInvocationsAdaptive", "requests") + total(account, "pagesFunctionsInvocationsAdaptiveGroups", "requests"),
    total(account, "d1AnalyticsAdaptiveGroups", "rowsRead"),
    total(account, "d1AnalyticsAdaptiveGroups", "rowsWritten"),
    storage(account, "d1StorageAdaptiveGroups", "databaseId", "databaseSizeBytes"),
    requests + hibernationMessages + incoming,
    total(account, "durableObjectsPeriodicGroups", "duration"),
    total(account, "durableObjectsPeriodicGroups", "rowsRead"),
    total(account, "durableObjectsPeriodicGroups", "rowsWritten"),
    storage(account, "durableObjectsSqlStorageGroups", "namespaceId", "storedBytes"),
  ];
  return {
    day: new Date(now).toISOString().slice(0, 10), observedAt: now, values,
    highestPercent: Math.max(...values.map((value, index) => value / USAGE_LIMITS[index]! * 100)),
    estimatedDoBillableRequests: requests + (hibernationMessages + incoming) / 20,
  };
}

export async function collectUsage(accountId: string, token: string, now = Date.now(), fetcher: typeof fetch = fetch): Promise<UsageSnapshot> {
  if (!token) throw new Error("usage_missing_token");
  const query = usageQuery(accountId, now);
  try {
    const response = await fetcher("https://api.cloudflare.com/client/v4/graphql", {
      method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query }), signal: AbortSignal.timeout(10_000), redirect: "manual",
    });
    if (!response.ok) throw new Error("usage_http_error");
    const reader = response.body?.getReader();
    if (!reader) throw new Error("usage_empty_response");
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        length += chunk.value.byteLength;
        if (length > 256 * 1024) { await reader.cancel(); throw new Error("usage_response_too_large"); }
        chunks.push(chunk.value);
      }
    } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return parseUsage(JSON.parse(new TextDecoder().decode(bytes)), now);
  } catch { throw new Error("usage_collection_failed"); }
}

export async function recordUsage(accountId: string, token: string, dataset: Pick<AnalyticsEngineDataset, "writeDataPoint">, now = Date.now(), fetcher: typeof fetch = fetch): Promise<void> {
  try {
    const snapshot = await collectUsage(accountId, token, now, fetcher);
    dataset.writeDataPoint({ indexes: ["account-usage"], blobs: [snapshot.day, "ok", "v1"], doubles: [...snapshot.values, snapshot.highestPercent, snapshot.estimatedDoBillableRequests, now / 1000] });
  } catch {
    dataset.writeDataPoint({ indexes: ["account-usage"], blobs: [new Date(now).toISOString().slice(0, 10), "error", "v1"], doubles: [0, 0, 0, 0, 0, 0, 0, 0, 0, -1, 0, now / 1000] });
    console.error("usage_collection_failed");
  }
}
