import { authorizeRequest, type BasicAuthEnv } from "./auth";
import { handleCabinetDirectoryRequest } from "./cabinet-directory";
import { CabinetRoom } from "./cabinet-room";
import { getPlayerConnectionIdentity, handlePlatformRequest } from "./platform";
import { handleRankingRequest } from "./ranking";
import { getSharedResult, handleSharedResultsRequest } from "./shared-results";
import { renderLiveImage, renderResultImage } from "./result-image";
import { handleSharingEvent } from "./sharing-events";
import { rewriteBrandPage, rewriteLivePage } from "./live-metadata";
import { getGameDefinition } from "../domain/game";
import { handleDataLifecycleRequest, runRetention } from "./data-lifecycle";
import { isDeveloperAuthAvailable } from "./google-auth";
import { boundRequestBody, clientAddressKey, limitRequest, WEBHOOK_BODY_LIMIT } from "./request-protection";
import { recordUsage } from "./usage-monitor";
import { AbuseGuard } from "./abuse-guard";
import { distributedBudget, distributedError } from "./distributed-protection";
import { hashIdentifier } from "./identity-hash";
import { recoveryResponse, type RecoveryBinding } from "./recovery-control";
import { secureResponse } from "./response-security";

export { CabinetRoom, AbuseGuard };

interface WorkerEnv extends Env, BasicAuthEnv {
  RECOVERY_CONTROL?: RecoveryBinding;
  ASSETS: Fetcher;
  DB: D1Database;
  CABINET_ROOMS: DurableObjectNamespace<CabinetRoom>;
}

const CABINET_SOCKET_PATH = /^\/api\/cabinets\/([a-zA-Z0-9-]+)\/ws$/;

