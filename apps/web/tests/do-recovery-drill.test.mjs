import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { validateDoRecoveryConfig } from "../scripts/do-recovery-drill.mjs";

const example = JSON.parse(await readFile(new URL("../config/do-recovery-drill.example.json", import.meta.url), "utf8"));
test("accepts only an isolated worker with its own three DO classes", () => {
  assert.equal(validateDoRecoveryConfig(example), "pulbase-recovery-drill-20261020-do");
});
test("rejects shared DO namespaces and administrative bindings", () => {
  const config = structuredClone(example);
  config.durable_objects.bindings[0].script_name = "pulbase-staging";
  assert.throws(() => validateDoRecoveryConfig(config));
  for (const key of ["routes", "services", "secrets", "triggers", "env"]) assert.throws(() => validateDoRecoveryConfig({ ...example, [key]: {} }));
});
test("rejects public URLs, live purchases and the application entrypoint", () => {
  assert.throws(() => validateDoRecoveryConfig({ ...example, workers_dev: true }));
  assert.throws(() => validateDoRecoveryConfig({ ...example, preview_urls: true }));
  assert.throws(() => validateDoRecoveryConfig({ ...example, main: "../src/worker/index.ts" }));
  assert.throws(() => validateDoRecoveryConfig({ ...example, vars: { ...example.vars, CREDIT_PURCHASES_ENABLED: "true" } }));
});
