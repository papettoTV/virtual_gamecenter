import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { validateRevocationDrill } from "../scripts/revocation-drill.mjs";
import proxy from "../src/recovery/revocation-proxy.mjs";
import { rpcResult } from "../scripts/rpc-result.mjs";

test("RPC return objects are copied and disposed, including serialization failures", async () => {
  let disposed = 0;
  const value = { count: 1, [Symbol.dispose]() { disposed += 1; } };
  assert.deepEqual(await rpcResult(Promise.resolve(value)), { count: 1 });
  assert.equal(disposed, 1);
  const cyclic = { [Symbol.dispose]() { disposed += 1; } }; cyclic.self = cyclic;
  await assert.rejects(rpcResult(Promise.resolve(cyclic)));
  assert.equal(disposed, 2);
});

const fixture = JSON.parse(await readFile(new URL("../config/revocation-drill.json", import.meta.url)));
test("drill resources are private, synthetic-only and cannot target application databases", () => {
  assert.equal(validateRevocationDrill(fixture), fixture.name);
  for (const databaseId of ["c49b03c7-e616-4acb-96a8-2837ff62034f", "c0050cdb-dc20-42fb-9855-bfb155ba5dd2"]) {
    const invalid = structuredClone(fixture); invalid.d1_databases[0].database_id = databaseId;
    assert.throws(() => validateRevocationDrill(invalid));
  }
  for (const key of ["routes", "triggers", "secrets", "services", "r2_buckets"]) {
    assert.throws(() => validateRevocationDrill({ ...fixture, [key]: [] }));
  }
  for (const key of ["workers_dev", "preview_urls"]) assert.throws(() => validateRevocationDrill({ ...fixture, [key]: true }));
});

test("drill proxy accepts loopback only and rejects browser cross-origin access", async () => {
  let calls = 0;
  const env = { DRILL: { fetch: async () => { calls += 1; return new Response("forwarded"); } } };
  for (const request of [new Request("http://example.com/"), new Request("http://127.0.0.1:8798/", { headers: { Origin: "https://example.com" } })]) assert.equal((await proxy.fetch(request, env)).status, 403);
  assert.equal(calls, 0);
  assert.equal((await proxy.fetch(new Request("http://127.0.0.1:8798/__drill/ready"), env)).headers.get("X-Revocation-Drill"), "synthetic-only-v1");
  assert.equal(calls, 0);
  assert.equal(await (await proxy.fetch(new Request("http://127.0.0.1:8798/test"), env)).text(), "forwarded");
  assert.equal(calls, 1);
});
