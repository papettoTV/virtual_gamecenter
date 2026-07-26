import { describe, expect, it } from "vitest";
import {
  calculateAttackCost,
  calculateNextInvincibleTime,
  LEVEL_UP_INVINCIBLE_TIME,
} from "../../src/games/graze-duel/core";

describe("Graze Duel core rules", () => {
  it("raises the gauge requirement on every level", () => {
    expect(calculateAttackCost(1, 30)).toBe(420);
    expect(calculateAttackCost(10, 30)).toBe(690);
  });

  it("caps chained invincibility at 2.4 seconds", () => {
    expect(calculateNextInvincibleTime(0)).toBe(LEVEL_UP_INVINCIBLE_TIME);
    expect(calculateNextInvincibleTime(1.2)).toBeCloseTo(1.6);
    expect(calculateNextInvincibleTime(2.3)).toBe(LEVEL_UP_INVINCIBLE_TIME);
  });
});
