export const BPM = 108;
export const BEAT_SECONDS = 60 / BPM;
export const COUNT_IN = 4;
export const HIT_WINDOW = 0.16;
export const PERFECT_WINDOW = 0.065;
export const PATTERNS: readonly (readonly number[])[] = [
  [0, 2], [0, 1, 2], [0, 1, 3], [0, 1, 2, 3],
  [0, 0.5, 2], [0, 1.5, 2.5], [0, 1, 2, 2.5], [0, 0.5, 2, 3],
  [0, 0.5, 1.5, 3], [0, 1.5, 2, 3], [0, 0.5, 2, 2.5, 3], [0, 1, 1.5, 2.5, 3],
];
export const TOTAL_BEATS = COUNT_IN + PATTERNS.length * 8;
export type Judgment = "perfect" | "good" | "miss";
export type Note = { beat: number; round: number; judgment: Judgment | null; error: number | null };
export type Run = { notes: Note[]; combo: number; maxCombo: number; extras: number };

export function createRun(): Run {
  return {
    notes: PATTERNS.flatMap((pattern, round) => pattern.map((beat) => ({
      beat: COUNT_IN + round * 8 + 4 + beat, round, judgment: null, error: null,
    }))),
    combo: 0, maxCombo: 0, extras: 0,
  };
}

export function roundAt(beat: number): number {
  return Math.min(PATTERNS.length - 1, Math.max(0, Math.floor((beat - COUNT_IN) / 8)));
}

export function missExpired(run: Run, seconds: number): boolean {
  let missed = false;
  for (const note of run.notes) {
    if (note.judgment === null && seconds - note.beat * BEAT_SECONDS > HIT_WINDOW + 1e-9) {
      note.judgment = "miss";
      run.combo = 0;
      missed = true;
    }
  }
  return missed;
}

export function hit(run: Run, seconds: number): { judgment: Judgment; error: number | null } | null {
  missExpired(run, seconds);
  const beat = seconds / BEAT_SECONDS;
  const note = run.notes.filter((item) => item.judgment === null)
    .sort((a, b) => Math.abs(a.beat * BEAT_SECONDS - seconds) - Math.abs(b.beat * BEAT_SECONDS - seconds))[0];
  if (note && Math.abs(seconds - note.beat * BEAT_SECONDS) <= HIT_WINDOW + 1e-9) {
    const error = seconds - note.beat * BEAT_SECONDS;
    const judgment = Math.abs(error) <= PERFECT_WINDOW + 1e-9 ? "perfect" : "good";
    note.judgment = judgment; note.error = error;
    run.combo += 1; run.maxCombo = Math.max(run.maxCombo, run.combo);
    return { judgment, error };
  }
  // Listening and the count-in are safe to tap along with. Extra response taps cost points.
  if (beat < COUNT_IN || beat >= TOTAL_BEATS || (beat - COUNT_IN) % 8 < 4) return null;
  run.extras += 1; run.combo = 0;
  return { judgment: "miss", error: null };
}

export function result(run: Run) {
  const perfect = run.notes.filter((note) => note.judgment === "perfect").length;
  const good = run.notes.filter((note) => note.judgment === "good").length;
  const miss = run.notes.length - perfect - good;
  const score = Math.max(0, Math.round((perfect + good * 0.6 - run.extras * 0.3) / run.notes.length * 100_000));
  const grade = score >= 95_000 ? "おもちの達人！" : score >= 80_000 ? "ノリノリ名人！" : score >= 60_000 ? "いいかんじ！" : "次はもっとつける！";
  return { perfect, good, miss, score, grade };
}
