import { expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MOVES, HOLD_START_LEVEL, movesAtLevel, createExchange, tap, release, expire, quality, releaseWindow, perfectReleaseWindow } from '../../src/games/mochi-beat/duel/core';
import { NeonRail } from '../../src/games/mochi-beat/duel/NeonRail';
import {validRemoteTap} from '../../src/games/mochi-beat/duel/network';

it('keeps level one tap-only and mixes multiple hold patterns into every later level', () => {
  expect(HOLD_START_LEVEL).toBe(2);
  expect(movesAtLevel(1).every(i => !MOVES[i]!.holds)).toBe(true);
  for (let level = 2; level <= 12; level++) {
    expect(movesAtLevel(level).filter(i => MOVES[i]!.holds).length).toBeGreaterThanOrEqual(2);
    expect(movesAtLevel(level).some(i => !MOVES[i]!.holds)).toBe(true);
  }
  for (const move of MOVES) for (const [start, duration] of Object.entries(move.holds ?? {})) {
    expect(move.beats).toContain(Number(start));
    expect(Number(start) + duration).toBeLessThan(4);
    expect(move.beats.some(b => b > Number(start) && b <= Number(start) + duration)).toBe(false);
  }
});
it.each([.5, 60/216])('requires a release near the tail (%s)', beat => {
  const e = createExchange(0, 15, beat);
  expect(tap(e, 0, 4 * beat)).toBe('perfect');
  expect(e.attack.notes[0]!.grade).toBe(null);
  expire(e.attack, 4.9 * beat, beat);
  expect(e.attack.notes[0]!.grade).toBe(null);
  expire(e.attack, 5 * beat, beat);
  expect(e.attack.notes[0]!.grade).toBe(null);
  expect(release(e, 0, 5 * beat)).toBe('perfect');
  expect(release(e, 0, 5.3 * beat)).toBe(null);
  expect(tap(e, 0, 6 * beat)).toBe('perfect');
});
it('fails early release and cannot rescue that hold by pressing again', () => {
  const e = createExchange(1, 15, .5);
  tap(e, 0, 4);
  expect(release(e, 0, 4.2)).toBe('miss');
  tap(e, 0, 4.3);
  expire(e.defense, 4.5, .5);
  expect(e.defense.notes[0]!.grade).toBe('miss');
  expect(quality(e.defense)).toBe(0);
});
it('misses unstarted holds, preserves imperfect starts and accepts timestamped remote releases', () => {
  const e = createExchange(0, 15, .5);
  expire(e.defense, 4.2, .5);
  expect(e.defense.notes[0]!.grade).toBe('miss');
  expect(tap(e, 0, 2.08)).toBe('good');
  // Host has not expired the hold yet, because it waits for the network grace window.
  expect(validRemoteTap({seq:2,turn:0,seconds:2.4,action:'up'},0,2.6,1)).toBe(true);
  expect(release(e, 0, 2.4)).toBe('good');
  const other = createExchange(0, 15, .5);
  tap(other, 0, 2.08);
  expect(release(other, 0, 2.5)).toBe('good');
});
it('shows a hold tail and fills it while held without replacing the overlay rail', () => {
  const e = createExchange(0, 15, .5);
  tap(e,0,2);
  const html = renderToStaticMarkup(createElement(NeonRail,{exchange:e,seconds:2.25,viewSide:0}));
  expect(html).toContain('neon-rail-hold is-holding');
  expect(html).toContain('neon-rail-hold-fill');
});

it.each([.5, 60/216])('allows wider early/late releases, but fails holding forever (%s)', beat => {
  for (const direction of [-1, 1]) {
    for (const [error, expected] of [[perfectReleaseWindow(beat), 'perfect'], [releaseWindow(beat), 'good'], [releaseWindow(beat) + .001, 'miss']] as const) {
      const e = createExchange(0, 15, beat);
      tap(e, 0, 4 * beat);
      expect(release(e, 0, 5 * beat + direction * error)).toBe(expected);
    }
  }
  const e = createExchange(0, 15, beat);
  tap(e, 0, 4 * beat);
  expire(e.attack, 5 * beat + releaseWindow(beat), beat);
  expect(e.attack.notes[0]!.grade).toBe(null);
  expire(e.attack, 5 * beat + releaseWindow(beat) + .001, beat);
  expect(e.attack.notes[0]!.grade).toBe('miss');
  expect(release(e, 0, 5 * beat + .3)).toBe(null);
});
