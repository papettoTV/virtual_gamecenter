import { mkdir, copyFile, writeFile, readFile } from "node:fs/promises";
import { checkPagesTargets } from "./pages-targets.mjs";

try {
  const targets = JSON.parse(await readFile(new URL("../config/pages-targets.json", import.meta.url), "utf8"));
  const workers = JSON.parse(await readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8"));
  const pages = JSON.parse(await readFile(new URL("../pages/wrangler.jsonc", import.meta.url), "utf8"));
  const errors = checkPagesTargets(targets, workers);
  if (pages.services[0].service !== targets.production.backendWorker || pages.env.preview.services[0].service !== targets.staging.backendWorker) errors.push("Pages Service BindingとWorker名が一致しません。");
  if (errors.length) throw new Error(errors.join("\n"));
  const output = new URL("../dist/client/", import.meta.url);
  await mkdir(output, { recursive: true });
  await copyFile(new URL("../src/pages/gateway.mjs", import.meta.url), new URL("_worker.js", output));
  await writeFile(new URL("_routes.json", output), JSON.stringify({ version: 1, include: ["/*"], exclude: [] }));
  process.stdout.write("Pagesゲートウェイをdist/clientへ生成しました。全リクエストをService Bindingへ転送します。\n");
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
