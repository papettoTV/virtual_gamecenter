import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [cloudflareTest({ main: "./src/recovery/operation-drill.ts", wrangler: { configPath: "./config/operation-drill.json" } })],
  test: { include: ["tests/worker/operation-drill.runtime.ts"] },
});
