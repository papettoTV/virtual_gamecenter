import { test } from "node:test";
import assert from "node:assert/strict";
import { canaryQuery, verifyCanaryEvents, verifyStoredRedaction } from "../scripts/verify-log-redaction.mjs";

const marker = "pulbase-log-audit-11111111-1111-4111-8111-111111111111";
test("canary queries are temporary, bounded and scoped to staging and one synthetic path", () => {
  const query = canaryQuery(marker, 1000, 2000);
  assert.equal(query.dry, true);
  assert.equal(query.limit, 20);
  assert.equal(query.parameters.filterCombination, "and");
  assert.deepEqual(query.parameters.filters.map(filter => filter.value), ["pulbase-staging", marker]);
  for (const args of [["other", 0, 1000], [marker, 2000, 1000], [marker, 0, 300001], [marker, NaN, 2000]]) assert.throws(() => canaryQuery(...args));
});

test("an empty result never proves redaction", () => {
  for (const result of [null, {}, { events: { events: [] } }]) {
    assert.deepEqual(verifyCanaryEvents(result, marker, "synthetic-code", "synthetic-state"), { confirmed: false, matchingEvents: 0 });
  }
});

test("only the canary event is inspected and raw query values fail verification", () => {
  const result = text => ({ events: { events: [{ source: { url: text } }] } });
  assert.deepEqual(verifyCanaryEvents(result("https://example.com/" + marker), marker, "secret-code", "secret-state"), { confirmed: true, matchingEvents: 1 });
  for (const text of [marker + "?code=secret-code", marker + "?state=secret-state", "unrelated-user-request"]) {
    assert.throws(() => verifyCanaryEvents(result(text), marker, "secret-code", "secret-state"), error => {
      assert.doesNotMatch(error.message, /secret-code|secret-state|unrelated-user-request/);
      return true;
    });
  }
});

test("permission failure stops before sending any synthetic request", async () => {
  let requests = 0;
  await assert.rejects(verifyStoredRedaction({ token: "private-token", authorization: "private-basic" }, async (url, init) => {
    requests++;
    assert.ok(String(url).endsWith("/keys"));
    const query = JSON.parse(init.body);
    assert.equal(query.timeframe.to - query.timeframe.from, 300000);
    return Response.json({ success: false, errors: [{ message: "private-token" }] }, { status: 403 });
  }), error => { assert.doesNotMatch(error.message, /private-token/); return true; });
  assert.equal(requests, 1);
});

test("verification never follows redirects and retries missing canary logs only three times", async () => {
  const requests = [], waits = [];
  await assert.rejects(verifyStoredRedaction({ token: "api-token", authorization: "basic-token" }, async (url, init) => {
    requests.push({ url: String(url), init });
    assert.equal(init.redirect, "error");
    if (String(url).endsWith("/keys")) return Response.json({ success: true, result: [{ key: "$metadata.service" }, { key: "$metadata.message" }] });
    if (String(url).includes("develop.virtual-gamecenter.pages.dev")) {
      assert.equal(init.headers.Authorization, "basic-token");
      assert.equal(init.method, "GET");
      return new Response("canary shell");
    }
    assert.equal(init.headers.Authorization, "Bearer api-token");
    assert.equal(JSON.parse(init.body).dry, true);
    return Response.json({ success: true, result: { events: { events: [] } } });
  }, async milliseconds => { waits.push(milliseconds); }), /not available/);
  assert.equal(requests.length, 5);
  assert.deepEqual(waits, [20000, 20000, 20000]);
});

test("one redacted canary proves delivery without returning raw logs or credentials", async () => {
  let path;
  const waits = [];
  const result = await verifyStoredRedaction({ token: "private-api", authorization: "private-basic" }, async (url, init) => {
    if (String(url).endsWith("/keys")) return Response.json({ success: true, result: [{ key: "$metadata.service" }, { key: "$metadata.message" }] });
    if (String(url).startsWith("https://develop.virtual-gamecenter.pages.dev/")) {
      const probe = new URL(url);
      path = probe.pathname;
      assert.match(probe.searchParams.get("code"), /^synthetic-code-/);
      assert.match(probe.searchParams.get("state"), /^synthetic-state-/);
      assert.ok(!path.includes("/api/platform/auth/"));
      return new Response("canary shell");
    }
    const query = JSON.parse(init.body);
    assert.ok(path.endsWith(query.parameters.filters[1].value));
    return Response.json({ success: true, result: { events: { events: [{ source: { request: { url: "https://develop.virtual-gamecenter.pages.dev" + path } } }] } } });
  }, async milliseconds => { waits.push(milliseconds); });
  assert.deepEqual(result, { environment: "staging", confirmed: true, matchingEvents: 1, syntheticRequestStatus: 200, queryValuesAbsent: true });
  assert.deepEqual(waits, [20000]);
  assert.doesNotMatch(JSON.stringify(result), /private-|synthetic-code|synthetic-state|pulbase-log-audit-/);
});

test("missing query fields stop verification before any website access", async () => {
  let requests = 0;
  await assert.rejects(verifyStoredRedaction({ token: "test", authorization: "test" }, async () => {
    requests++;
    return Response.json({ success: true, result: [{ key: "$metadata.service" }] });
  }), /no canary sent/);
  assert.equal(requests, 1);
});
