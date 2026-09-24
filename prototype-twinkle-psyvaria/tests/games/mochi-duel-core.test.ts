import { describe, expect, it } from "vitest";
import { MAX_EXCHANGES, LEVEL_POOLS, movesAtLevel, beatAt, levelAt, randomMove, BEAT, createExchange, createMatch, cpuGrades, quality, resolve, tap, type Exchange, type Grade, type Side } from "../../src/games/mochi-beat/duel/core";

function graded(side: Side, attack: Grade, defense: Grade, move = 0): Exchange {
  const exchange = createExchange(side, move);
  exchange.attack.notes.forEach(note => { note.grade = attack; });
  exchange.defense.notes.forEach(note => { note.grade = defense; });
  return exchange;
}

describe("mochi duel", () => {
  it("turns attack accuracy and partial defense into castle damage", () => {
    const match = createMatch();
    const result = resolve(match, graded(0, "perfect", "good"));
    expect(result).toMatchObject({ power: 22, damage: 9, blocked: 13, counter: false });
    expect(match.hp).toEqual([100, 91]);
    expect(resolve(match, graded(1, "good", "miss")).power).toBe(13);
  });
  it("charges a perfect defender's next attack and consumes the charge", () => {
    const match = createMatch();
    expect(resolve(match, graded(0, "perfect", "perfect")).counter).toBe(true);
    expect(match.bonus).toEqual([0, 5]);
    expect(resolve(match, graded(1, "perfect", "miss")).power).toBe(27);
    expect(match.bonus).toEqual([0, 0]);
  });
  it("cannot launch or earn counter charge from a missed attack", () => {
    const match = createMatch(); match.bonus[0] = 5;
    expect(resolve(match, graded(0, "miss", "perfect"))).toMatchObject({ power: 0, damage: 0, counter: false });
    expect(match.bonus).toEqual([0, 0]);
  });
  it("accepts early notes for both roles and ignores the wrong player", () => {
    const exchange = createExchange(0, 0);
    expect(tap(exchange, 1, 4 * BEAT)).toBe(null);
    expect(tap(exchange, 0, 4 * BEAT - .1)).toBe("good");
    expect(tap(exchange, 1, 8 * BEAT - .1)).toBe("good");
    expect(exchange.attack.extras).toBe(0);
  });
  it("penalizes extra taps, expires missed notes and never gives negative quality", () => {
    const exchange = createExchange(0, 0);
    expect(tap(exchange, 0, 5 * BEAT)).toBe("perfect");
    expect(exchange.attack.notes[0]!.grade).toBe("miss");
    const before = quality(exchange.attack);
    for (let i = 0; i < 20; i++) tap(exchange, 0, 5 * BEAT);
    expect(quality(exchange.attack)).toBeLessThan(before);
    expect(quality(exchange.attack)).toBe(0);
  });
  it("prevents double resolution and out-of-turn attacks", () => {
    const match = createMatch(); const exchange = graded(0, "perfect", "miss");
    expect(() => resolve(match, graded(1, "perfect", "miss"))).toThrow();
    resolve(match, exchange);
    expect(() => resolve(match, exchange)).toThrow();
    expect(match.turn).toBe(1);
  });
  it("ends at knockout, clamps HP, and rejects further attacks", () => {
    const match = createMatch(); match.hp[1] = 10;
    resolve(match, graded(0, "perfect", "miss", 2));
    expect(match.hp[1]).toBe(0); expect(match.winner).toBe(0);
    expect(() => resolve(match, graded(1, "perfect", "miss"))).toThrow();
  });
  it("decides a draw or remaining-HP winner after the final level", () => {
    for (const damaged of [false, true]) {
      const match = createMatch();
      for (let turn = 0; turn < MAX_EXCHANGES; turn++) resolve(match, graded(turn % 2 as Side, damaged && turn === 0 ? "perfect" : "miss", "miss"));
      expect(match.turn).toBe(MAX_EXCHANGES);
      expect(match.winner).toBe(damaged ? 0 : "draw");
    }
  });
  it("preselects CPU grades with greater vulnerability to difficult rhythms", () => {
    expect(cpuGrades(0, false, () => .5)).toEqual(["perfect", "perfect", "perfect"]);
    expect(cpuGrades(2, false, () => .5)).toEqual(["good", "good", "good"]);
    expect(cpuGrades(1, true, () => .99)).toEqual(["miss", "miss", "miss", "miss"]);
  });
});


describe("automatic rhythm progression", () => {
  it("gives both players two attacks before increasing tempo and pool", () => {
    expect([0, 1, 2, 3, 4, 7, 8].map(levelAt)).toEqual([1, 1, 1, 1, 2, 2, 3]);
    expect(beatAt(3)).toBe(beatAt(0));
    expect(beatAt(4)).toBeLessThan(beatAt(3));
    for (let level = 0; level < LEVEL_POOLS.length; level++) {
      const pool = movesAtLevel(level + 1);
      expect(pool.map((_, i) => randomMove(level * 4, () => (i + .1) / pool.length))).toEqual(pool);
    }
  });
  it("keeps knockout matches going beyond the limited match length", () => {
    const match = createMatch("knockout");
    for (let turn = 0; turn < MAX_EXCHANGES + 4; turn++) resolve(match, graded(turn % 2 as Side, "miss", "miss"));
    expect(match.winner).toBe(null);
    expect(beatAt(match.turn)).toBeLessThan(beatAt(MAX_EXCHANGES - 1));
    match.hp[1] = 1;
    resolve(match, graded(0, "perfect", "miss"));
    expect(match.winner).toBe(0);
  });
  it("judges against the current tempo and keeps note windows separate at high speed", () => {
    const beat = beatAt(20);
    const exchange = createExchange(0, 12, beat);
    expect(tap(exchange, 0, 4 * beat)).toBe("perfect");
    expect(tap(exchange, 0, 4.25 * beat)).toBe("miss");
    expect(tap(exchange, 0, 4.5 * beat)).toBe("perfect");
    expect(tap(exchange, 1, 8 * beat)).toBe("perfect");
  });
});
