import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";

const styles = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
const rendererSource = readFileSync(new URL("../src/games/graze-duel/rendering/three-game-renderer.ts", import.meta.url), "utf8");
const pauseStyles = readFileSync(new URL("../src/games/graze-duel/ui/pause-overlay.css", import.meta.url), "utf8");

it("keeps the result panel opaque and above the Three.js game canvas", () => {
  const overlay = styles.match(/\.ranking-overlay\s*\{([^}]+)\}/)?.[1];
  assert(overlay);
  const overlayLayer = Number(overlay?.match(/z-index:\s*(\d+)/)?.[1]);
  const gameLayer = Number(rendererSource.match(/"z-index:(\d+)"/)?.[1]);
  assert.equal(gameLayer, 1);
  assert(overlayLayer > gameLayer);
  assert.match(overlay, /background:\s*#080a18\s*;/);
  const versusLayer = Number(styles.match(/\.versus-overlay\s*\{[^}]*z-index:\s*(\d+)/)?.[1]);
  assert(overlayLayer < versusLayer);
});

it("keeps pause content above the game and below challenge approval without covering the mobile resume icon", () => {
  const pauseLayer = Number(pauseStyles.match(/z-index:\s*(\d+)/)?.[1]);
  const gameLayer = Number(rendererSource.match(/"z-index:(\d+)"/)?.[1]);
  const versusLayer = Number(styles.match(/\.versus-overlay\s*\{[^}]*z-index:\s*(\d+)/)?.[1]);
  assert(pauseLayer > gameLayer && pauseLayer < versusLayer);
  assert.match(pauseStyles, /\.buzz-pause-overlay\[hidden\]\s*\{\s*display:\s*none;/);
  assert.match(pauseStyles, /\[data-mobile-play\][^{]*\.buzz-pause-overlay\s*\{\s*top:\s*44px;/);
});
