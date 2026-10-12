import { authorizeRequest, type BasicAuthEnv } from "./auth";
import { handleCabinetDirectoryRequest } from "./cabinet-directory";
import { CabinetRoom } from "./cabinet-room";
import { handlePlatformRequest } from "./platform";
import { handleRankingRequest } from "./ranking";
import { getSharedResult, handleSharedResultsRequest } from "./shared-results";
import { renderLiveImage, renderResultImage } from "./result-image";
import { handleSharingEvent } from "./sharing-events";
import { rewriteLivePage } from "./live-metadata";
import { getGameDefinition } from "../domain/game";

export { CabinetRoom };

interface WorkerEnv extends Env, BasicAuthEnv {
  ASSETS: Fetcher;
  DB: D1Database;
  CABINET_ROOMS: DurableObjectNamespace<CabinetRoom>;
}

const CABINET_SOCKET_PATH = /^\/api\/cabinets\/([a-zA-Z0-9-]+)\/ws$/;

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
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

    const authorizationError = authorizeRequest(request, env);
    if (authorizationError) return authorizationError;
    const sharedResultResponse = await handleSharedResultsRequest(request, env.DB, env);
    if (sharedResultResponse) return sharedResultResponse;

    const cabinetMatch = url.pathname.match(CABINET_SOCKET_PATH);
    if (cabinetMatch) {
      if (request.headers.get("Upgrade") !== "websocket") {
        return new Response("Expected WebSocket upgrade", { status: 426 });
      }
      const cabinetId = cabinetMatch[1]!;
      const roomId = env.CABINET_ROOMS.idFromName(cabinetId);
      return env.CABINET_ROOMS.get(roomId).fetch(request);
    }

    if (url.pathname === "/api/ranking") {
      return handleRankingRequest(request, env.DB);
    }

    const cabinetDirectoryResponse = await handleCabinetDirectoryRequest(request, env.DB);
    if (cabinetDirectoryResponse) return cabinetDirectoryResponse;

    const platformResponse = await handlePlatformRequest(request, env.DB, env);
    if (platformResponse) return platformResponse;

    if (url.pathname === "/api/health") {
      return Response.json({ ok: true, runtime: "cloudflare-workers" });
    }

    const assets = await env.ASSETS.fetch(request);
    if (request.method === "GET" && /^\/cabinets\/[^/]+$/.test(url.pathname) && assets.headers.get("content-type")?.includes("text/html")) return rewriteLivePage(assets, url);
    return assets;
  },
} satisfies ExportedHandler<WorkerEnv>;
