import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SpectatorGate } from "../../src/features/cabinet/SpectatorGate";
import { BUZZ_BARRIER } from "../../src/domain/game";

const state = vi.hoisted(() => ({ playerCount: null as number | null }));
vi.mock("react", async importOriginal => ({
  ...await importOriginal<typeof import("react")>(),
  useState: () => [state.playerCount, vi.fn()],
  useEffect() {},
}));

function render(search = "?watch=1", preview = false) {
  return renderToStaticMarkup(createElement(SpectatorGate, {
    game: BUZZ_BARRIER, url: new URL(`https://example.test/cabinets/test${search}`), preview, children: createElement("div", null, "GAME"),
  }));
}

describe("spectator availability", () => {
  it("offers a new game or a return to the arcade for an ended or not-yet-started play", () => {
    state.playerCount = 0;
    const html = render();
    expect(html).toContain("プレイは終了したか、まだ始まっていません");
    expect(html).toContain("自分も遊ぶ");
    expect(html).toContain("ほかのゲームを見る");
    expect(html).toContain('class="spectator-offline"');
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
