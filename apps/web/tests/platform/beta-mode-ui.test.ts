import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { GameScreen } from "../../src/features/game/GameScreen";
import { GAME_CATALOG } from "../../src/domain/game";
import MochiDuel from "../../src/games/dot-wave/duel/MochiDuel";

vi.mock("../../src/features/sharing/ShareActions", () => ({ LiveShareButton: () => null, ResultShareButton: () => null }));

it.each(GAME_CATALOG)("does not render a challenge entry for $id", game => {
  const html = renderToStaticMarkup(createElement(GameScreen, { game }));
  expect(html).not.toContain('id="challenge-request"');
  expect(html).not.toContain("1クレジットで対戦申込");
  expect(html).toContain("観戦用画面を共有");
});

it("does not offer local multiplayer or advertise online battles in the beta intro", () => {
  const html = renderToStaticMarkup(createElement(MochiDuel));
  expect(html).not.toContain('value="local"');
  expect(html).not.toContain("通信対戦に対応");
  expect(html).toContain("ソロプレイ・観戦に対応");
  expect(html).toContain("START");
});
