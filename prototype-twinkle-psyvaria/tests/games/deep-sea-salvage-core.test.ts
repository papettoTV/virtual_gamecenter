import { describe, expect, it } from "vitest";
import {
  BOSS_RESEARCH_RANGE,
  calculateFinalScore,
  crossedBossDepth,
  getResearchRewardMultiplier,
  getRetryScoreMultiplier,
  getSeaLayer,
  NORMAL_RESEARCH_RANGE,
} from "../../src/games/deep-sea-salvage/core";

describe("深海サルベージのゲームルール", () => {
  it("深度を3層へ分類する", () => {
    expect(getSeaLayer(0)).toBe(1);
    expect(getSeaLayer(1_499)).toBe(1);
    expect(getSeaLayer(1_500)).toBe(2);
    expect(getSeaLayer(3_499)).toBe(2);
    expect(getSeaLayer(3_500)).toBe(3);
  });

  it("同種の4回目以降は得点も電力も得られない", () => {
    expect([0, 1, 2, 3, 9].map(getResearchRewardMultiplier)).toEqual([1, .25, .1, 0, 0]);
  });

  it("リトライ倍率は3回以上で50%を下限とする", () => {
    expect([0, 1, 2, 3, 10].map(getRetryScoreMultiplier)).toEqual([1, .8, .65, .5, .5]);
  });

  it("最高深度を初めて越えたときだけボスを出現させる", () => {
    expect(crossedBossDepth(3_999, 4_000, false)).toBe(false);
    expect(crossedBossDepth(4_000, 4_000, false)).toBe(true);
    expect(crossedBossDepth(5_000, 4_000, true)).toBe(false);
  });

  it("巨大なボスは通常魚より広い範囲から調査できる", () => {
    expect(BOSS_RESEARCH_RANGE).toBeGreaterThan(NORMAL_RESEARCH_RANGE * 2);
  });

  it("クリア時だけボス得点と残り電力を加え、リトライ倍率を適用する", () => {
    expect(calculateFinalScore({ earnedScore: 5_000, cleared: true, remainingPower: 40, retryCount: 1 })).toEqual({
      subtotal: 21_000,
      multiplier: .8,
      total: 16_800,
    });
    expect(calculateFinalScore({ earnedScore: 5_000, cleared: false, remainingPower: 0, retryCount: 0 }).total).toBe(5_000);
  });
});
