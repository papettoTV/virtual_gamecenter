import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { GameScreen } from "../../src/features/game/GameScreen";
import { GAME_CATALOG } from "../../src/domain/game";
import MochiDuel from "../../src/games/dot-wave/duel/MochiDuel";
import type { DuelLink } from "../../src/games/dot-wave/duel/network";

const state = vi.hoisted(() => ({ phase: "finished", winner: 1, stage: 1 }));
vi.mock("../../src/features/sharing/ShareActions", () => ({ LiveShareButton: () => null, ResultShareButton: () => null }));
vi.mock("../../src/games/dot-wave/duel/campaign", async importOriginal => {
  const original = await importOriginal<typeof import("../../src/games/dot-wave/duel/campaign")>();
  return { ...original, freshDuel: (...args: Parameters<typeof original.freshDuel>) => {
    const engine = original.freshDuel(...args);
    engine.phase = state.phase as typeof engine.phase;
    engine.match.winner = state.winner as 0 | 1;
    engine.cpuStage = state.stage as 1 | 2 | 3;
    return engine;
  } };
});

it.each(GAME_CATALOG)("places a shared feedback action near the top of $id result registration", game => {
  const html = renderToStaticMarkup(createElement(GameScreen, { game }));
  const panel = html.slice(html.indexOf('id="ranking-submit-panel"'), html.indexOf('class="spectator-game-actions"'));
  expect(panel).toContain('class="result-feedback"');
  expect(panel.indexOf("感想・不具合を送る")).toBeLessThan(panel.indexOf('id="ranking-submit"'));
});

it("offers feedback on DOT WAVE game over and final clear, but not between stages or during play", () => {
  const draw = () => renderToStaticMarkup(createElement(MochiDuel));
  state.phase = "finished"; state.winner = 1; state.stage = 1;
  expect(draw()).toContain('class="result-feedback"');
  state.winner = 0; state.stage = 3;
  expect(draw()).toContain('class="result-feedback"');
  state.stage = 1;
  expect(draw()).not.toContain('class="result-feedback"');
  state.phase = "playing"; state.winner = 1;
  expect(draw()).not.toContain('class="result-feedback"');
});

it("does not put the player result action on DOT WAVE spectator endings", () => {
  state.phase = "finished"; state.winner = 1; state.stage = 1;
  const network = { role: "spectator", side: null } as unknown as DuelLink;
  expect(renderToStaticMarkup(createElement<{ network?: DuelLink }>(MochiDuel, { network }))).not.toContain('class="result-feedback"');
});
