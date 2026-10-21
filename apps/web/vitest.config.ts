import { cloudflarePool } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts", "src/games/**/*.test.ts"],
    exclude: ["tests/worker/beta-modes.test.ts", "tests/worker/dot-wave-room.test.ts", "tests/worker/recovery-control.test.ts", "tests/worker/session-acceptance.test.ts", "tests/worker/session-operations.test.ts", "tests/worker/session-idle.test.ts"],
    pool: cloudflarePool({
      main: "./src/worker/index.ts",
      miniflare: { bindings: { LOCAL_MULTIPLAYER_ENABLED: "true" } },
      wrangler: {
        configPath: "./wrangler.jsonc",
      },
    }),
  },
});
