import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BuzzPausePanel } from "../../src/games/graze-duel/ui/BuzzPauseOverlay";
import type { LiveShareContext } from "../../src/features/sharing/share-service";

const context: LiveShareContext = { gameId: "graze-duel", cabinetId: "test", role: "player", phase: "paused" };
const render = (state: LiveShareContext | null, compact = true) => renderToStaticMarkup(createElement(BuzzPausePanel, { context: state, compact }));

describe("BUZZ BARRIER pause overlay", () => {
  it("only points to the upper-right resume icon and keeps the leave action quiet", () => {
    const html = render(context);
    expect(html).toContain('role="region" aria-label="一時停止"');
    expect(html).not.toContain("buzz-pause-resume");
    expect(html).toContain('class="buzz-pause-leave" type="button">別のゲームをする</button>');
    expect(html).not.toContain("中央");
    expect(html).toContain("右上の「▶」");
    expect(html).toContain("ゲーム画面をスライド");
    expect(html).not.toContain("「再開」ボタンでゲーム再開");
  });

  it("keeps keyboard instructions on desktop", () => {
    const html = render(context, false);
    expect(html).toContain("Spaceで再開");
    expect(html).toContain("WASD");
    expect(html).toContain("Shift");
  });

  it("does not let spectators resume the player's game", () => {
    const html = render({ ...context, role: "spectator" });
    expect(html).toContain("プレイヤーの再開を待っています");
    expect(html).not.toContain("buzz-pause-resume");
    expect(html).not.toContain("ゲーム画面をスライド");
  });

  it("stays hidden during READY, play, results, and other games", () => {
    for (const state of [null, { ...context, phase: "ready" as const }, { ...context, phase: "playing" as const }, { ...context, phase: "finished" as const }, { ...context, gameId: "deep-sea-salvage" }]) {
      const html = render(state);
      expect(html).toContain('hidden=""');
      expect(html).not.toContain("<button");
    }
  });
});
