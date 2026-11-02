import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { GameScreen } from "../../src/features/game/GameScreen";
import { GAME_CATALOG } from "../../src/domain/game";
import MochiDuel from "../../src/games/dot-wave/duel/MochiDuel";
import type { DuelLink } from "../../src/games/dot-wave/duel/network";
import { DotWaveResult } from "../../src/games/dot-wave/duel/DotWaveResult";

const state = vi.hoisted(() => ({ phase: "finished", winner: 1, stage: 1 }));
vi.mock("../../src/features/sharing/ShareActions", () => ({ LiveShareButton: () => null, ResultShareButton: () => createElement("button", null, "結果を共有") }));
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

it.each(GAME_CATALOG)("places secondary actions after $id result and retry actions", game => {
  const html = renderToStaticMarkup(createElement(GameScreen, { game }));
  const panel = html.slice(html.indexOf('id="ranking-submit-panel"'), html.indexOf('class="spectator-game-actions"'));
  expect(panel).toContain('class="result-feedback"');
  expect(panel.indexOf("感想・不具合を送る")).toBeGreaterThan(panel.indexOf('id="ranking-submit"'));
  expect(panel.indexOf('id="ranking-retry"')).toBeLessThan(panel.indexOf('id="ranking-another-game"'));
  expect(panel.indexOf("感想・不具合を送る")).toBeGreaterThan(panel.indexOf('id="ranking-another-game"'));
  expect(panel.indexOf("結果を共有")).toBeGreaterThan(panel.indexOf('id="ranking-another-game"'));
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

it("groups DOT WAVE final result before retry and secondary feedback", () => {
  const html = renderToStaticMarkup(createElement(DotWaveResult, {
    summary: { title: "ALL CLEAR", score: 54820, details: [["最大コンボ", "42"]] },
    actions: createElement("button", null, "リトライ"), share: createElement("button", null, "結果を共有"),
  }));
  expect(html).toContain("54,820");
  expect(html.indexOf("54,820")).toBeLessThan(html.indexOf("リトライ"));
  expect(html.indexOf("リトライ")).toBeLessThan(html.indexOf("結果を共有"));
  expect(html.indexOf("結果を共有")).toBeLessThan(html.indexOf("感想・不具合を送る"));
});

it("keeps DOT WAVE held player results actionable without exposing gameplay controls", () => {
  state.phase = "finished"; state.winner = 1; state.stage = 1;
  const html = renderToStaticMarkup(createElement<{ holdResult?: boolean; onResultRetry?: () => void }>(MochiDuel, { holdResult: true, onResultRetry: () => {} }));
  expect(html).toContain('class="dot-result-card"');
  expect(html).toContain("GAME OVER");
  expect(html).toContain("別のゲームを探す");
  expect(html).toContain('class="duel-controls" hidden=""');
  expect(html).not.toContain('class="dot-scene-wrap"');
  expect(html.indexOf('class="dot-result-actions"')).toBeLessThan(html.indexOf("感想・不具合を送る"));
});
