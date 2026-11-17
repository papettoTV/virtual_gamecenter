import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { CabinetScreen } from "../../src/features/cabinet/CabinetScreen";
import { SpectatorGate } from "../../src/features/cabinet/SpectatorGate";
import { BUZZ_BARRIER, DEEP_SEA_SALVAGE, getActiveGames } from "../../src/domain/game";

const state = vi.hoisted(() => ({ playerCount: null as number | null }));
vi.mock("react", async importOriginal => ({
  ...await importOriginal<typeof import("react")>(),
  useState: () => [state.playerCount, vi.fn()],
  useEffect() {},
  useRef: (current: unknown) => ({ current }),
}));

function render(search = "?watch=1", preview = false, game = BUZZ_BARRIER) {
  return renderToStaticMarkup(createElement(SpectatorGate, {
    game, url: new URL(`https://example.test/cabinets/test${search}`), preview, children: createElement("div", null, "GAME"),
  }));
}

describe("spectator availability", () => {
  it("offers a new game or a return to the arcade for an ended or not-yet-started play", () => {
    state.playerCount = 0;
    for (const game of getActiveGames()) {
      const html = render("?watch=1", false, game);
      expect(html).toMatch(/<a class="cabinet-return-link" href="\/">‹ ゲーム一覧へ<\/a><section class="spectator-availability"/);
      expect(html).toContain(game.title);
      expect(html).toContain("プレイは終了したか、まだ始まっていません");
      expect(html).toMatch(/自分も遊ぶ<\/button><\/div><details class="game-help game-help-inline"><summary>遊び方<\/summary>/);
      expect(html).toContain('class="spectator-offline"');
    }
  });
  it("does not interrupt a running play", () => {
    state.playerCount = 1;
    expect(render()).not.toContain("spectator-availability");
    expect(render()).not.toContain('class="spectator-offline"');
  });
  it("does not hide the player or embedded preview", () => {
    state.playerCount = 0;
    expect(render("?start=1")).toBe("<div>GAME</div>");
    expect(render("?watch=1&preview=1", true)).toBe("<div>GAME</div>");
  });
  it("waits for the authoritative socket state before declaring a play unavailable", () => {
    state.playerCount = null;
    expect(render()).not.toContain("spectator-availability");
  });
});

it("puts the arcade link outside the waiting cards and instructions inside for both canvas games", () => {
  vi.stubGlobal("location", { search: "" });
  try {
    for (const game of [BUZZ_BARRIER, DEEP_SEA_SALVAGE]) {
      const html = renderToStaticMarkup(createElement(CabinetScreen, { game }));
      expect(html).toMatch(/<a id="back-to-arcade"[^>]*>‹ ゲーム一覧へ<\/a><div class="arcade-card">/);
      expect(html).toMatch(/<details class="game-help game-help-inline"><summary>遊び方<\/summary>.*<\/details><\/div><\/section>/);
    }
  } finally {
    vi.unstubAllGlobals();
  }
});