const handler = {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    const url = new URL(request.url);
    const gatewayEnvironment = request.headers.get("X-Pulbase-Gateway-Environment");
    if (gatewayEnvironment && gatewayEnvironment !== env.APP_ENV) {
      return Response.json({ error: "backend_environment_mismatch" }, { status: 403, headers: { "Cache-Control": "no-store" } });
    }
    if (env.RECOVERY_CONTROL) {
      try {
        if (!await env.RECOVERY_CONTROL.getByName("global").isOpen()) return recoveryResponse(request);
      } catch { return recoveryResponse(request); }
    }
    const requiresOrigin = url.pathname.startsWith("/api/")
      && (request.headers.get("Upgrade")?.toLowerCase() === "websocket" || !["GET", "HEAD", "OPTIONS"].includes(request.method))
      && url.pathname !== "/api/platform/stripe/webhook";
    const origin = request.headers.get("Origin");
    if (requiresOrigin && (origin ? origin !== url.origin : env.APP_ENV !== "local")) {
      return Response.json({ error: "invalid_origin" }, { status: 403, headers: { "Cache-Control": "no-store" } });
    }
    const protection = await limitRequest(request, env);
    if (protection) return protection;
    if (url.pathname.startsWith("/api/") && !["GET", "HEAD", "OPTIONS"].includes(request.method)) {
      const bounded = await boundRequestBody(request, url.pathname === "/api/platform/stripe/webhook" ? WEBHOOK_BODY_LIMIT : undefined);
      if (bounded instanceof Response) return bounded;
      request = bounded;
    }
    const distributed = await distributedBudget(request, env);
    if (distributed) return distributed;
    const liveImage = /^\/share\/live\/([^/]+)\/image\.png$/.exec(url.pathname);
    if (liveImage && request.method === "GET") {
      return getGameDefinition(liveImage[1]) ? renderLiveImage(liveImage[1]!) : Response.json({ error: "unknown_game" }, { status: 404 });
    }
    const resultImage = /^\/results\/([^/]+)\/image\.png$/.exec(url.pathname);
    if (resultImage && request.method === "GET") {
      const result = await getSharedResult(env.DB, resultImage[1]!);
      return result ? renderResultImage(result) : Response.json({ error: "result_not_found" }, { status: 404 });
    }
    if (request.method === "GET" && /^\/(?:api\/results|results)\/[^/]+$/.test(url.pathname)) {
      return (await handleSharedResultsRequest(request, env.DB, env))!;
    }
    if (url.pathname === "/api/platform/sharing/events") return handleSharingEvent(request, env.DB);
    if (url.pathname === "/api/platform/stripe/webhook") {
      const platformResponse = await handlePlatformRequest(request, env.DB, env);
      return platformResponse ?? Response.json({ error: "not_found" }, { status: 404 });
    }

    const authorizationError = await authorizeRequest(request, env);
    if (authorizationError) return authorizationError;
    if (url.pathname === "/analytics.js" && request.method === "GET" && env.APP_ENV === "staging") {
      const asset = await env.ASSETS.fetch(request);
      if (!asset.ok) return asset;
      const headers = new Headers(asset.headers);
      headers.delete("content-length");
      headers.delete("etag");
      headers.set("Cache-Control", "no-store");
      return new Response("window.PULBASE_ANALYTICS_DISABLED = true;\n" + await asset.text(), { headers });
    }
    if (url.pathname === "/api/platform/dev/retention") {
      if (request.method !== "POST" || request.headers.get("Origin") !== url.origin || !isDeveloperAuthAvailable(url, env)) return Response.json({ error: "forbidden" }, { status: 403 });
      await runRetention(env.DB, env.CABINET_ROOMS, env.DELETION_AUDIT);
      return Response.json({ ok: true });
    }
    const lifecycleResponse = await handleDataLifecycleRequest(request, env.DB, env.CABINET_ROOMS, env.DELETION_AUDIT);
    if (lifecycleResponse) return lifecycleResponse;
    const sharedResultResponse = await handleSharedResultsRequest(request, env.DB, env);
    if (sharedResultResponse) return sharedResultResponse;

    const cabinetMatch = url.pathname.match(CABINET_SOCKET_PATH);
    if (cabinetMatch) {
      if (request.headers.get("Upgrade") !== "websocket") {
        return new Response("Expected WebSocket upgrade", { status: 426 });
      }
      const cabinetId = cabinetMatch[1]!;
      if (env.APP_ENV !== "local" && !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(cabinetId)) return Response.json({ error: "invalid_cabinet_id" }, { status: 400 });
      if (!getGameDefinition(url.searchParams.get("gameId"))) return Response.json({ error: "unknown_game" }, { status: 404 });
      const headers = new Headers(request.headers);
      headers.delete("X-Pulbase-Admission");
      const ip = await clientAddressKey(request, env.APP_ENV);
      let admission: string | undefined;
      if (env.APP_ENV !== "local" || ip) {
        try {
          if (!env.ABUSE_GUARDS || !ip) return distributedError();
          const identity = await getPlayerConnectionIdentity(request, env.DB);
          const player = identity ? await hashIdentifier(`${env.APP_ENV}:player:${identity.playerId}`) : undefined;
          admission = crypto.randomUUID();
          const decision = await env.ABUSE_GUARDS.getByName("admission").admit(admission, cabinetId, ip, player);
          if (!decision.success) return distributedError(decision);
          headers.set("X-Pulbase-Admission", admission);
        } catch { return distributedError(); }
      }
      const roomId = env.CABINET_ROOMS.idFromName(cabinetId);
      try {
        const response = await env.CABINET_ROOMS.get(roomId).fetch(new Request(request, { headers }));
        if (response.status !== 101 && admission) await env.ABUSE_GUARDS.getByName("admission").release(admission, cabinetId);
        return response;
      } catch {
        if (admission) await env.ABUSE_GUARDS.getByName("admission").release(admission, cabinetId).catch(() => {});
        return distributedError();
      }
    }

    if (url.pathname === "/api/ranking") {
      return handleRankingRequest(request, env.DB);
    }

    const cabinetDirectoryResponse = await handleCabinetDirectoryRequest(request, env.DB);
    if (cabinetDirectoryResponse) return cabinetDirectoryResponse;

    const platformResponse = await handlePlatformRequest(request, env.DB, env, env.CABINET_ROOMS);
    if (platformResponse) return platformResponse;

    if (url.pathname === "/api/health") {
      return Response.json({ ok: true, runtime: "cloudflare-workers" });
    }

    const assets = await env.ASSETS.fetch(request);
    if (request.method === "GET" && /^\/cabinets\/[^/]+$/.test(url.pathname) && assets.headers.get("content-type")?.includes("text/html")) return rewriteLivePage(assets, url);
    return rewriteBrandPage(assets, url);
  },
  async scheduled(event: ScheduledController, env: WorkerEnv, ctx: Pick<ExecutionContext, "waitUntil">): Promise<void> {
    if (event.cron === "0,15,30,45 * * * *") {
      if (env.USAGE_MONITOR_ENABLED === "true" && env.USAGE_METRICS) {
        ctx.waitUntil(recordUsage(env.METRICS_ACCOUNT_ID, env.CLOUDFLARE_METRICS_TOKEN ?? "", env.USAGE_METRICS));
      }
      return;
    }
    if (event.cron === "0 * * * *") {
      if (env.RECOVERY_CONTROL) {
        try { if (!await env.RECOVERY_CONTROL.getByName("global").isOpen()) return; }
        catch { return; }
      }
      ctx.waitUntil(runRetention(env.DB, env.CABINET_ROOMS, env.DELETION_AUDIT));
    }
  },
} satisfies ExportedHandler<WorkerEnv>;

export default {
  ...handler,
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    return secureResponse(request, await handler.fetch(request, env));
  },
} satisfies ExportedHandler<WorkerEnv>;
