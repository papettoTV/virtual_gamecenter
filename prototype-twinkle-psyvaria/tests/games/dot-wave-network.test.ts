import { describe, expect, it, vi } from "vitest";
import { ServerClock, validRemoteTap } from "../../src/games/mochi-beat/duel/network";
import { countdownCue, cueName } from "../../src/games/mochi-beat/duel/turnCue";

describe("DOT WAVE network", () => {
  it("accepts bounded latency but rejects duplicate, old-turn, future and nonfinite input", () => {
    expect(validRemoteTap({ seq: 2, turn: 1, seconds: 2 }, 1, 2.2, 1)).toBe(true);
    for (const input of [{ seq: 1, turn: 1, seconds: 2 }, { seq: 2, turn: 0, seconds: 2 }, { seq: 2, turn: 1, seconds: 1.8 }, { seq: 2, turn: 1, seconds: 2.4 }, { seq: 2, turn: 1, seconds: NaN }]) {
      expect(validRemoteTap(input, 1, 2.2, 1)).toBe(false);
    }
  });
  it("shows the pink participant their own attack and defense countdowns", () => {
    expect(countdownCue(1, 0, "online", 1)).toEqual({ side: 1, kind: "note", count: 4 });
    expect(countdownCue(0, 4, "online", 1)).toEqual({ side: 1, kind: "shield", count: 4 });
    expect(countdownCue(0, 0, "online", 1)).toBeNull();
    expect(countdownCue(1, 0, "online", null)).toBeNull();
    expect(cueName(1, "online", 1)).toBe("あなた");
    expect(cueName(0, "online", 1)).toBe("相手");
  });
  it("uses the lowest round-trip clock sample rather than a delayed packet", () => {
    const clock = new ServerClock();
    clock.sample(1000, 1510, 1020);
    clock.sample(1100, 1680, 1300);
    const spy = vi.spyOn(Date, "now").mockReturnValue(2000);
    expect(clock.now()).toBe(2500);
    spy.mockRestore();
  });
});
