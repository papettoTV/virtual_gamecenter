import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import { checkBuildConfig, checkReleaseBranch, checkReleaseConfig } from "../scripts/release-config.mjs";

const configured = JSON.parse(readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8"));
test("検証はdevelop、本番はmain以外の公開操作を拒否する", () => {
  assert.deepEqual(checkReleaseBranch("staging", "develop"), []);
  assert.deepEqual(checkReleaseBranch("production", "main"), []);
  for (const [environment, branch] of [["production", "develop"], ["staging", "main"], ["production", ""], [undefined, "develop"]]) {
    assert.ok(checkReleaseBranch(environment, branch).length);
  }
});
function ready() {
  const config = structuredClone(configured);
  config.env.staging.d1_databases[0].database_id = "11111111-1111-4111-8111-111111111111";
  config.env.production.d1_databases[0].database_id = "22222222-2222-4222-8222-222222222222";
  return config;
}

test("環境未指定・未知環境では公開/移行できない", () => {
  for (const environment of [undefined, "", "local", "prod"]) {
    assert.ok(checkReleaseConfig(ready(), environment).length > 0);
  }
});

test("Pagesの公開ドメインをWorkerで奪う設定を拒否する", () => {
  for (const environment of ["staging", "production"]) {
    for (const field of ["routes", "workers_dev"]) {
      const config = ready();
      if (field === "routes") config.env[environment].routes = [{ pattern: "pulbase.com", custom_domain: true }];
      else delete config.env[environment].workers_dev;
      assert.ok(checkReleaseConfig(config, environment).some((error) => error.includes("Pages")));
    }
  }
});

test("未作成の仮D1 IDを公開先として扱わない", () => {
  for (const environment of ["staging", "production"]) {
    assert.ok(checkReleaseConfig(configured, environment).some((error) => error.includes("仮ID")));
  }
});

test("環境別リソースと安全な無料ベータ設定を許可", () => {
  for (const environment of ["staging", "production"]) {
    assert.deepEqual(checkReleaseConfig(ready(), environment), []);
  }
});

test("開発者認証・購入の有効化を拒否", () => {
  for (const name of ["DEVELOPER_AUTH_ENABLED", "CREDIT_PURCHASES_ENABLED"]) {
    const config = ready();
    config.env.production.vars[name] = "true";
    assert.ok(checkReleaseConfig(config, "production").length);
  }
});

test("DB ID・DB名・R2・Workerの別環境共用を拒否", () => {
  for (const shared of ["id", "database", "bucket", "worker"]) {
    const config = ready();
    if (shared === "id") config.env.production.d1_databases[0].database_id = config.env.staging.d1_databases[0].database_id;
    if (shared === "database") config.env.production.d1_databases[0].database_name = config.env.staging.d1_databases[0].database_name;
    if (shared === "bucket") config.env.production.r2_buckets[0].bucket_name = config.env.staging.r2_buckets[0].bucket_name;
    if (shared === "worker") config.env.production.name = config.env.staging.name;
    assert.ok(checkReleaseConfig(config, "production").length, shared);
  }
  const config = ready();
  config.env.staging.d1_databases[0].database_id = config.d1_databases[0].database_id;
  assert.ok(checkReleaseConfig(config, "staging").length);
});

test("必須Secret宣言不足とvarsへの秘密情報混入を拒否", () => {
  const config = ready();
  config.env.production.secrets.required = [];
  config.env.production.vars.GOOGLE_CLIENT_SECRET = "example";
  assert.equal(checkReleaseConfig(config, "production").length, 5);
});

test("認証を迂回する静的配信・別環境DO・定期削除/監視不足を拒否", () => {
  for (const missing of ["assets", "rooms", "cron", "observability", "migrations"]) {
    const config = ready();
    if (missing === "assets") config.env.production.assets = { run_worker_first: false };
    if (missing === "rooms") config.env.production.durable_objects.bindings[0].script_name = "other-worker";
    if (missing === "cron") config.env.production.triggers.crons = [];
    if (missing === "observability") config.env.production.observability = { enabled: false };
    if (missing === "migrations") config.env.production.d1_databases[0].migrations_dir = "other";
    assert.ok(checkReleaseConfig(config, "production").length, missing);
  }
});

test("生成された別環境の成果物をデプロイしない", () => {
  const config = ready();
  assert.deepEqual(checkBuildConfig(config.env.production, config.env.production, "production"), []);
  assert.equal(checkBuildConfig(config.env.staging, config.env.production, "production").length, 4);
});

test("環境が欠落しても例外ではなく拒否理由を返す", () => {
  assert.ok(checkReleaseConfig({}, "production").length);
  const config = ready();
  delete config.env.production.d1_databases;
  delete config.env.production.r2_buckets;
  assert.ok(checkReleaseConfig(config, "production").length);
});
