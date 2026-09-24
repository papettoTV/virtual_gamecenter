import { describe, expect, it } from "vitest";
import { mochiFinish, mochiImpact } from "../../src/games/mochi-beat/mochi";

describe("mochi presentation", () => {
  it.each([[0, "poor"], [59_999, "poor"], [60_000, "standard"], [79_999, "standard"], [80_000, "excellent"], [100_000, "excellent"]])("finishes score %s as %s", (score, kind) => {
    expect(mochiFinish(Number(score)).kind).toBe(kind);
  });
  it("makes accurate strikes dent deeply while missed strikes only bounce", () => {
    const perfect = mochiImpact("perfect", .1);
    const good = mochiImpact("good", .1);
    const miss = mochiImpact("miss", .1);
    expect(perfect.dent).toBeGreaterThan(good.dent * 2);
    expect(perfect.spread).toBeGreaterThan(good.spread);
    expect(perfect.bounce).toBe(0);
    expect(miss.dent).toBe(0);
    expect(miss.bounce).toBeGreaterThan(0);
    expect(miss.bounce).toBeLessThanOrEqual(8);
  });
  it("returns to the resting shape and does not celebrate unjudged taps", () => {
    for (const judgment of ["perfect", "good", "miss", null] as const) {
      for (const age of [-1, 0, .46, 1]) expect(mochiImpact(judgment, age)).toEqual({ dent: 0, spread: 0, bounce: 0 });
    }
    expect(mochiImpact(null, .1)).toEqual({ dent: 0, spread: 0, bounce: 0 });
  });
});

import { advanceCompletion, COMPLETION_SECONDS, displayBeat, RUN_SECONDS, TOTAL_BEATS, COUNT_IN } from "../../src/games/mochi-beat/core";

describe("mochi ending", () => {
  it("holds the final response subdivision even after the song ends", () => {
    for (const seconds of [RUN_SECONDS, RUN_SECONDS + .3, RUN_SECONDS + 10]) {
      const beat = displayBeat(seconds);
      expect(beat).toBeLessThan(TOTAL_BEATS);
      expect(Math.floor(((beat - COUNT_IN) % 8 % 4) * 2)).toBe(7);
    }
  });
  it("shows the completed dish for 3.5 visible seconds before results", () => {
    let elapsed = 0;
    for (let i = 0; i < 34; i++) elapsed = advanceCompletion(elapsed, .1, true);
    expect(elapsed).toBeLessThan(COMPLETION_SECONDS);
    elapsed = advanceCompletion(elapsed, .1, true);
    expect(elapsed).toBe(COMPLETION_SECONDS);
  });
  it("does not skip the reveal when the tab is hidden or a frame stalls", () => {
    expect(advanceCompletion(1, 60, false)).toBe(1);
    expect(advanceCompletion(1, 60, true)).toBe(1.1);
  });
});
