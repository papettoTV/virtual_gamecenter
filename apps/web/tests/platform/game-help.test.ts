import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { GameHelp } from "../../src/features/cabinet/GameHelp";
import { BUZZ_BARRIER, getActiveGames } from "../../src/domain/game";

const modal = vi.hoisted(() => ({ showModal: vi.fn(), close: vi.fn() }));
vi.mock("react", async importOriginal => ({
  ...await importOriginal<typeof import("react")>(),
  useRef: () => ({ current: modal }),
}));

function elements() {
  const view = GameHelp({ game: BUZZ_BARRIER });
  return view.props.children as [ReactElement<{ onClick: () => void; "aria-haspopup": string }>, ReactElement<{
    onClick: (event: { target: object; currentTarget: object }) => void;
    "aria-label": string;
    children: ReactElement<{ children: ReactElement[] }>;
  }>];
}

describe("game instructions modal", () => {
  it("uses the same table rows and populated instructions for every active game", () => {
    for (const game of getActiveGames()) {
      const html = renderToStaticMarkup(createElement(GameHelp, { game }));
      expect(html).toContain('<table class="game-help-table"');
      for (const label of ["目的", "操作", "遊び方", "終了条件", "コツ"]) {
        expect(html).toContain(`<th scope="row">${label}</th>`);
      }
      expect(game.instructions?.objective).toBeTruthy();
      expect(game.instructions?.action).toBeTruthy();
      expect(game.instructions?.ending).toBeTruthy();
    }
  });
  it("opens a native modal dialog with the game name", () => {
    const [trigger, dialog] = elements();
    trigger.props.onClick();
    expect(modal.showModal).toHaveBeenCalled();
    expect(trigger.props["aria-haspopup"]).toBe("dialog");
    expect(dialog.type).toBe("dialog");
    expect(dialog.props["aria-label"]).toBe("BUZZ BARRIERの遊び方");
  });
  it("closes on the backdrop but not when the explanation is clicked", () => {
    modal.close.mockClear();
    const [, dialog] = elements();
    const backdrop = {};
    dialog.props.onClick({ target: {}, currentTarget: backdrop });
    expect(modal.close).not.toHaveBeenCalled();
    dialog.props.onClick({ target: backdrop, currentTarget: backdrop });
    expect(modal.close).toHaveBeenCalledOnce();
  });
});
