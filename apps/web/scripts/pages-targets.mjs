import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export function checkPagesTargets(config, workers) {
  const errors = [];
  if (config.project !== "virtual-gamecenter") errors.push("Pagesプロジェクトはvirtual-gamecenterです。");
  if (config.rootDirectory !== "apps/web") errors.push("Pagesのルートディレクトリはapps/webです。");
  for (const [environment, branch, url] of [
    ["production", "main", "https://virtual-gamecenter.pages.dev"],
    ["staging", "develop", "https://develop.virtual-gamecenter.pages.dev"],
  ]) {
    const selected = config[environment];
    if (selected?.branch !== branch || selected?.url !== url) errors.push(`${environment}のブランチ/URLが確定方針と異なります。`);
    if (!selected?.backendWorker || selected.backendWorker !== workers.env?.[environment]?.name) errors.push(`${environment}の接続先Workerが一致しません。`);
  }
  if (!config.production?.customDomains?.includes("https://pulbase.com")) errors.push("pulbase.comはPages本番のカスタムドメインです。");
  return errors;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const environment = process.argv[2];
    if (!["staging", "production"].includes(environment) || process.argv.length !== 3) throw new Error("使用方法: pages-targets.mjs staging|production");
    const config = JSON.parse(readFileSync(new URL("../config/pages-targets.json", import.meta.url), "utf8"));
    const workers = JSON.parse(readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8"));
    const errors = checkPagesTargets(config, workers);
    if (errors.length) throw new Error(errors.join("\n"));
    process.stdout.write(`${environment}: ${config[environment].branch} → ${config[environment].url}\n`);
    process.stdout.write("リポジトリ内の対応表のみ確認。Pages設定・カスタムドメイン・API接続の実測確認ではありません。\n");
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
