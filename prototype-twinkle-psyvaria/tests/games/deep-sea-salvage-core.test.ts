import { describe, expect, it } from "vitest";
import {
  BOSS_ANALYSIS_RANGE,
  canFireTransmitter,
  ensureBossAnalysis,
  fireTransmitter,
  TRANSMITTER_RANGE,
} from "../../src/games/deep-sea-salvage/core";

describe("深海サルベージのボス距離判定", () => {
  it("解析範囲より発信器射出範囲の方が狭い", () => {
    expect(TRANSMITTER_RANGE).toBeLessThan(BOSS_ANALYSIS_RANGE);
  });

  it("112pxの境界上で発信器を射出できる", () => {
    expect(canFireTransmitter({ distance: 112, analysis: 1, exposed: .1, cooldown: 0 })).toBe(true);
    expect(canFireTransmitter({ distance: 112.01, analysis: 1, exposed: .1, cooldown: 0 })).toBe(false);
  });

  it("解析ゲージ、弱点露出、射出間隔がすべて必要", () => {
    expect(canFireTransmitter({ distance: 80, analysis: 0, exposed: .1, cooldown: 0 })).toBe(false);
    expect(canFireTransmitter({ distance: 80, analysis: 1, exposed: 0, cooldown: 0 })).toBe(false);
    expect(canFireTransmitter({ distance: 80, analysis: 1, exposed: .1, cooldown: .01 })).toBe(false);
  });

  it("条件を満たすと実際に1発射出し、HPと演出状態を更新する", () => {
    expect(fireTransmitter({ hp: 5, distance: 100, analysis: 20, exposed: .1, cooldown: 0 })).toEqual({
      fired: true,
      hp: 4,
      cooldown: .6,
      flash: .24,
    });
    expect(fireTransmitter({ hp: 5, distance: 113, analysis: 20, exposed: .1, cooldown: 0 }).fired).toBe(false);
  });

  it("ボス戦開始時に撃破に必要な解析ゲージを保証する", () => {
    expect(ensureBossAnalysis(0)).toBe(50);
    expect(ensureBossAnalysis(24)).toBe(50);
    expect(ensureBossAnalysis(82)).toBe(82);
  });
});
