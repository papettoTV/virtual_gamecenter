const REALM = "virtual-gamecenter";

export async function onRequest(context) {
  if (isLocalRequest(context.request)) {
    return context.next();
  }

  const username = context.env.BASIC_AUTH_USERNAME;
  const password = context.env.BASIC_AUTH_PASSWORD;

  if (!username || !password) {
    return new Response("Basic auth is not configured.", { status: 503 });
  }

  const authorization = context.request.headers.get("Authorization") || "";
  const credentials = parseBasicAuthorization(authorization);

  if (!credentials || credentials.username !== username || credentials.password !== password) {
    return new Response("Unauthorized", {
      status: 401,
      headers: {
        "WWW-Authenticate": `Basic realm="${REALM}", charset="UTF-8"`,
      },
    });
  }

  return context.next();
}

function isLocalRequest(request) {
  const { hostname } = new URL(request.url);
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function parseBasicAuthorization(authorization) {
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
