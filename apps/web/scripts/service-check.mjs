import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { getActiveGames } from "../src/domain/game.ts";

const REMOTE_ORIGINS = {
  staging: "https://develop.virtual-gamecenter.pages.dev",
  production: "https://pulbase.com",
};

export function serviceCheckOrigin(environment, origin, confirmProduction = false) {
  if (environment === "local") {
    const target = new URL(origin ?? "http://localhost:5174");
    if (target.protocol !== "http:" || !["localhost", "127.0.0.1", "[::1]"].includes(target.hostname)
      || target.username || target.password || target.pathname !== "/" || target.search || target.hash) throw Error("Invalid local target");
    return target.origin;
  }
  if (!Object.hasOwn(REMOTE_ORIGINS, environment)) throw Error("Explicit environment required");
  if (origin) throw Error("Remote origin overrides are forbidden");
  if (environment === "production" && !confirmProduction) throw Error("Production confirmation required");
  return REMOTE_ORIGINS[environment];
}

async function limitedText(response, maxBytes = 524288) {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > maxBytes) { await reader.cancel(); throw Error("body_limit"); }
      chunks.push(next.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(bytes);
}

export async function checkService({ environment, origin, authorization, confirmProduction = false }, request = fetch) {
  const target = serviceCheckOrigin(environment, origin, confirmProduction);
  const checks = [];
  async function check(name, path, validate, method = "GET") {
    const started = performance.now();
    const record = { name, ok: false, status: null, durationMs: 0, reason: null };
    let body;
    try {
      const headers = { Accept: name.startsWith("directory:") ? "application/json" : "*/*" };
      if (authorization) headers.Authorization = authorization;
      const response = await request(new URL(path, target), {
        method, headers, redirect: "manual", signal: AbortSignal.timeout(10000), cache: "no-store",
      });
      record.status = response.status;
      if (response.status !== 200) {
        await response.body?.cancel();
        record.reason = response.status === 401 ? "authentication_required" : "unexpected_status";
      } else {
        body = method === "HEAD" ? "" : await limitedText(response);
        record.ok = validate(body, response);
        if (!record.ok) record.reason = "unexpected_content";
      }
    } catch (error) {
      record.reason = error?.name === "TimeoutError" || error?.name === "AbortError" ? "timeout"
        : error?.message === "body_limit" ? "body_limit" : "request_failed";
    }
    record.durationMs = Math.round(performance.now() - started);
    checks.push(record);
    return record.ok ? body : undefined;
  }
  const html = await check("application", "/", body => /id=["']root["']/.test(body) && body.includes("PULBASE"));
  if (html !== undefined) {
    let asset;
    for (const script of html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)) {
      if (!/type=["']module["']/.test(script[0])) continue;
      try {
        const candidate = new URL(script[1], target);
        const bundled = candidate.pathname.startsWith("/assets/") && candidate.pathname.endsWith(".js");
        const localEntry = environment === "local" && candidate.pathname === "/src/main.tsx";
        if (candidate.origin === target && !candidate.username && !candidate.password && (bundled || localEntry)) { asset = candidate; break; }
      } catch {}
    }
    if (!asset) {
      checks.push({ name: "application_asset", ok: false, status: null, durationMs: 0, reason: "unexpected_asset" });
    } else {
      await check("application_asset", asset.pathname, (_body, response) => /(?:javascript|ecmascript)/i.test(response.headers.get("content-type") ?? ""), "HEAD");
    }
    for (const game of getActiveGames()) {
      await check(`directory:${game.id}`, `/api/cabinets?gameId=${encodeURIComponent(game.id)}`, body => {
        const data = JSON.parse(body);
        return Array.isArray(data.cabinets) && data.cabinets.every(cabinet => cabinet?.gameId === game.id && typeof cabinet.cabinetId === "string");
      });
    }
    for (const [name, path, marker] of [["terms", "/legal/terms.html", "利用規約"], ["privacy", "/legal/privacy.html", "プライバシー"]]) {
      await check(name, path, body => body.includes(marker));
    }
  }
  return { environment, checkedAt: new Date().toISOString(), ok: checks.every(check => check.ok), checks };
}

async function main() {
  const args = process.argv.slice(2);
  const option = name => args[args.indexOf(name) + 1];
  const environment = args.includes("--environment") ? option("--environment") : undefined;
  const origin = args.includes("--origin") ? option("--origin") : undefined;
  const confirmProduction = args.includes("--confirm-production");
  serviceCheckOrigin(environment, origin, confirmProduction);
  let username = process.env.PULBASE_CHECK_USERNAME;
  let password = process.env.PULBASE_CHECK_PASSWORD;
  if (process.env.PULBASE_CHECK_AUTH_FILE) {
    ({ username, password } = JSON.parse(await readFile(process.env.PULBASE_CHECK_AUTH_FILE, "utf8")));
  }
  if ((username || password) && (typeof username !== "string" || typeof password !== "string" || !username || !password)) throw Error("Incomplete authentication configuration");
  const authorization = username && password ? `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}` : undefined;
  const result = await checkService({ environment, origin, authorization, confirmProduction });
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(() => {
  console.error("Service check could not run. Check the environment and authentication configuration; details are not logged.");
  process.exitCode = 1;
});
