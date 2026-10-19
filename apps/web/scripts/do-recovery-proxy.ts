export default {
  fetch(request: Request, env: { DRILL: Fetcher }) {
    const url = new URL(request.url);
    if (!["localhost", "127.0.0.1", "pulbase-recovery.localhost"].includes(url.hostname)) return new Response("Forbidden", { status: 403 });
    const origin = request.headers.get("Origin");
    if (origin && origin !== url.origin) return new Response("Forbidden", { status: 403 });
    url.hostname = "127.0.0.1";
    const headers = new Headers(request.headers);
    headers.set("CF-Connecting-IP", "192.0.2.80");
    if (origin) headers.set("Origin", url.origin);
    return env.DRILL.fetch(new Request(new Request(url, request), { headers }));
  },
};
