declare const __PULBASE_RELEASE_SHA__: string;

export function secureResponse(request: Request, response: Response): Response {
  if (response.status === 101) return response;
  const headers = new Headers(response.headers);
  if (typeof __PULBASE_RELEASE_SHA__ !== "undefined" && /^[a-f0-9]{40}$/.test(__PULBASE_RELEASE_SHA__)) {
    headers.set("X-Pulbase-Revision", __PULBASE_RELEASE_SHA__);
  }
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("X-Content-Type-Options", "nosniff");
  const path = new URL(request.url).pathname;
  if (path === "/api/platform" || path.startsWith("/api/platform/")) {
    headers.set("Cache-Control", "private, no-store");
  } else if ([401, 403, 503].includes(response.status)) {
    headers.set("Cache-Control", "no-store");
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
