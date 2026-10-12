import { readFile, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve, sep } from "node:path";
import { checkBuildConfig, checkReleaseBranch, checkReleaseConfig } from "./release-config.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const [command, environment, ...extra] = process.argv.slice(2);

function run(executable, args, env = process.env) {
  const result = spawnSync(executable, args, { cwd: root, env, stdio: "inherit" });
  if (result.error || result.status !== 0) throw new Error(`${executable}の実行に失敗しました。`);
}

try {
  if (!["check", "build", "deploy", "migrate"].includes(command) || extra.length) throw new Error("使用方法: release.mjs check|build|deploy|migrate staging|production");
  if (command === "deploy" || command === "migrate") {
    const current = spawnSync("git", ["branch", "--show-current"], { cwd: root, encoding: "utf8" });
    if (current.error || current.status !== 0) throw new Error("公開元ブランチを確認できません。");
    const branchErrors = checkReleaseBranch(environment, current.stdout.trim());
    if (branchErrors.length) throw new Error(branchErrors.join("\n"));
  }
  const { experimental_readRawConfig } = await import("wrangler");
  const { rawConfig: config } = experimental_readRawConfig({ config: resolve(root, "wrangler.jsonc") });
  const errors = checkReleaseConfig(config, environment);
  if (errors.length) throw new Error(errors.join("\n"));
  const selected = config.env[environment];
  process.stdout.write(`対象: ${environment} / Worker: ${selected.name} / DB: ${selected.d1_databases[0].database_name}\n`);
  process.stdout.write("ローカル設定検証済み。クラウドのリソース存在・Secret・公開判定は別途確認が必要です。\n");
  if (command === "migrate") {
    run("npx", ["wrangler", "d1", "migrations", "apply", "DB", "--config", "wrangler.jsonc", "--env", environment, "--remote"]);
  } else if (command === "build" || command === "deploy") {
    if (command === "deploy") run("npm", ["test"]);
    run("npm", ["run", "build"], { ...process.env, CLOUDFLARE_ENV: environment });
    const manifest = JSON.parse(await readFile(resolve(root, ".wrangler/deploy/config.json"), "utf8"));
    const artifactPath = resolve(root, ".wrangler/deploy", manifest.configPath);
    const outputRoot = resolve(root, "dist") + sep;
    if (!artifactPath.startsWith(outputRoot)) throw new Error("ビルド成果物の参照先がdist外です。");
    const built = JSON.parse(await readFile(artifactPath, "utf8"));
    const artifactErrors = checkBuildConfig(built, selected, environment);
    if (artifactErrors.length) throw new Error(artifactErrors.join("\n"));
    await rm(resolve(dirname(artifactPath), ".dev.vars"), { force: true });
    if (command === "deploy") run("npx", ["wrangler", "deploy", "--config", artifactPath]);
  }
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
