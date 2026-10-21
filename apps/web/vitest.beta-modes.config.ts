import { cloudflarePool } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/worker/beta-modes.test.ts"],
    fileParallelism: false,
    pool: cloudflarePool({
      main: "./src/worker/index.ts",
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: { bindings: { LOCAL_MULTIPLAYER_ENABLED: "false" } },
    }),
  },
});
