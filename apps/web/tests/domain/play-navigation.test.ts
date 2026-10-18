import { describe, expect, it, vi } from "vitest";
import { gamePlayUrl, startNewGame } from "../../src/features/cabinet/play-navigation";
import { navigate } from "../../src/shared/navigation";
import { getActiveGames } from "../../src/domain/game";

vi.mock("../../src/shared/navigation", () => ({ navigate: vi.fn() }));

describe("direct game entry", () => {
  it.each(getActiveGames())("creates a new start-confirmation URL for $id", game => {
    const url = new URL(gamePlayUrl(game.id, "test-cabinet"), "https://example.test");
    expect(url.pathname).toBe("/cabinets/test-cabinet");
    expect(url.searchParams.get("game")).toBe(game.id);
    expect(url.searchParams.get("start")).toBe("1");
    expect(url.searchParams.has("watch")).toBe(false);
  });
  it("always allocates a fresh cabinet instead of taking a watched seat", () => {
    expect(gamePlayUrl("graze-duel")).not.toBe(gamePlayUrl("graze-duel"));
  });
  it("navigates directly to confirmation, not to game selection", () => {
    startNewGame("dot-wave");
    expect(navigate).toHaveBeenCalledWith(expect.stringMatching(/^\/cabinets\/[^?]+\?game=dot-wave&start=1$/));
  });
});
