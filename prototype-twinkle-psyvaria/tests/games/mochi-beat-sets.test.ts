import { describe, expect, it } from "vitest";
import { createSession, advanceSet, completeSet, sessionResult, SET_BPMS, SESSION_SECONDS, TOTAL_BEATS, hit, displayBeat } from "../../src/games/mochi-beat/core";

describe("three rhythm sets", () => {
  it("uses progressively faster clocks and restarts each chart with a count-in", () => {
    const session = createSession();
    expect(session.runs.map((run) => 60 / run.beatSeconds)).toEqual([...SET_BPMS]);
    expect(SESSION_SECONDS).toBeCloseTo(144.84127);
    for (const run of session.runs) {
      expect(run.notes[0]!.beat).toBe(8);
      expect(Math.floor((displayBeat(TOTAL_BEATS * run.beatSeconds, run.beatSeconds) - 4) % 8 * 2)).toBe(15);
    }
  });
  it("requires completing and explicitly advancing each set, clearing only after set 3", () => {
    const session = createSession();
    expect(advanceSet(session)).toBe(false);
    expect(completeSet(session)).toBe(false);
    expect(session.setIndex).toBe(0);
    expect(advanceSet(session)).toBe(true);
    expect(advanceSet(session)).toBe(false);
    expect(completeSet(session)).toBe(false);
    expect(advanceSet(session)).toBe(true);
    expect(completeSet(session)).toBe(true);
    expect(session.completedSets).toBe(3);
    expect(advanceSet(session)).toBe(false);
  });
  it("judges all three tempi correctly and carries score and combo through breaks", () => {
    const session = createSession();
    for (let index = 0; index < 3; index++) {
      const run = session.runs[index]!;
      for (const note of run.notes) expect(hit(run, note.beat * run.beatSeconds)?.judgment).toBe("perfect");
      completeSet(session);
      if (index < 2) advanceSet(session);
    }
    expect(sessionResult(session)).toMatchObject({ score: 100_000, perfect: 132, miss: 0, maxCombo: 132 });
    expect(createSession().runs[0]!.combo).toBe(0);
  });
  it("shrinks the timing window with the beat duration at higher tempos", () => {
    const session = createSession();
    const slow = session.runs[0]!;
    const fast = session.runs[2]!;
    expect(hit(slow, slow.notes[0]!.beat * slow.beatSeconds + .14)?.judgment).toBe("good");
    expect(hit(fast, fast.notes[0]!.beat * fast.beatSeconds + .14)?.judgment).toBe("miss");
  });
});
