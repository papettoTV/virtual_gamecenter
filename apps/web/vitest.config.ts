import { cloudflarePool } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    pool: cloudflarePool({
      main: "./src/worker/index.ts",
      wrangler: {
        configPath: "./wrangler.jsonc",
      },
    }),
  },
});
