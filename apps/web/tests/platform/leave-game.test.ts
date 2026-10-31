import { afterEach, describe, expect, it, vi } from "vitest";
import { installLeaveGameConfirmation, needsLeaveConfirmation } from "../../src/features/game/leave-game";
import { setLiveContext } from "../../src/features/sharing/share-service";

afterEach(() => { setLiveContext(null); vi.unstubAllGlobals(); });

describe("leaving a paid game", () => {
  it("warns during play, pause and the paid ready screen", () => {
    for (const phase of ["ready", "playing", "paused"] as const) {
      expect(needsLeaveConfirmation({ gameId: "graze-duel", cabinetId: "test", role: "player", phase })).toBe(true);
    }
  });
  it("does not warn spectators, completed runs or unpaid Dot Wave intro", () => {
    expect(needsLeaveConfirmation(null)).toBeFalsy();
    expect(needsLeaveConfirmation({ gameId: "graze-duel", cabinetId: "test", role: "spectator", phase: "playing" })).toBe(false);
    expect(needsLeaveConfirmation({ gameId: "graze-duel", cabinetId: "test", role: "player", phase: "finished" })).toBe(false);
    expect(needsLeaveConfirmation({ gameId: "dot-wave", cabinetId: "test", role: "player", phase: "ready" })).toBe(false);
  });
  for (const accepted of [false, true]) {
    it(`${accepted ? "allows" : "blocks"} navigation after confirmation`, () => {
      let handler: (event: unknown) => void = () => {};
      class Target { closest() { return {}; } }
      const removeEventListener = vi.fn();
      vi.stubGlobal("Element", Target);
      vi.stubGlobal("document", { addEventListener: (_name: string, listener: typeof handler) => { handler = listener; }, removeEventListener });
      const confirm = vi.fn(() => accepted);
      vi.stubGlobal("window", { confirm });
      setLiveContext({ gameId: "graze-duel", cabinetId: "test", role: "player", phase: "playing" });
      const cleanup = installLeaveGameConfirmation();
      const event = { target: new Target(), preventDefault: vi.fn(), stopImmediatePropagation: vi.fn() };
      handler(event);
      expect(confirm).toHaveBeenCalledWith("ほかのゲームを探しに行きますか？\n今のプレイはここで終了します。使用済みのクレジットはそのまま消費されます。");
      expect(event.preventDefault).toHaveBeenCalledTimes(accepted ? 0 : 1);
      expect(event.stopImmediatePropagation).toHaveBeenCalledTimes(accepted ? 0 : 1);
      cleanup();
      expect(removeEventListener).toHaveBeenCalledWith("click", handler, true);
    });
  }
});
