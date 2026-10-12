import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import { checkPagesTargets } from "../scripts/pages-targets.mjs";

const targets = JSON.parse(readFileSync(new URL("../config/pages-targets.json", import.meta.url), "utf8"));
const workers = JSON.parse(readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8"));

test("Pagesのmain/develop対応と環境別Workerを確認する", () => {
  assert.deepEqual(checkPagesTargets(targets, workers), []);
});

test("本番と検証のブランチ/URLの取り違えを拒否する", () => {
  for (const environment of ["staging", "production"]) {
    const config = structuredClone(targets);
    config[environment].branch = "stg";
    assert.ok(checkPagesTargets(config, workers).length);
    config[environment].branch = targets[environment].branch;
    config[environment].url = "https://other.pages.dev";
    assert.ok(checkPagesTargets(config, workers).length);
  }
});

test("カスタムドメイン・接続先・ディレクトリの誤設定を拒否する", () => {
  for (const field of ["project", "root", "domain", "backend"]) {
    const config = structuredClone(targets);
    if (field === "project") config.project = "other";
    if (field === "root") config.rootDirectory = ".";
    if (field === "domain") config.production.customDomains = [];
    if (field === "backend") config.staging.backendWorker = targets.production.backendWorker;
    assert.ok(checkPagesTargets(config, workers).length, field);
  }
});
