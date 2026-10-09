import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "src/games/dot-wave/duel/*.test.ts",
      "tests/games/mochi-duel*.test.ts",
    ],
  },
});
