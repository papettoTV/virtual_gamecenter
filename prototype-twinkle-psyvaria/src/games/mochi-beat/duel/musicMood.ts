import type { Resolution } from './core';
export type MusicStage = 0 | 1 | 2;
// Shared presentation only: never changes judgement, damage, or difficulty.
export function musicStage(history: readonly Resolution[]): MusicStage {
  let points = 0, quietRounds = 0;
  for (const round of history) {
    const successes = Number(round.attackQuality >= .55) + Number(round.defenseQuality >= .55);
    if (successes) { points = Math.min(4, points + successes); quietRounds = 0; }
    else if (++quietRounds >= 2) { points = Math.max(0, points - 2); quietRounds = 0; }
  }
  return points >= 4 ? 2 : points >= 2 ? 1 : 0;
}
export function musicStages(history: readonly Resolution[]): [MusicStage, MusicStage] {
  return [musicStage(history.slice(0, -1)), musicStage(history)];
}
// Wait for the next four-beat phrase, allowing remote results to arrive first.
export function visibleMusicStage(history: readonly Resolution[], beat: number): MusicStage {
  return musicStages(history)[beat < 4 ? 0 : 1];
}
