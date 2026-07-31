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

  it("moves through challenge, ready, play, result, and solo states", () => {
    const occupied = reduceCabinetState(
      createCabinetState("cabinet-1", 1),
      { type: "PLAYER_JOINED" },
      2,
    );
    const solo = reduceCabinetState(occupied, { type: "START_SOLO" }, 3);
    const pending = reduceCabinetState(solo, { type: "CHALLENGE_REQUESTED" }, 4);
    const ready = reduceCabinetState(pending, { type: "CHALLENGE_ACCEPTED" }, 5);
    const oneReady = reduceCabinetState(ready, { type: "VERSUS_READY", readyCount: 1 }, 6);
    const playing = reduceCabinetState(oneReady, { type: "VERSUS_STARTED" }, 7);
    const result = reduceCabinetState(playing, { type: "VERSUS_RESULT" }, 8);
    const resumedSolo = reduceCabinetState(result, { type: "VERSUS_ENDED" }, 9);

    expect(pending.status).toBe("challengePending");
    expect(oneReady).toMatchObject({ status: "versusReady", readyCount: 1 });
    expect(playing).toMatchObject({ status: "versusPlaying", readyCount: 2 });
    expect(result.status).toBe("result");
    expect(resumedSolo).toMatchObject({ status: "soloPlaying", readyCount: 0 });
  });

  it("returns to solo when a challenge is rejected", () => {
    const solo = {
      ...createCabinetState("cabinet-1", 1),
      status: "soloPlaying" as const,
      playerCount: 1,
    };
    const pending = reduceCabinetState(solo, { type: "CHALLENGE_REQUESTED" }, 2);
    const rejected = reduceCabinetState(pending, { type: "CHALLENGE_CANCELLED" }, 3);

    expect(rejected.status).toBe("soloPlaying");
  });
});
