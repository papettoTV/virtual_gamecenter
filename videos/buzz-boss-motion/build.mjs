import { createRequire } from "node:module";
import { copyFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const directory = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(directory, "../../apps/web/package.json"));
const { build } = require("esbuild");
const threeDirectory = path.dirname(require.resolve("three"));
await mkdir(path.join(directory, "assets"), { recursive: true });
for (const filename of ["three.module.js", "three.core.js"]) {
  await copyFile(path.join(threeDirectory, filename), path.join(directory, "assets", filename));
}
await build({
  entryPoints: [path.join(directory, "../../apps/web/src/games/graze-duel/rendering/boss-geometry.ts")],
  outfile: path.join(directory, "assets/boss-geometry.js"),
  format: "esm",
  bundle: true,
});
