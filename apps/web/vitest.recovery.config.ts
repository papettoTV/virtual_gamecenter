import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [cloudflareTest({
    main: "./src/recovery/worker.ts",
    wrangler: { configPath: "./wrangler.jsonc" },
    miniflare: { durableObjects: { RECOVERY_CONTROL: "RecoveryControl" }, bindings: { RECOVERY_DRILL: "true" } },
  })],
  test: {
    include: ["tests/worker/recovery-control.test.ts"],
  },
});
