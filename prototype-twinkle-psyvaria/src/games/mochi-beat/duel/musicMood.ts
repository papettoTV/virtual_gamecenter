import type { Resolution } from './core';
export type MusicStage = 0 | 1 | 2;
// Shared presentation only: never changes judgement, damage, or difficulty.
export function musicStage(history: readonly Resolution[]): MusicStage {
  let points = 0, quietRounds = 0;
  let stage: MusicStage = 0;
  const recent: Resolution[] = [];
  for (const round of history) {
    recent.push(round);
    if (recent.length > 6) recent.shift();
    const successes = Number(round.attackQuality >= .55) + Number(round.defenseQuality >= .55);
    if (successes) { points = Math.min(12, points + successes); quietRounds = 0; }
    else if (++quietRounds >= 2) { points = Math.max(0, points - 6); quietRounds = 0; }
    // Track each player's attack AND defense, so CPU luck is not an unlock requirement.
    const skilled = recent.length === 6 && ([0, 1] as const).some(side =>
      recent.reduce((sum, result) => sum + (result.attacker === side ? result.attackQuality : result.defenseQuality), 0) / recent.length >= .85);
    if (points < 6) stage = 0;
    else if (points < 12) stage = 1;
    else if (skilled) stage = 2;
    else if (stage === 0) stage = 1;
    // Once earned, keep the top layer until two quiet rounds lower the points.
  }
  return stage;
}
export function musicStages(history: readonly Resolution[]): [MusicStage, MusicStage] {
  return [musicStage(history.slice(0, -1)), musicStage(history)];
}
// Wait for the next four-beat phrase, allowing remote results to arrive first.
export function visibleMusicStage(history: readonly Resolution[], beat: number): MusicStage {
  return musicStages(history)[beat < 4 ? 0 : 1];
}
