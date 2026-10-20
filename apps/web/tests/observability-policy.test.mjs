import { test } from "node:test";
import assert from "node:assert/strict";
import { enforceObservabilityPolicy, parseTokenOutput, policyOptions, tokenCommandOptions } from "../scripts/observability-policy.mjs";
import { readFileSync } from "node:fs";

test("malformed token output cannot appear in errors and Pages uses the protected retrieval path", () => {
  for (const output of ['{"token":"private-secret",broken}', '{"token":null}', 'private-secret']) {
    assert.throws(() => parseTokenOutput(output), error => error.message.includes("suppressed") && !error.message.includes("private-secret"));
  }
  assert.equal(parseTokenOutput('{"token":"synthetic"}'), "synthetic");
  const deploy = readFileSync(new URL("../scripts/deploy-pages.mjs", import.meta.url), "utf8");
  assert.ok(deploy.includes("...tokenCommandOptions()"));
  assert.ok(deploy.includes("parseTokenOutput(credentials.stdout)"));
});

test("token retrieval never writes Wrangler diagnostic logs or inherits verbose metrics", () => {
  const options = tokenCommandOptions({ WRANGLER_WRITE_LOGS: "true", WRANGLER_SEND_METRICS: "true" });
  assert.equal(options.env.WRANGLER_WRITE_LOGS, "false");
  assert.equal(options.env.WRANGLER_SEND_METRICS, "false");
  assert.deepEqual(options.stdio, ["ignore", "pipe", "pipe"]);
});

const settings = () => ({
  observability: {
    enabled: true, head_sampling_rate: 1, redact_query_string: false,
    logs: { enabled: true, head_sampling_rate: 1, persist: true, invocation_logs: true },
    traces: { enabled: false, persist: true, head_sampling_rate: 1 },
  },
  logpush: false, tail_consumers: [],
});
const ok = result => Response.json({ success: true, result });

test("only explicit staging checks and opt-in application are accepted", () => {
  assert.deepEqual(policyOptions(["--environment", "staging"]), { apply: false });
  assert.deepEqual(policyOptions(["--environment", "staging", "--apply"]), { apply: true });
  for (const args of [[], ["--apply"], ["--environment", "production"], ["--environment", "staging", "--worker", "other"], ["--environment", "staging", "--apply", "--apply"]]) {
    assert.throws(() => policyOptions(args));
  }
});

test("read-only checks emit only whitelisted metadata", async () => {
  const value = { ...settings(), bindings: [{ name: "secret", text: "private-binding" }], tags: ["private-tag"] };
  value.observability.logs.head_sampling_rate = "private-rate";
  value.observability.traces.enabled = "private-trace";
  const calls = [];
  const result = await enforceObservabilityPolicy("private-token", {}, async (url, init) => {
    calls.push({ url, init });
    return ok(value);
  });
  assert.equal(result.changed, false);
  assert.equal(result.queryRedaction, false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.method, "GET");
  assert.equal(calls[0].init.redirect, "error");
  assert.match(calls[0].url, /\/pulbase-staging\/script-settings$/);
  assert.doesNotMatch(JSON.stringify(result), /private-|bindings|tags/);
});

test("application changes query redaction only and verifies monitoring settings", async () => {
  let value = settings();
  const before = structuredClone(value);
  const methods = [];
  const result = await enforceObservabilityPolicy("test", { apply: true }, async (_url, init) => {
    methods.push(init.method);
    if (init.method === "PATCH") {
      const patch = JSON.parse(init.body);
      assert.deepEqual(Object.keys(patch), ["observability"]);
      assert.deepEqual(patch.observability, { ...before.observability, redact_query_string: true });
      value.observability = patch.observability;
    }
    return ok(value);
  });
  assert.deepEqual(methods, ["GET", "PATCH", "GET"]);
  assert.equal(result.changed, true);
  assert.equal(result.queryRedaction, true);
  assert.equal(result.logsEnabled, true);
  assert.equal(result.logsPersisted, true);
  assert.equal(result.invocationLogs, true);
  assert.equal(result.tracesEnabled, false);
});

test("an already protected Worker is not rewritten", async () => {
  const value = settings();
  value.observability.redact_query_string = true;
  let count = 0;
  const result = await enforceObservabilityPolicy("test", { apply: true }, async () => { count++; return ok(value); });
  assert.equal(count, 1);
  assert.equal(result.changed, false);
});

test("missing monitoring or unsupported settings never cause a patch", async () => {
  for (const mutate of [
    value => { value.observability.enabled = false; },
    value => { value.observability.logs.enabled = false; },
    value => { value.observability.logs.persist = false; },
    value => { value.observability.logs.invocation_logs = false; },
    value => { delete value.observability.redact_query_string; },
  ]) {
    const value = settings(); mutate(value);
    const methods = [];
    await assert.rejects(enforceObservabilityPolicy("test", { apply: true }, async (_url, init) => {
      methods.push(init.method); return ok(value);
    }));
    assert.deepEqual(methods, ["GET"]);
  }
});

test("verification detects a failed policy or unrelated monitoring drift", async () => {
  for (const mutate of [
    value => { value.observability.redact_query_string = false; },
    value => { value.observability.logs.invocation_logs = false; },
    value => { value.observability.traces.enabled = true; },
    value => { value.logpush = true; },
  ]) {
    let reads = 0;
    await assert.rejects(enforceObservabilityPolicy("test", { apply: true }, async (_url, init) => {
      const value = settings();
      if (init.method === "GET" && ++reads === 2) {
        value.observability.redact_query_string = true;
        mutate(value);
      }
      return ok(value);
    }), /verification failed/);
  }
});

test("transport failures and API errors never expose response text or credentials", async () => {
  for (const request of [
    async () => { throw Error("private-token and callback?code=private-code"); },
    async () => Response.json({ success: false, errors: [{ message: "private-token" }] }, { status: 403 }),
    async () => new Response("private-token", { status: 500 }),
  ]) {
    await assert.rejects(enforceObservabilityPolicy("private-token", {}, request), error => {
      assert.doesNotMatch(error.message, /private-token|private-code/);
      return true;
    });
  }
});
