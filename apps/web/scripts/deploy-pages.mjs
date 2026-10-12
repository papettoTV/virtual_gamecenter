import { spawnSync } from "node:child_process";
import { readFile, rename } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { checkReleaseBranch, checkReleaseConfig } from "./release-config.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const environment = process.argv[2];
const branch = { staging: "develop", production: "main" }[environment];
const current = spawnSync("git", ["branch", "--show-current"], { cwd: root, encoding: "utf8" });
const redirect = new URL("../.wrangler/deploy/config.json", import.meta.url);
const saved = new URL("../.wrangler/deploy/worker-config.saved.json", import.meta.url);
let moved = false;
let originalBuild;
let endpoint;
let authorization;
async function projectRequest(method, body) {
  const response = await fetch(endpoint, { method, headers: { Authorization: authorization, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const result = await response.json();
  if (!result.success) throw Error("Pagesプロジェクト設定の取得/復元に失敗しました。");
  return result.result;
}
try {
  if (current.status !== 0 || process.argv.length !== 3 || checkReleaseBranch(environment, current.stdout.trim()).length) throw Error("Pages公開元のブランチ・環境を確認してください。");
  const build = spawnSync("npm", ["run", "build:pages"], { cwd: root, stdio: "inherit" });
  if (build.status !== 0) throw Error("Pagesビルドに失敗しました。");
  const config = JSON.parse(await readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8"));
  const configErrors = checkReleaseConfig(config, environment);
  if (configErrors.length) throw Error(configErrors.join("\n"));
  if (!/^[a-f0-9]{32}$/.test(config.account_id)) throw Error("対象Cloudflareアカウントを確認してください。");
  const credentials = spawnSync("npx", ["wrangler", "auth", "token", "--json"], { cwd: root, encoding: "utf8" });
  if (credentials.status !== 0) throw Error("Cloudflare認証を確認してください。");
  const token = JSON.parse(credentials.stdout).token;
  if (!token) throw Error("Cloudflare認証情報を取得できません。");
  authorization = `Bearer ${token}`;
  endpoint = `https://api.cloudflare.com/client/v4/accounts/${config.account_id}/pages/projects/virtual-gamecenter`;
  const project = await projectRequest("GET");
  if (project.production_branch !== "main") throw Error("PagesのProduction branchがmainではありません。");
  originalBuild = project.build_config;
  try { await rename(redirect, saved); moved = true; } catch (error) { if (error.code !== "ENOENT") throw error; }
  const deployed = spawnSync("npx", ["wrangler", "pages", "deploy", "../dist/client", "--cwd", "pages", "--project-name", "virtual-gamecenter", "--branch", branch, "--commit-dirty=true"], { cwd: root, stdio: "inherit" });
  if (deployed.status !== 0) throw Error("Pagesデプロイに失敗しました。");
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
} finally {
  if (moved) await rename(saved, redirect);
  if (originalBuild) {
    const latest = await projectRequest("GET");
    if (JSON.stringify(latest.build_config) !== JSON.stringify(originalBuild)) await projectRequest("PATCH", { build_config: originalBuild });
  }
}
