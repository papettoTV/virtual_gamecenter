import type { Chart, Grade } from './core';

export type Score = { total: number; combo: number; maxCombo: number; bossBonus: number };
export const freshScore = (): Score => ({ total: 0, combo: 0, maxCombo: 0, bossBonus: 0 });
export const comboMultiplier = (combo: number) => 1 + Math.min(10, Math.floor(combo / 3)) / 10;
export function scoreNote(score: Score, grade: Grade, hold = false) {
  if (grade === 'miss') { score.combo = 0; return; }
  score.combo++;
  score.maxCombo = Math.max(score.maxCombo, score.combo);
  score.total += Math.round((hold || grade === 'perfect' ? 100 : 50) * comboMultiplier(score.combo));
}
// Consume final judgements once. A held note is not final until release or expiry.
export function scoreChart(score: Score, chart: Chart) {
  for (const note of chart.notes) {
    if (note.grade === null || note.scored) continue;
    scoreNote(score, note.grade, note.endBeat !== undefined);
    note.scored = true;
  }
  if (chart.extras > (chart.scoredExtras ?? 0)) score.combo = 0;
  chart.scoredExtras = chart.extras;
}
export function awardBossBonus(score: Score, hp: number) {
  const bonus = Math.max(0, Math.min(100, hp)) * 5;
  score.bossBonus += bonus; score.total += bonus;
}
export function readBest(ending: string) {
  try {
    const value = Number(localStorage.getItem(`dot-wave:best:v1:${ending}`));
    return Number.isSafeInteger(value) && value >= 0 ? value : 0;
  } catch { return 0; }
}
export function saveBest(ending: string, total: number) {
  const best = Math.max(readBest(ending), total);
  try { localStorage.setItem(`dot-wave:best:v1:${ending}`, String(best)); } catch { /* Play remains available when storage is blocked. */ }
  return best;
}
