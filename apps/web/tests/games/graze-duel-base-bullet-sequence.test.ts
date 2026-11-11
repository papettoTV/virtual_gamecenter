import { describe, expect, it } from "vitest";
import { getBaseBulletPattern, resetBaseBulletSequences } from "../../src/games/graze-duel/base-bullet-sequence";

function boards(seed: number) {
  const players = [{}, {}] as any[];
  resetBaseBulletSequences(players, seed);
  return players;
}

function shot(player: any) {
  player.basePatternBreakTimer = 0;
  return {
    pattern: getBaseBulletPattern(player),
    remaining: player.basePatternShotsLeft,
    pause: player.basePatternBreakTimer,
  };
}

const series = (player: any, count = 2000) => Array.from({ length: count }, () => shot(player));

describe("通常弾の共通シード系列", () => {
  it("同一シードでは両盤面のパターン・連射数・休止時間が一致する", () => {
    for (const seed of [0, 1, 154, 0xffffffff]) {
      const [left, right] = boards(seed);
      expect(series(left)).toEqual(series(right));
    }
  });

  it("別シードでは異なる系列になり、リトライで両盤面を初期化できる", () => {
    const players = boards(154);
    const original = series(players[0]);
    expect(series(boards(155)[0])).not.toEqual(original);
    series(players[1], 17);
    resetBaseBulletSequences(players, 154);
    expect(series(players[0])).toEqual(original);
    expect(series(players[1])).toEqual(original);
  });

  it("左右を異なる順番・回数で消費しても互いの系列に影響しない", () => {
    const [left, right] = boards(154);
    const expected = series(boards(154)[0]);
    expect(series(right, 731)).toEqual(expected.slice(0, 731));
    expect(series(left)).toEqual(expected);
    expect(series(right, 1269)).toEqual(expected.slice(731));
  });

  it("発射タイミングの消費はパターン系列を変えず、その逆も独立する", () => {
    const [left, right] = boards(154);
    for (let i = 0; i < 83; i++) left.baseBulletTimingRandom();
    expect(series(left)).toEqual(series(right));
    const [first, second] = boards(154);
    series(first);
    expect(Array.from({ length: 100 }, () => first.baseBulletTimingRandom()))
      .toEqual(Array.from({ length: 100 }, () => second.baseBulletTimingRandom()));
  });

  it("7種の既存の重みと18〜30連射・1.8〜3秒未満の休止を維持する", () => {
    const [player] = boards(154);
    const counts: Record<string, number> = {};
    const weights: Record<string, number> = {
      straight: .21, aimed: .19, diagonal: .16, triple: .17,
      fan: .15, curtain: .07, aimedStream: .05,
    };
    // Record only the first failing burst for each invariant; assert after sampling.
    const violations: Record<string, number | null> = {
      invalidLength: null,
      intermediatePause: null,
      patternChange: null,
      unfinishedBurst: null,
      invalidPause: null,
    };
    for (let burst = 0; burst < 10000; burst++) {
      const first = shot(player);
      const length = first.remaining + 1;
      if (!(length >= 18 && length <= 30)) violations.invalidLength ??= burst;
      counts[first.pattern] = (counts[first.pattern] ?? 0) + 1;
      for (let i = 1; i < length; i++) {
        if (player.basePatternBreakTimer !== 0) violations.intermediatePause ??= burst;
        if (getBaseBulletPattern(player) !== first.pattern) violations.patternChange ??= burst;
      }
      if (player.basePatternShotsLeft !== 0) violations.unfinishedBurst ??= burst;
      if (!(player.basePatternBreakTimer >= 1.8 && player.basePatternBreakTimer < 3)) {
        violations.invalidPause ??= burst;
      }
    }
    expect(violations).toEqual({
      invalidLength: null,
      intermediatePause: null,
      patternChange: null,
      unfinishedBurst: null,
      invalidPause: null,
    });
    expect(Object.keys(counts).sort()).toEqual(Object.keys(weights).sort());
    for (const [pattern, weight] of Object.entries(weights)) {
      expect(Math.abs(counts[pattern]! / 10000 - weight)).toBeLessThan(.02);
    }
  });
});
