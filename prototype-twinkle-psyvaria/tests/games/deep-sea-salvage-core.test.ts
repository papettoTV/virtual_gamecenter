import { describe, expect, it } from "vitest";
import {
  BOSS_RESEARCH_RANGE,
  FISH_PATTERNS,
  MAX_HULL,
  canFishCollide,
  damageHull,
  getFishSafetyVisual,
  isBossBodyColliding,
  isBossBodyResearchable,
  getFishSpawnMultiplier,
  getBossWobbleDepth,
  BASE_POWER_DRAIN,
  calculateFinalScore,
  crossedBossDepth,
  getCurrentStrength,
  getPowerDrainMultiplier,
  getRareSpawnRate,
  getResearchRewardMultiplier,
  getRetryScoreMultiplier,
  getSeaLayer,
  getRegularFishSpawnCount,
  getSubmarinePitch,
  getSubmarineHeadingTarget,
  getSubmarineLightLevel,
  NORMAL_RESEARCH_RANGE,
} from "../../src/games/deep-sea-salvage/core";

describe("深海サルベージのゲームルール", () => {
  it("通常の衝突は3回目で船体を大破させる", () => {
    expect(MAX_HULL).toBe(3);
    expect(damageHull(3)).toBe(2);
    expect(damageHull(2)).toBe(1);
    expect(damageHull(1)).toBe(0);
    expect(damageHull(0)).toBe(0);
    expect(damageHull(3, 3)).toBe(0);
    expect(damageHull(3, -1)).toBe(3);
  });

  it("ボスは基準深度を中心に滑らかな上下運動をする", () => {
    const depths = Array.from({ length: 200 }, (_, index) => getBossWobbleDepth(4_120, index / 20, 70, .8, 1.2));
    expect(Math.max(...depths) - Math.min(...depths)).toBeGreaterThan(100);
    expect(Math.max(...depths)).toBeLessThanOrEqual(4_120 + 70 * 1.28);
    expect(Math.min(...depths)).toBeGreaterThanOrEqual(4_120 - 70 * 1.28);
    expect(Math.max(...depths.slice(1).map((depth, index) => Math.abs(depth - depths[index]!)))).toBeLessThan(6);
  });
  it("魚種ごとに固定した移動パターンを持つ", () => {
    expect(Object.keys(FISH_PATTERNS)).toHaveLength(21);
    expect(new Set(Object.values(FISH_PATTERNS))).toEqual(new Set(["cruise", "wave", "dart", "ambush"]));
    expect(FISH_PATTERNS["sun-sardine"]).toBe("cruise");
    expect(FISH_PATTERNS["black-fang"]).toBe("ambush");
    expect(FISH_PATTERNS["comet-eel"]).toBe("dart");
  });

  it("未調査個体だけが接近時に赤で明滅する", () => {
    const far = getFishSafetyVisual(false, 200, 20, 0);
    expect(far.color).toBe("#ff6266");
    expect(far.showOutline).toBe(true);
    expect(far.warning).toBe(false);
    expect(getFishSafetyVisual(false, 200, 20, .25)).toEqual(far);
    const near = getFishSafetyVisual(false, 60, 20, .25);
    expect(near.warning).toBe(true);
    expect(near.alpha).toBeGreaterThan(getFishSafetyVisual(false, 60, 20, .75).alpha);
  });

  it("調査済み個体は距離や時間にかかわらず輪郭と警告を表示しない", () => {
    const safe = getFishSafetyVisual(true, 0, 25, 0);
    expect(safe.color).toBe("#75e8ef");
    expect(safe.warning).toBe(false);
    expect(safe.showOutline).toBe(false);
    expect(getFishSafetyVisual(true, 200, 25, .25).showOutline).toBe(false);
    expect(getFishSafetyVisual(true, 0, 25, .75)).toEqual(safe);
    expect(getFishSafetyVisual(false, 0, 25, 0).warning).toBe(true);
  });

  it("調査完了した個体は接触ダメージを与えず、未調査個体は従来どおり", () => {
    expect(canFishCollide(true, 0)).toBe(false);
    expect(canFishCollide(true, 2)).toBe(false);
    expect(canFishCollide(false, 0)).toBe(true);
    expect(canFishCollide(false, 2)).toBe(false);
  });

  it("先読み生成でも各ボス出現の400m手前だけ魚の出現率を半減する", () => {
    for (const depth of [0, 3500, 3599, 4200, 4399]) expect(getFishSpawnMultiplier(depth, 4000, 800)).toBe(1);
    for (const depth of [3600, 3800, 4000, 4400, 4600, 4800]) expect(getFishSpawnMultiplier(depth, 4000, 800)).toBe(.5);
    expect(getFishSpawnMultiplier(5800, 6000, 1000)).toBe(.5);
    expect(getFishSpawnMultiplier(6200, 6000, 1000)).toBe(1);
  });

  it("左右どちらの向きでもボスの胴体・尾・頭部から調査できる", () => {
    for (const direction of [1, -1] as const) {
      const canScan = (x: number, y: number) => isBossBodyResearchable(480 + x * direction, 300 + y, 480, 300, direction, 960, 640);
      expect(canScan(0, 217)).toBe(true); // 胴体表面から99px
      expect(canScan(0, -217)).toBe(true);
      expect(canScan(0, 219)).toBe(false); // 胴体表面から101px
      expect(canScan(0, 250)).toBe(false); // 以前の範囲では調査できた位置
      expect(canScan(-465, 145)).toBe(true); // 尾びれ
      expect(canScan(-400, 0)).toBe(true); // 尾の付け根
      expect(canScan(300, 0)).toBe(true); // 頭部
      expect(canScan(0, 340)).toBe(false);
      expect(canScan(429, 0)).toBe(true);
      expect(canScan(430, 0)).toBe(true);
      expect(canScan(431, 0)).toBe(false);
      expect(canScan(-569, 150)).toBe(true); // 尾の表面から99px
      expect(canScan(-571, 150)).toBe(false);
    }
  });

  it("目が画面外でも身体が見えていれば調査でき、全身が画面外なら調査しない", () => {
    expect(isBossBodyResearchable(900, 300, 1200, 300, 1, 960, 640)).toBe(true);
    expect(isBossBodyResearchable(60, 300, -240, 300, -1, 960, 640)).toBe(true);
    expect(isBossBodyResearchable(950, 300, 1500, 300, 1, 960, 640)).toBe(false);
    expect(isBossBodyResearchable(480, 600, 480, 800, 1, 960, 640)).toBe(false);
  });

  it("通常魚は区画あたり1〜3匹で、平均出現量が従来の半分になる", () => {
    expect([0, 1 / 3, 2 / 3, .999999].map(getRegularFishSpawnCount)).toEqual([1, 2, 3, 3]);
    const samples = Array.from({ length: 300 }, (_, i) => (i + .5) / 300);
    const previousTotal = samples.reduce((sum, random) => sum + 3 + Math.floor(random * 3), 0);
    const newTotal = samples.reduce((sum, random) => sum + getRegularFishSpawnCount(random), 0);
    expect(newTotal).toBe(previousTotal / 2);
  });
  it("左右どちらに向いても下降時は船首が下、上昇時は船首が上に傾く", () => {
    for (const heading of [0, Math.PI / 4, Math.PI * 3 / 4, Math.PI]) {
      for (const velocity of [-92, 92]) {
        const pitch = getSubmarinePitch(velocity, heading);
        const bowVerticalOffset = Math.cos(heading) * Math.sin(pitch);
        expect(Math.sign(bowVerticalOffset)).toBe(Math.sign(velocity));
        expect(Math.abs(pitch)).toBeLessThanOrEqual(.28);
      }
    }
    expect(getSubmarinePitch(92, Math.PI / 2)).toBeCloseTo(0);
    expect(getSubmarinePitch(0, Math.PI)).toBeCloseTo(0);
  });

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

  it("ボスは全身から100px以内への接近が必要で、通常魚の調査距離は変えない", () => {
    expect(BOSS_RESEARCH_RANGE).toBe(100);
    expect(NORMAL_RESEARCH_RANGE).toBe(150);
  });

  it("ボスの胴体・尾びれ・背びれのすべてに接触判定がある", () => {
    for (const direction of [1, -1] as const) {
      const hits = (x: number, y: number) => isBossBodyColliding(480 + x * direction, 300 + y, 17, 480, 300, direction);
      expect(hits(0, 0)).toBe(true);
      expect(hits(-430, 0)).toBe(true);
      expect(hits(52, -140)).toBe(true);
      expect(hits(0, -190)).toBe(false);
      expect(hits(390, 170)).toBe(false);
    }
  });

  it("潮流で横速度が変わっても、左右入力がなければ船首の向きを維持する", () => {
    expect(getSubmarineHeadingTarget(0, Math.PI)).toBe(Math.PI);
    expect(getSubmarineHeadingTarget(.01, Math.PI)).toBe(Math.PI);
    expect(getSubmarineHeadingTarget(1, Math.PI)).toBe(0);
    expect(getSubmarineHeadingTarget(-1, 0)).toBe(Math.PI);
  });

  it("潜水艦は海面で最も明るく、第3層で従来の明るさに戻る", () => {
    expect(getSubmarineLightLevel(0)).toBe(1);
    expect(getSubmarineLightLevel(1_750)).toBe(.5);
    expect(getSubmarineLightLevel(3_500)).toBe(0);
    expect(getSubmarineLightLevel(10_000)).toBe(0);
  });

  it("通常電力消費を20%増やし、深度に応じて最大1.6倍まで増加させる", () => {
    expect(BASE_POWER_DRAIN).toBeCloseTo(.19 * 1.2);
    expect(getPowerDrainMultiplier(1_500)).toBe(1);
    expect(getPowerDrainMultiplier(3_500)).toBeCloseTo(1.35);
    expect(getPowerDrainMultiplier(20_000)).toBe(1.6);
  });

  it("海流は内部第2段階から発生し、深度に応じて強くなる", () => {
    expect(getCurrentStrength(1_499)).toBe(0);
    expect(getCurrentStrength(1_500)).toBe(18);
    expect(getCurrentStrength(3_500)).toBe(34);
    expect(getCurrentStrength(20_000)).toBe(52);
  });

  it("危険地帯ではレア魚の抽選率を6倍にする", () => {
    expect(getRareSpawnRate(.001, false)).toBe(.001);
    expect(getRareSpawnRate(.001, true)).toBe(.006);
    expect(getRareSpawnRate(.3, true)).toBe(1);
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
