import { cloudflarePool } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/worker/dot-wave-room.test.ts"],
    fileParallelism: false,
    pool: cloudflarePool({
      main: "./src/worker/index.ts",
      miniflare: { bindings: { LOCAL_MULTIPLAYER_ENABLED: "true" } },
      wrangler: { configPath: "./wrangler.jsonc" },
    }),
  },
});
