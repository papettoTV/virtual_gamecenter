import { authorizeRequest, type BasicAuthEnv } from "./auth";
import { handleCabinetDirectoryRequest } from "./cabinet-directory";
import { CabinetRoom } from "./cabinet-room";
import { handlePlatformRequest, type StripePaymentEnv } from "./platform";
import { handleRankingRequest } from "./ranking";

export { CabinetRoom };

interface WorkerEnv extends Env, BasicAuthEnv, StripePaymentEnv {
  ASSETS: Fetcher;
  DB: D1Database;
  CABINET_ROOMS: DurableObjectNamespace<CabinetRoom>;
}

const CABINET_SOCKET_PATH = /^\/api\/cabinets\/([a-zA-Z0-9-]+)\/ws$/;

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/api/platform/stripe/webhook") {
      const platformResponse = await handlePlatformRequest(request, env.DB, env);
      return platformResponse ?? Response.json({ error: "not_found" }, { status: 404 });
    }

    const authorizationError = authorizeRequest(request, env);
    if (authorizationError) return authorizationError;

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

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<WorkerEnv>;
