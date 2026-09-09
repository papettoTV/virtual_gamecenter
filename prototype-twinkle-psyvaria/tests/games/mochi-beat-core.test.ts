import { describe, expect, it } from "vitest";
import { BEAT_SECONDS, COUNT_IN, HIT_WINDOW, PATTERNS, PERFECT_WINDOW, TOTAL_BEATS, createRun, hit, missExpired, result } from "../../src/games/mochi-beat/core";

describe("mochi beat rhythm judgment", () => {
  it("copies every demonstration into the following four-beat response", () => {
    const run = createRun();
    expect(run.notes).toHaveLength(PATTERNS.reduce((sum, pattern) => sum + pattern.length, 0));
    expect(run.notes[0]!.beat).toBe(COUNT_IN + 4);
    expect(run.notes.at(-1)!.beat).toBeLessThan(TOTAL_BEATS);
    for (const note of run.notes) expect(PATTERNS[note.round]).toContain(note.beat - COUNT_IN - note.round * 8 - 4);
  });

  it("gives a perfect full combo exactly 100,000 points", () => {
    const run = createRun();
    for (const note of run.notes) expect(hit(run, note.beat * BEAT_SECONDS)?.judgment).toBe("perfect");
    expect(result(run)).toMatchObject({ score: 100_000, miss: 0, good: 0 });
    expect(run.maxCombo).toBe(run.notes.length);
  });

  it.each([-1, 1])("accepts both edges of the timing windows (sign %s)", (sign) => {
    const perfect = createRun();
    expect(hit(perfect, perfect.notes[0]!.beat * BEAT_SECONDS + sign * PERFECT_WINDOW)?.judgment).toBe("perfect");
    const good = createRun();
    expect(hit(good, good.notes[0]!.beat * BEAT_SECONDS + sign * HIT_WINDOW)?.judgment).toBe("good");
  });

  it("allows an early first response and preserves the next half-beat note", () => {
    const run = createRun();
    const first = run.notes.find((note) => note.round === 4)!;
    hit(run, first.beat * BEAT_SECONDS - .1);
    expect(first.judgment).toBe("good");
    expect(hit(run, (first.beat + .5) * BEAT_SECONDS)?.judgment).toBe("perfect");
  });

  it("does not score a note twice and penalizes extra response taps", () => {
    const run = createRun(); const at = run.notes[0]!.beat * BEAT_SECONDS;
    hit(run, at); const score = result(run).score;
    expect(hit(run, at + .01)?.judgment).toBe("miss");
    expect(result(run).perfect).toBe(1);
    expect(run.extras).toBe(1);
    expect(result(run).score).toBeLessThan(score);
    expect(run.combo).toBe(0);
  });

  it("allows tapping along with the count-in and demonstration", () => {
    const run = createRun();
    expect(hit(run, BEAT_SECONDS)).toBeNull();
    expect(hit(run, COUNT_IN * BEAT_SECONDS)).toBeNull();
    expect(run.extras).toBe(0);
  });

  it("expires skipped notes, resets combo, and never goes below zero", () => {
    const run = createRun();
    hit(run, run.notes[0]!.beat * BEAT_SECONDS);
    expect(missExpired(run, TOTAL_BEATS * BEAT_SECONDS)).toBe(true);
    expect(run.combo).toBe(0);
    expect(run.maxCombo).toBe(1);
    expect(result(run).miss).toBe(run.notes.length - 1);
    run.extras = 1000;
    expect(result(run).score).toBe(0);
    expect(missExpired(run, TOTAL_BEATS * BEAT_SECONDS + 1)).toBe(false);
  });
});
