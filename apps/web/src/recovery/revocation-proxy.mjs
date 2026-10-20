export default {
  fetch(request, env) {
    const url = new URL(request.url);
    if (!["localhost", "127.0.0.1"].includes(url.hostname) || (request.headers.get("Origin") && request.headers.get("Origin") !== url.origin)) return new Response("Forbidden", { status: 403 });
    if (url.pathname === "/__drill/ready") return new Response("ready", { headers: { "X-Revocation-Drill": "synthetic-only-v1" } });
    return env.DRILL.fetch(request);
  },
};
