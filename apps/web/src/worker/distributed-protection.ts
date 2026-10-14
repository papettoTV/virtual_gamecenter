import { hashIdentifier } from "./identity-hash";
import { BUDGET_SHARDS, type BudgetKind, type Decision } from "./abuse-guard";
import { clientAddressKey, protectionError } from "./request-protection";
import { getPlayerConnectionIdentity } from "./platform";

export function distributedError(decision?: Decision): Response {
  const response = protectionError(decision ? "distributed_rate_limited" : "distributed_protection_unavailable", decision ? 429 : 503);
  if (decision) response.headers.set("Retry-After", String(Math.max(1, decision.retryAfter)));
  return response;
}

export async function distributedBudget(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/") || url.pathname === "/api/health" || url.pathname === "/api/platform/stripe/webhook") return null;
  const ip = await clientAddressKey(request, env.APP_ENV);
  if (env.APP_ENV === "local" && !ip) return null;
  if (!env.ABUSE_GUARDS || !ip) return distributedError();
  const kind: BudgetKind = request.headers.get("Upgrade")?.toLowerCase() === "websocket" ? "socket"
    : url.pathname.startsWith("/api/platform/auth/") ? "auth"
    : url.pathname === "/api/platform/bootstrap" ? "bootstrap"
    : url.pathname === "/api/platform/welcome-credit" ? "benefit"
    : ["GET", "HEAD", "OPTIONS"].includes(request.method) ? "read" : "write";
  try {
    const shard = Number.parseInt(ip.slice(0, 8), 16) % BUDGET_SHARDS;
    const guard = env.ABUSE_GUARDS.getByName(`budget:${shard}`);
    const first = await guard.consume(kind, ip);
    if (!first.success) return distributedError(first);
    const identity = await getPlayerConnectionIdentity(request, env.DB);
    if (identity?.playerId) {
      const player = await hashIdentifier(`${env.APP_ENV}:player:${identity.playerId}`);
      const playerShard = Number.parseInt(player.slice(0, 8), 16) % BUDGET_SHARDS;
      const decision = await env.ABUSE_GUARDS.getByName(`budget:${playerShard}`).consume(kind, player, player, false);
      if (!decision.success) return distributedError(decision);
    }
  } catch { return distributedError(); }
  return null;
}
