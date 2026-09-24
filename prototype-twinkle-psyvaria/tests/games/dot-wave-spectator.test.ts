import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { DotScene } from "../../src/games/mochi-beat/duel/DotScene";
import type { Engine } from "../../src/games/mochi-beat/duel/MochiDuel";
import { createMatch, createExchange, BEAT } from "../../src/games/mochi-beat/duel/core";

function battle(): Engine {
  const exchange = createExchange(0, 0, BEAT);
  exchange.attack.notes.forEach(note => { note.grade = "perfect"; });
  return { phase: "playing", mode: "online", match: createMatch("limited"), selected: 0,
    exchange, seconds: 8 * BEAT, outcome: null, impactElapsed: 0, feedback: "", cpu: [],
    flash: { side: 0, grade: "perfect", at: 8 * BEAT }, inputWarning: null };
}

it("keeps the complete battle scene for spectators, removing only turn guidance", () => {
  const engine = battle();
  const player = renderToStaticMarkup(createElement(DotScene, { engine, viewSide: 1 }));
  const spectator = renderToStaticMarkup(createElement(DotScene, { engine, viewSide: null }));
  expect(player).not.toContain("dot-turn-ring");
  expect(player).toContain("dot-turn-badge");
  expect(spectator).not.toContain("dot-turn-ring");
  expect(spectator).not.toContain("dot-turn-badge");
  // The characters, projectiles, shield and hit effects are the same SVG scene.
  const withoutGuidance = player.replace(/<g[^>]*class="dot-turn-ring"[^>]*>.*?<\/g>/g, "").replace(/<div class="dot-turn-badge.*?<\/div>/g, "");
  expect(spectator).toBe(withoutGuidance);
  expect(spectator).toContain("dot-hit-effect perfect");
  engine.seconds += BEAT / 2;
  expect(renderToStaticMarkup(createElement(DotScene, { engine, viewSide: null }))).not.toBe(spectator);
});

it("never shows turn guidance to spectators even for a local-mode snapshot", () => {
  const engine = battle(); engine.mode = "local";
  const html = renderToStaticMarkup(createElement(DotScene, { engine, viewSide: null }));
  expect(html).not.toContain("dot-turn-badge");
  expect(html).not.toContain("dot-turn-ring");
});
