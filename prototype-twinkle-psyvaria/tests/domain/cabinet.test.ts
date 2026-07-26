import { describe, expect, it } from "vitest";
import {
  assignCabinetRole,
  createCabinetState,
  reduceCabinetState,
} from "../../src/domain/cabinet";

describe("cabinet state", () => {
  it("assigns the first visitor as player and later visitors as spectators", () => {
    const empty = createCabinetState("cabinet-1", 1);
    expect(assignCabinetRole(empty)).toBe("player");

    const occupied = reduceCabinetState(empty, { type: "PLAYER_JOINED" }, 2);
    expect(assignCabinetRole(occupied)).toBe("spectator");
    expect(occupied.status).toBe("occupied");
  });

  it("keeps spectator count non-negative", () => {
    const state = createCabinetState("cabinet-1", 1);
    expect(
      reduceCabinetState(state, { type: "SPECTATOR_LEFT" }, 2).spectatorCount,
    ).toBe(0);
  });

  it("returns to empty when the seated player leaves", () => {
    const occupied = reduceCabinetState(
      createCabinetState("cabinet-1", 1),
      { type: "PLAYER_JOINED" },
      2,
    );
    const empty = reduceCabinetState(occupied, { type: "PLAYER_LEFT" }, 3);
    expect(empty).toMatchObject({ status: "empty", playerCount: 0 });
  });
});
