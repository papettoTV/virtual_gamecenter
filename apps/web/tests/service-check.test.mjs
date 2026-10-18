import assert from "node:assert/strict";
import { test } from "node:test";
import { checkService, serviceCheckOrigin } from "../scripts/service-check.mjs";
import { getActiveGames } from "../src/domain/game.ts";

function healthyResponse(url, options) {
  if (url.pathname === "/") return new Response('<title>PULBASE</title><div id="root"></div><script type="module" src="/assets/app.js"></script>');
  if (url.pathname === "/assets/app.js") return new Response(null, { headers: { "content-type": "text/javascript" } });
  if (url.pathname === "/api/cabinets") return Response.json({ cabinets: [] });
  return new Response(url.pathname.includes("privacy") ? "プライバシーポリシー" : "利用規約");
}

test("targets require an explicit environment and cannot override remote destinations", () => {
  assert.throws(() => serviceCheckOrigin());
  assert.throws(() => serviceCheckOrigin("unknown"));
  assert.equal(serviceCheckOrigin("staging"), "https://develop.virtual-gamecenter.pages.dev");
  assert.throws(() => serviceCheckOrigin("staging", "https://pulbase.com"));
  assert.throws(() => serviceCheckOrigin("production"));
  assert.equal(serviceCheckOrigin("production", undefined, true), "https://pulbase.com");
});

test("local checks cannot send credentials to another host or path", () => {
  for (const url of ["https://localhost:5174", "http://example.com", "http://user:pass@localhost", "http://localhost/path", "http://localhost?key=secret"]) {
    assert.throws(() => serviceCheckOrigin("local", url));
  }
  assert.equal(serviceCheckOrigin("local"), "http://localhost:5174");
});

test("checks only read-only endpoints and every active game's directory", async () => {
  const calls = [];
  const result = await checkService({ environment: "staging", authorization: "Basic test" }, async (url, options) => {
    calls.push({ url, options });
    return healthyResponse(url, options);
  });
  assert.equal(result.ok, true);
  assert.equal(calls.length, getActiveGames().length + 4);
  for (const { url, options } of calls) {
    assert.equal(url.origin, "https://develop.virtual-gamecenter.pages.dev");
    assert.ok(["GET", "HEAD"].includes(options.method));
    assert.equal(options.redirect, "manual");
    assert.equal(options.headers.Authorization, "Basic test");
    assert.equal(options.headers.Cookie, undefined);
    assert.ok(!url.pathname.includes("bootstrap"));
  }
  assert.ok(!JSON.stringify(result).includes("Basic test"));
});

test("does not treat the holding page as a running application", async () => {
  const result = await checkService({ environment: "local" }, async () => new Response("PULBASE 準備中"));
  assert.equal(result.ok, false);
  assert.equal(result.checks.length, 1);
});

for (const status of [302, 401, 403, 429, 503]) {
  test(`reports HTTP ${status} without following redirects or exposing a response body`, async () => {
    const result = await checkService({ environment: "local" }, async () => new Response("private-token", { status, headers: { Location: "https://example.com" } }));
    assert.equal(result.ok, false);
    assert.equal(result.checks[0].status, status);
    assert.ok(!JSON.stringify(result).includes("private-token"));
  });
}

test("never sends authorization to a foreign script asset", async () => {
  let calls = 0;
  const result = await checkService({ environment: "local" }, async url => {
    calls += 1;
    if (url.pathname === "/") return new Response('<title>PULBASE</title><div id="root"></div><script type="module" src="https://example.com/assets/app.js"></script>');
    assert.equal(url.origin, "http://localhost:5174");
    return healthyResponse(url);
  });
  assert.equal(result.ok, false);
  assert.equal(result.checks[1].reason, "unexpected_asset");
  assert.equal(calls, getActiveGames().length + 3);
});

for (const content of ["not-json", '{}', '{"cabinets":null}', '{"cabinets":[{"gameId":"other","cabinetId":"x"}]}']) {
  test(`rejects invalid directory data: ${content}`, async () => {
    const result = await checkService({ environment: "local" }, async url => url.pathname === "/api/cabinets" ? new Response(content) : healthyResponse(url));
    assert.equal(result.ok, false);
  });
}

test("rejects an HTML fallback returned for a JavaScript asset", async () => {
  const result = await checkService({ environment: "local" }, async url => url.pathname === "/assets/app.js" ? new Response("html", { headers: { "content-type": "text/html" } }) : healthyResponse(url));
  assert.equal(result.ok, false);
});

test("bounds response sizes", async () => {
  const result = await checkService({ environment: "local" }, async () => new Response("x".repeat(524289)));
  assert.equal(result.checks[0].reason, "body_limit");
});

test("supports the local Vite entry but never treats it as a deployed bundle", async () => {
  const requests = [];
  const request = async url => {
    requests.push(url.pathname);
    if (url.pathname === "/") return new Response('<title>PULBASE</title><div id="root"></div><script type="module" src="/@vite/client"></script><script type="module" src="/src/main.tsx"></script>');
    if (url.pathname === "/src/main.tsx") return new Response(null, { headers: { "content-type": "text/javascript" } });
    return healthyResponse(url);
  };
  assert.equal((await checkService({ environment: "local" }, request)).ok, true);
  assert.ok(requests.includes("/src/main.tsx"));
  assert.ok(!requests.includes("/@vite/client"));
  assert.equal((await checkService({ environment: "staging" }, request)).ok, false);
});

test("reports timeouts and does not log raw exception details", async () => {
  const result = await checkService({ environment: "local" }, async () => { throw new DOMException("private-error-details", "TimeoutError"); });
  assert.equal(result.checks[0].reason, "timeout");
  assert.ok(!JSON.stringify(result).includes("private-error-details"));
});
