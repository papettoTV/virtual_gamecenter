import { cloudflarePool } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts", "src/games/**/*.test.ts"],
    exclude: ["tests/worker/recovery-control.test.ts", "tests/worker/session-acceptance.test.ts", "tests/worker/session-operations.test.ts", "tests/worker/session-idle.test.ts"],
    pool: cloudflarePool({
      main: "./src/worker/index.ts",
      wrangler: {
        configPath: "./wrangler.jsonc",
      },
    }),
  },
});
