import { describe, expect, it } from "vitest";
import { turnCue, inputHint, countdownCue } from "../../src/games/mochi-beat/duel/turnCue";
import { createExchange, tap, type Side } from "../../src/games/mochi-beat/duel/core";

describe.each([0, 1] as Side[])("turn cues with side %i attacking", attacker => {
  const defender = (1 - attacker) as Side;

  it("guides waiting inputs without changing grades or consuming notes", () => {
    const exchange = createExchange(attacker, 0);
    const before = structuredClone(exchange);
    expect(inputHint(exchange, attacker, 0)).toBe("まだ準備中！");
    expect(inputHint(exchange, defender, 5 * exchange.beatSeconds)).toBe("相手の番！");
    expect(inputHint(exchange, attacker, 9 * exchange.beatSeconds)).toBe("相手の番！");
    expect(exchange).toEqual(before);
  });

  it("allows early attack and defense notes without a wrong-turn warning", () => {
    const exchange = createExchange(attacker, 0);
    for (const [side, beat] of [[attacker, 4], [defender, 8]] as const) {
      const seconds = beat * exchange.beatSeconds - .05;
      expect(inputHint(exchange, side, seconds)).toBeNull();
      expect(tap(exchange, side, seconds)).toBe("perfect");
    }
  });

  it("switches from preparation to attack on beat 4", () => {
    expect(turnCue(attacker, 3.999)).toMatchObject({ current: null, next: attacker, phase: "ready" });
    expect(turnCue(attacker, 4)).toMatchObject({ current: attacker, next: defender, phase: "attack", nextRole: "防御" });
  });

  it("hands off on beat 8 and previews the defender's next attack", () => {
    expect(turnCue(attacker, 7.999).current).toBe(attacker);
    expect(turnCue(attacker, 8)).toMatchObject({ current: defender, next: defender, phase: "defense", nextRole: "攻撃" });
    expect(turnCue(defender, 0)).toMatchObject({ current: null, next: defender, phase: "ready" });
  });
});

describe("player countdowns", () => {
  it("counts down all four beats before the player's attack and defense", () => {
    for (let beat = 0; beat < 4; beat++) {
      expect(countdownCue(0, beat, "cpu")).toEqual({ side: 0, kind: "note", count: 4 - beat });
      expect(countdownCue(1, beat + 4, "cpu")).toEqual({ side: 0, kind: "shield", count: 4 - beat });
    }
    expect(countdownCue(0, 3.999, "cpu")?.count).toBe(1);
    expect(countdownCue(0, 4, "cpu")).toBeNull();
    expect(countdownCue(1, 7.999, "cpu")?.count).toBe(1);
    expect(countdownCue(1, 8, "cpu")).toBeNull();
  });

  it("hides CPU preparation but supports both players in local mode", () => {
    expect(countdownCue(1, 0, "cpu")).toBeNull();
    expect(countdownCue(0, 4, "cpu")).toBeNull();
    expect(countdownCue(1, 0, "local")).toEqual({ side: 1, kind: "note", count: 4 });
    expect(countdownCue(0, 4, "local")).toEqual({ side: 1, kind: "shield", count: 4 });
    expect(countdownCue(1, 4, "local")).toEqual({ side: 0, kind: "shield", count: 4 });
  });
});
