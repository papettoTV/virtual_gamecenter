import { hashIdentifier } from "./identity-hash";

export const API_BODY_LIMIT = 64 * 1024;
export const WEBHOOK_BODY_LIMIT = 256 * 1024;
export const WS_MESSAGE_LIMIT = 512 * 1024;
export const CABINET_CONNECTION_LIMIT = 64;
export const CABINET_IP_CONNECTION_LIMIT = 32;

interface Limiter { limit(options: { key: string }): Promise<{ success: boolean }> }
export interface ProtectionEnv {
  APP_ENV?: string;
  API_READ_LIMITER?: Limiter;
  API_WRITE_LIMITER?: Limiter;
  BOOTSTRAP_LIMITER?: Limiter;
  BENEFIT_LIMITER?: Limiter;
  SOCKET_LIMITER?: Limiter;
  AUTH_LIMITER?: Limiter;
}

export function protectionError(error: string, status: number): Response {
  return Response.json({ error }, { status, headers: { "Cache-Control": "no-store", ...(status === 429 ? { "Retry-After": "60" } : {}) } });
}

export async function clientAddressKey(request: Request, environment?: string): Promise<string | undefined> {
  const address = request.headers.get("CF-Connecting-IP");
  return address ? hashIdentifier(`${environment}:ip:${address.slice(0, 128)}`) : undefined;
}

export async function limitRequest(request: Request, env: ProtectionEnv): Promise<Response | null> {
  const url = new URL(request.url);
  if ((!url.pathname.startsWith("/api/") && url.pathname !== "/operator/operations") || url.pathname === "/api/health" || url.pathname === "/api/platform/stripe/webhook") return null;
  const ipKey = await clientAddressKey(request, env.APP_ENV);
  if (env.APP_ENV === "local" && !ipKey) return null;
  const limiter = request.headers.get("Upgrade")?.toLowerCase() === "websocket" ? env.SOCKET_LIMITER
    : url.pathname.startsWith("/api/platform/auth/") ? env.AUTH_LIMITER
    : url.pathname === "/api/platform/bootstrap" ? env.BOOTSTRAP_LIMITER
    : url.pathname === "/api/platform/welcome-credit" ? env.BENEFIT_LIMITER
    : ["GET", "HEAD", "OPTIONS"].includes(request.method) ? env.API_READ_LIMITER : env.API_WRITE_LIMITER;
  if (!limiter) return protectionError("request_protection_unavailable", 503);
  const token = /(?:^|;\s*)vgc_session=([^;]+)/.exec(request.headers.get("Cookie") ?? "")?.[1];
  const keys = ["ip:" + (ipKey ?? "unknown")];
  if (token) keys.push("session:" + await hashIdentifier(token.slice(0, 128)));
  try {
    for (const key of keys) if (!(await limiter.limit({ key })).success) return protectionError("rate_limited", 429);
  } catch { return protectionError("request_protection_unavailable", 503); }
  return null;
}

export async function boundRequestBody(request: Request, limit = API_BODY_LIMIT): Promise<Request | Response> {
  if (!request.body) return request;
  if (request.headers.has("Content-Encoding") && request.headers.get("Content-Encoding") !== "identity") return protectionError("unsupported_content_encoding", 415);
  const length = request.headers.get("Content-Length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > limit)) return protectionError("payload_too_large", 413);
  const reader = request.body.getReader();
  const bytes = new Uint8Array(limit);
  let size = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("body_timeout")), 5000); });
  try {
    while (true) {
      const chunk = await Promise.race([reader.read(), timeout]);
      if (chunk.done) break;
      if (size + chunk.value.byteLength > limit) {
        void reader.cancel().catch(() => {});
        return protectionError("payload_too_large", 413);
      }
      bytes.set(chunk.value, size); size += chunk.value.byteLength;
    }
  } catch {
    void reader.cancel().catch(() => {});
    return protectionError("request_body_incomplete", 408);
  } finally { clearTimeout(timer); reader.releaseLock(); }
  const headers = new Headers(request.headers);
  headers.delete("Content-Length");
  return new Request(request, { headers, body: bytes.slice(0, size) });
}
