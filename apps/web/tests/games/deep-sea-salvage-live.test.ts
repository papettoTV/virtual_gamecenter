import { describe, expect, it } from "vitest";
import { SalvageLiveBuffer, type SalvageLiveState } from "../../src/games/deep-sea-salvage/live-state";

function frame(overrides: Partial<SalvageLiveState> = {}): SalvageLiveState {
  return {
    runId: "run-one", phase: "dive", paused: false, collectionOpen: false,
    elapsed: 10, subX: 400, subDepth: 100, maxDepth: 100, subVDepth: 20, subHeading: 0,
    invincible: 0, hull: 3, power: 90, earnedScore: 100, finalScore: 0, cleared: false, retryCount: 0,
    bossProgress: 0, boss: { active: false, x: 0, depth: 0, baseDepth: 0, direction: 1, flash: 0, wobbleAmplitude: 0, wobbleFrequency: 0, wobblePhase: 0 },
    bossClearTimer: 0, hullBreakTimer: 0, hullBreakTitle: "船体が大破した", bossGaugeVisible: false,
    fishes: [{ id: 1, speciesId: "sun-sardine", x: 300, depth: 120, vx: 20, baseDepth: 120, phase: 0,
      research: 0, completed: false, flash: 0, completionEffect: 0, pattern: "cruise", activated: false, alertTimer: 0, inHollow: false, homeX: 300 }],
    targetFishIds: [], discovered: [], message: "潜航中", messageTimer: 0, ...overrides,
  };
}

describe("salvage live rendering", () => {
  it("interpolates the submarine and matching fish without running gameplay", () => {
    const buffer = new SalvageLiveBuffer();
    const previous = frame();
    const current = frame({ subX: 500, subDepth: 120, fishes: [{ ...previous.fishes[0]!, x: 340, depth: 140 }] });
    buffer.push(previous, 1, 1000); buffer.push(current, 2, 1100);
    const sample = buffer.sample(1150)!;
    expect(sample.subX).toBe(450); expect(sample.subDepth).toBe(110);
    expect(sample.fishes[0]?.x).toBe(320); expect(sample.power).toBe(90);
    expect(buffer.sample(2000)?.subX).toBe(500);
    expect(previous.subX).toBe(400); expect(current.fishes[0]?.x).toBe(340);
  });

  it("discards reordered packets and immediately renders pauses, results and new runs", () => {
    const buffer = new SalvageLiveBuffer();
    buffer.push(frame(), 1, 1000);
    const paused = frame({ paused: true, subX: 600 });
    buffer.push(paused, 3, 1100);
    expect(buffer.push(frame({ subX: 900 }), 2, 1200)).toBe(false);
    expect(buffer.sample(1100)).toEqual(paused);
    const result = frame({ phase: "result", finalScore: 3000, paused: true });
    buffer.push(result, 4, 1300); expect(buffer.sample(1300)?.finalScore).toBe(3000);
    buffer.push(frame({ runId: "run-two", subX: 480 }), 5, 1400);
    expect(buffer.sample(1400)?.subX).toBe(480);
  });

  it("does not interpolate a new fish with a removed fish and resets after the player leaves", () => {
    const buffer = new SalvageLiveBuffer();
    buffer.push(frame(), 1, 1000);
    const state = frame(); state.fishes[0] = { ...state.fishes[0]!, id: 2, x: 700 };
    buffer.push(state, 2, 1100);
    expect(buffer.sample(1150)?.fishes).toEqual(state.fishes);
    buffer.clear(); expect(buffer.sample(1200)).toBeNull();
    expect(buffer.push(frame(), 1, 1300)).toBe(true);
  });
});
