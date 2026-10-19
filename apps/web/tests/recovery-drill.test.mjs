import assert from "node:assert/strict";
import { test } from "node:test";
import { validateRecoveryConfig } from "../scripts/recovery-drill.mjs";

function config() {
  return {
    name: "pulbase-recovery-drill-20261020", account_id: "60e5472a284dc71bbafbbfac8aa2a940", workers_dev: false, preview_urls: false,
    vars: { RECOVERY_DRILL: "true" },
    d1_databases: [{ binding: "DB", database_name: "pulbase-recovery-drill-20261020", database_id: "10000000-0000-4000-8000-000000000001", remote: true }],
    r2_buckets: [{ binding: "DELETION_AUDIT", bucket_name: "pulbase-recovery-drill-20261020", remote: true }],
  };
}

test("only admits explicitly isolated remote drill resources", () => {
  assert.equal(validateRecoveryConfig(config()), "pulbase-recovery-drill-20261020");
});

for (const databaseId of ["c49b03c7-e616-4acb-96a8-2837ff62034f", "c0050cdb-dc20-42fb-9855-bfb155ba5dd2", "00000000-0000-0000-0000-000000000002"]) {
  test(`rejects existing application database ${databaseId}`, () => {
    const value = config(); value.d1_databases[0].database_id = databaseId;
    assert.throws(() => validateRecoveryConfig(value));
  });
}

test("rejects shared audit storage, public endpoints, Cron and environment overrides", () => {
  const value = config(); value.r2_buckets[0].bucket_name = "pulbase-staging-deletion-audit";
  assert.throws(() => validateRecoveryConfig(value));
  for (const key of ["workers_dev", "preview_urls"]) assert.throws(() => validateRecoveryConfig({ ...config(), [key]: true }));
  for (const key of ["env", "routes", "triggers", "services", "durable_objects", "secrets", "assets"]) assert.throws(() => validateRecoveryConfig({ ...config(), [key]: {} }));
  assert.throws(() => validateRecoveryConfig({ ...config(), name: "pulbase-production" }));
  assert.throws(() => validateRecoveryConfig({ ...config(), vars: {} }));
});
