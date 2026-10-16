export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const headers = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow', 'X-Content-Type-Options': 'nosniff' };
    if (url.pathname.startsWith('/api/') || request.headers.get('Upgrade')?.toLowerCase() === 'websocket' || !['GET', 'HEAD'].includes(request.method)) {
      return new Response(JSON.stringify({ error: '現在準備中です。' }), { status: 503, headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8', 'Retry-After': '86400' } });
    }
    const asset = await env.ASSETS.fetch(new Request(new URL('/index.html', url), { method: request.method }));
    return new Response(asset.body, { status: 200, headers: { ...headers, 'Content-Type': 'text/html; charset=utf-8' } });
  }
};
