const unavailable = () => Response.json({ error: "backend_unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const productionHost = ["pulbase.com", "virtual-gamecenter.pages.dev"].includes(url.hostname);
    const stagingHost = url.hostname === "develop.virtual-gamecenter.pages.dev";
    const localHost = ["localhost", "127.0.0.1"].includes(url.hostname);
    if (!["staging", "production"].includes(env.APP_ENV) || !env.BACKEND?.fetch) return unavailable();
    if (!localHost && !((env.APP_ENV === "production" && productionHost) || (env.APP_ENV === "staging" && stagingHost))) {
      return Response.json({ error: "gateway_host_mismatch" }, { status: 403, headers: { "Cache-Control": "no-store" } });
    }
    const headers = new Headers(request.headers);
    headers.set("X-Pulbase-Gateway-Environment", env.APP_ENV);
    try {
      return await env.BACKEND.fetch(new Request(request, { headers }));
    } catch {
      return unavailable();
    }
  },
};
