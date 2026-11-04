import { expect, it } from "vitest";
import styles from "../styles.css?raw";
import rendererSource from "../src/games/graze-duel/rendering/three-game-renderer.ts?raw";

it("keeps the result panel opaque and above the Three.js game canvas", () => {
  const overlay = styles.match(/\.ranking-overlay\s*\{([^}]+)\}/)?.[1];
  expect(overlay).toBeDefined();
  const overlayLayer = Number(overlay?.match(/z-index:\s*(\d+)/)?.[1]);
  const gameLayer = Number(rendererSource.match(/"z-index:(\d+)"/)?.[1]);
  expect(gameLayer).toBe(1);
  expect(overlayLayer).toBeGreaterThan(gameLayer);
  expect(overlay).toMatch(/background:\s*#080a18\s*;/);
  const versusLayer = Number(styles.match(/\.versus-overlay\s*\{[^}]*z-index:\s*(\d+)/)?.[1]);
  expect(overlayLayer).toBeLessThan(versusLayer);
});
