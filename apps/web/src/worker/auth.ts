const REALM = "virtual-gamecenter";

export interface BasicAuthEnv {
  BASIC_AUTH_USERNAME?: string;
  BASIC_AUTH_PASSWORD?: string;
}

export function authorizeRequest(request: Request, env: BasicAuthEnv): Response | null {
  if (isLocalRequest(request)) return null;

  const username = env.BASIC_AUTH_USERNAME;
  const password = env.BASIC_AUTH_PASSWORD;
  if (!username || !password) {
    return new Response("Basic auth is not configured.", { status: 503 });
  }

  const credentials = parseBasicAuthorization(request.headers.get("Authorization") ?? "");
  if (credentials?.username === username && credentials.password === password) return null;

  return new Response("Unauthorized", {
    status: 401,
    headers: {
      "WWW-Authenticate": `Basic realm="${REALM}", charset="UTF-8"`,
    },
  });
}

function isLocalRequest(request: Request): boolean {
  const { hostname } = new URL(request.url);
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname.startsWith("192.168.") ||
    hostname.startsWith("10.") ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname)
  );
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
