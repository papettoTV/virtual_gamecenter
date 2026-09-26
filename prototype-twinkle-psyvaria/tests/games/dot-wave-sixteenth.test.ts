import { expect, it } from 'vitest';
import { MOVES, SIXTEENTH_POOLS, movesAtLevel, createExchange, tap, quality } from '../../src/games/mochi-beat/duel/core';
import { railX } from '../../src/games/mochi-beat/duel/NeonRail';

it('introduces multiple sixteenth patterns from level three while retaining existing rhythms', () => {
  const quick = SIXTEENTH_POOLS.flat();
  for (const level of [1, 2]) expect(movesAtLevel(level).some(move => quick.includes(move))).toBe(false);
  for (const level of [3, 4, 5, 12]) {
    const pool = movesAtLevel(level);
    expect(pool.filter(move => quick.includes(move))).toHaveLength(2);
    expect(pool.some(move => MOVES[move]!.holds)).toBe(true);
    expect(pool.some(move => move < 15)).toBe(true);
  }
});
it.each([.5, 60 / 180])('judges every new rhythm for either side at beat duration %s', beat => {
  for (const move of SIXTEENTH_POOLS.flat()) {
    const exchange = createExchange(0, move, beat);
    for (const note of exchange.attack.notes) expect(tap(exchange, 0, note.beat * beat)).toBe('perfect');
    for (const note of exchange.defense.notes) expect(tap(exchange, 1, note.beat * beat)).toBe('perfect');
    expect(quality(exchange.attack)).toBe(1);
    expect(quality(exchange.defense)).toBe(1);
  }
});
it('does not award a second sixteenth for repeated taps or overlapping timing windows', () => {
  const beat = .5, exchange = createExchange(0, 20, beat);
  expect(tap(exchange, 0, 4 * beat)).toBe('perfect');
  expect(tap(exchange, 0, 4 * beat)).toBe('miss');
  expect(tap(exchange, 0, 4.125 * beat)).toBe('miss');
  expect(tap(exchange, 0, 4.25 * beat)).toBe('perfect');
  // The existing rail places even the closest diamonds without overlap.
  expect(railX(.25) - railX(0)).toBeGreaterThan(28);
});
