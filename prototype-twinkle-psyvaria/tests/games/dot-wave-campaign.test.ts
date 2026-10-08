import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { CPU_STAGES, advanceCampaign, cpuMoves, freshDuel, nextCpuStage, randomCpuMove } from '../../src/games/mochi-beat/duel/campaign';
import { BEAT, MOVES, createExchange, exchangeLimit, resolve, type Side } from '../../src/games/mochi-beat/duel/core';
import { DotScene } from '../../src/games/mochi-beat/duel/DotScene';

it('keeps stage one on whole-beat taps and stage two on whole-beat taps and holds', () => {
  for (const stage of [1, 2] as const) {
    const pool = cpuMoves(stage);
    expect(pool.length).toBeGreaterThanOrEqual(3);
    for (const index of pool) {
      const move = MOVES[index]!;
      expect(move.beats.every(Number.isInteger)).toBe(true);
      for (const [start, duration] of Object.entries(move.holds ?? {})) expect(Number.isInteger(Number(start) + duration)).toBe(true);
    }
  }
  expect(cpuMoves(1).every(index => !MOVES[index]!.holds)).toBe(true);
  expect(cpuMoves(2).filter(index => MOVES[index]!.holds).length).toBeGreaterThanOrEqual(3);
  expect(cpuMoves(2)).toEqual(expect.arrayContaining(cpuMoves(1)));
});
it('adds eighth notes in stage three and never draws sixteenth notes in the campaign', () => {
  const pool = cpuMoves(3);
  expect(pool).toEqual(expect.arrayContaining(cpuMoves(2)));
  expect(pool.some(index => MOVES[index]!.beats.some(beat => !Number.isInteger(beat)))).toBe(true);
  expect(pool.every(index => MOVES[index]!.beats.every(beat => Number.isInteger(beat * 2)))).toBe(true);
  for (const stage of [1, 2, 3] as const) {
    const allowed = cpuMoves(stage);
    for (let i = 0; i < allowed.length; i++) expect(randomCpuMove(stage, () => (i + .5) / allowed.length)).toBe(allowed[i]);
  }
});
it.each(['limited', 'knockout'] as const)('advances wins through all three stages and resets the battle (%s)', ending => {
  let engine = freshDuel('cpu', ending);
  for (const stage of [1, 2, 3] as const) {
    expect(engine.cpuStage).toBe(stage);
    expect(engine.match.hp).toEqual([100, 100]);
    expect(engine.match.turn).toBe(0);
    expect(engine.match.history).toEqual([]);
    expect(engine.match.ending).toBe(ending);
    engine.phase = 'playing';
    for (let turns = 0; engine.match.winner === null && turns < 100; turns++) {
      const exchange = createExchange(engine.match.turn % 2 as Side, randomCpuMove(stage, () => .5), BEAT);
      for (const note of exchange.attack.notes) note.grade = exchange.attacker === 0 ? 'perfect' : 'miss';
      for (const note of exchange.defense.notes) note.grade = exchange.attacker === 1 ? 'perfect' : 'miss';
      engine.outcome = resolve(engine.match, exchange);
      engine.exchange = exchange;
    }
    expect(engine.match.winner).toBe(0);
    expect(advanceCampaign(engine)).toBeNull();
    engine.phase = 'finished';
    const next = advanceCampaign(engine);
    if (stage === 3) { expect(next).toBeNull(); expect(nextCpuStage(3, engine.match)).toBeNull(); }
    else { expect(next?.phase).toBe('intro'); expect(next?.exchange).toBeNull(); engine = next!; }
  }
});
it('does not advance losses, draws, unfinished battles, or multiplayer', () => {
  for (const winner of [null, 1, 'draw'] as const) {
    const engine = freshDuel(); engine.phase = 'finished'; engine.match.winner = winner;
    expect(advanceCampaign(engine)).toBeNull();
  }
  for (const mode of ['local', 'online'] as const) {
    const engine = freshDuel(mode); engine.phase = 'finished'; engine.match.winner = 0;
    expect(advanceCampaign(engine)).toBeNull();
  }
  expect(freshDuel().cpuStage).toBe(1);
});
it('renders distinct bosses and their names for players and spectators without changing multiplayer characters', () => {
  for (const stage of [1, 2, 3] as const) {
    const engine = freshDuel('cpu', 'limited', stage);
    for (const viewSide of [0, null] as const) {
      const html = renderToStaticMarkup(createElement(DotScene, {engine, viewSide, players: [{name:'PLAYER',wins:0},{name:'CPU',wins:0}]}));
      expect(html).toContain(`data-cpu-stage="${stage}"`);
      expect(html).toContain(CPU_STAGES[stage].name);
      expect(html).toContain(CPU_STAGES[stage].color);
      expect(html).toContain('PLAYER');
    }
  }
  const html = renderToStaticMarkup(createElement(DotScene, {engine:freshDuel('online')}));
  expect(html).not.toContain('data-cpu-stage');
  expect(html).not.toContain('IRON BEAT');
});

it.each([[1, 10], [2, 10], [3, 20]] as const)('ends CPU stage %i at %i turns when neither side is knocked out', (stage, turns) => {
  const engine = freshDuel('cpu', 'limited', stage);
  expect(exchangeLimit(engine.match)).toBe(turns);
  for (let turn = 0; turn < turns; turn++) {
    expect(engine.match.winner).toBeNull();
    const exchange = createExchange(turn % 2 as Side, 0);
    for (const chart of [exchange.attack, exchange.defense]) for (const note of chart.notes) note.grade = 'perfect';
    resolve(engine.match, exchange);
  }
  expect(engine.match.turn).toBe(turns);
  expect(engine.match.hp).toEqual([100, 100]);
  expect(engine.match.winner).toBe('draw');
});
it('keeps multiplayer at twenty turns and applies each next stage limit', () => {
  for (const mode of ['local', 'online'] as const) expect(exchangeLimit(freshDuel(mode).match)).toBe(20);
  const engine = freshDuel();
  engine.phase = 'finished'; engine.match.winner = 0;
  const second = advanceCampaign(engine)!;
  expect(exchangeLimit(second.match)).toBe(10);
  second.phase = 'finished'; second.match.winner = 0;
  expect(exchangeLimit(advanceCampaign(second)!.match)).toBe(20);
});
