import { isStagingNetworkAllowed } from "./staging-network-access";

const REALM = "virtual-gamecenter";

export interface BasicAuthEnv {
  BASIC_AUTH_USERNAME?: string;
  BASIC_AUTH_PASSWORD?: string;
  STAGING_TRUSTED_NETWORKS?: string;
}

export async function authorizeRequest(request: Request, env: BasicAuthEnv & { APP_ENV?: string }): Promise<Response | null> {
  if (env.APP_ENV === "local" && isLocalRequest(request)) return null;
  if (isStagingNetworkAllowed(request, env)) return null;

  const username = env.BASIC_AUTH_USERNAME;
  const password = env.BASIC_AUTH_PASSWORD;
  if (!username || !password) {
    return new Response("Basic auth is not configured.", { status: 503, headers: { "Cache-Control": "no-store" } });
  }

  const credentials = parseBasicAuthorization(request.headers.get("Authorization") ?? "");
  const encoder = new TextEncoder();
  const [provided, expected] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(JSON.stringify([credentials?.username ?? "", credentials?.password ?? ""]))),
    crypto.subtle.digest("SHA-256", encoder.encode(JSON.stringify([username, password]))),
  ]);
  const subtle = crypto.subtle;
  if (!("timingSafeEqual" in subtle) || typeof subtle.timingSafeEqual !== "function") {
    return new Response("Authentication is unavailable.", { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  if (subtle.timingSafeEqual(provided, expected)) return null;

  return new Response("Unauthorized", {
    status: 401,
    headers: {
      "WWW-Authenticate": `Basic realm="${REALM}", charset="UTF-8"`,
      "Cache-Control": "no-store",
    },
  });
}

function isLocalRequest(request: Request): boolean {
  const { hostname } = new URL(request.url);
  if (["localhost", "127.0.0.1", "::1", "[::1]"].includes(hostname)) return true;
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)) return false;
  const address = hostname.split(".").map(Number);
  if (address.some(part => part > 255)) return false;
  return address[0] === 10 || (address[0] === 192 && address[1] === 168)
    || (address[0] === 172 && address[1]! >= 16 && address[1]! <= 31);
}

function parseBasicAuthorization(
  authorization: string,
): { username: string; password: string } | null {
  const [scheme, encoded] = authorization.split(" ");
  if (scheme !== "Basic" || !encoded) return null;

  try {
    const decoded = atob(encoded);
    const separator = decoded.indexOf(":");
    if (separator < 0) return null;
    return {
      username: decoded.slice(0, separator),
      password: decoded.slice(separator + 1),
    };
  } catch {
    return null;
  }
}
