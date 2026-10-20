import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { validateOperationDrill } from "../scripts/operation-drill.mjs";

const config = JSON.parse(readFileSync(new URL("../config/operation-drill.json", import.meta.url)));
test("operation drill is fixed to the existing isolated Worker and dedicated database", () => {
  assert.equal(validateOperationDrill(config), "pulbase-revocation-drill-20261020");
  assert.doesNotMatch(readFileSync(new URL("../src/worker/index.ts", import.meta.url), "utf8"), /operation-drill|OperationOperator/);
  assert.doesNotMatch(readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8"), /operation-drill|OPERATION_DRILL/);
  for (const change of [{ name: "pulbase-staging" }, { workers_dev: true }, { routes: ["pulbase.com/*"] },
    { d1_databases: [{ database_id: "c49b03c7-e616-4acb-96a8-2837ff62034f" }] },
    { vars: { ...config.vars, OPERATION_DRILL: "false" } }, { services: [] }, { triggers: { crons: ["* * * * *"] } }]) {
    assert.throws(() => validateOperationDrill({ ...config, ...change }));
  }
});
