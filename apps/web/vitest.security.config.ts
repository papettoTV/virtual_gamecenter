import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [cloudflareTest({ main: "./src/worker/index.ts", wrangler: { configPath: "./wrangler.jsonc" } })],
  test: { include: ["tests/worker/session-acceptance.test.ts", "tests/worker/session-operations.test.ts"] },
});
