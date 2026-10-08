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
export type Run = { notes: Note[]; combo: number; maxCombo: number; extras: number; beatSeconds: number };

export function createRun(beatSeconds = BEAT_SECONDS): Run {
  return {
    notes: PATTERNS.flatMap((pattern, round) => pattern.map((beat) => ({
      beat: COUNT_IN + round * 8 + 4 + beat, round, judgment: null, error: null,
    }))),
    combo: 0, maxCombo: 0, extras: 0, beatSeconds,
  };
}

export function roundAt(beat: number): number {
  return Math.min(PATTERNS.length - 1, Math.max(0, Math.floor((beat - COUNT_IN) / 8)));
}

export function missExpired(run: Run, seconds: number): boolean {
  let missed = false;
  for (const note of run.notes) {
    if (note.judgment === null && seconds - note.beat * run.beatSeconds > HIT_WINDOW * run.beatSeconds / BEAT_SECONDS + 1e-9) {
      note.judgment = "miss";
      run.combo = 0;
      missed = true;
    }
  }
  return missed;
}

export function hit(run: Run, seconds: number): { judgment: Judgment; error: number | null } | null {
  missExpired(run, seconds);
  const beat = seconds / run.beatSeconds;
  const note = run.notes.filter((item) => item.judgment === null)
    .sort((a, b) => Math.abs(a.beat * run.beatSeconds - seconds) - Math.abs(b.beat * run.beatSeconds - seconds))[0];
  if (note && Math.abs(seconds - note.beat * run.beatSeconds) <= HIT_WINDOW * run.beatSeconds / BEAT_SECONDS + 1e-9) {
    const error = seconds - note.beat * run.beatSeconds;
    const judgment = Math.abs(error) <= PERFECT_WINDOW * run.beatSeconds / BEAT_SECONDS + 1e-9 ? "perfect" : "good";
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


export const RUN_SECONDS = TOTAL_BEATS * BEAT_SECONDS;
export const COMPLETION_SECONDS = 3.5;

// Keep the final phrase on its last subdivision instead of wrapping into a new phrase.
export function displayBeat(seconds: number, beatSeconds = BEAT_SECONDS) {
  return Math.max(0, Math.min(seconds / beatSeconds, TOTAL_BEATS - 1e-6));
}

export function advanceCompletion(elapsed: number, delta: number, visible: boolean) {
  return visible ? Math.min(COMPLETION_SECONDS, elapsed + Math.max(0, Math.min(delta, .1))) : elapsed;
}


export const SET_BPMS = [108, 126, 144] as const;
export type RhythmSession = { setIndex: number; completedSets: number; runs: Run[] };
export function createSession(): RhythmSession {
  return { setIndex: 0, completedSets: 0, runs: SET_BPMS.map((bpm) => createRun(60 / bpm)) };
}
export function completeSet(session: RhythmSession) {
  session.completedSets = Math.max(session.completedSets, session.setIndex + 1);
  return session.completedSets === SET_BPMS.length;
}
export function advanceSet(session: RhythmSession) {
  if (session.completedSets !== session.setIndex + 1 || session.completedSets >= SET_BPMS.length) return false;
  const previous = session.runs[session.setIndex]!;
  session.setIndex += 1;
  const next = session.runs[session.setIndex]!;
  next.combo = previous.combo;
  next.maxCombo = previous.maxCombo;
  return true;
}
export function sessionResult(session: RhythmSession) {
  const combined: Run = {
    notes: session.runs.flatMap((run) => run.notes),
    combo: session.runs[session.setIndex]!.combo,
    maxCombo: Math.max(...session.runs.map((run) => run.maxCombo)),
    extras: session.runs.reduce((sum, run) => sum + run.extras, 0),
    beatSeconds: BEAT_SECONDS,
  };
  return { ...result(combined), extras: combined.extras, maxCombo: combined.maxCombo };
}
export const SESSION_SECONDS = SET_BPMS.reduce((sum, bpm) => sum + TOTAL_BEATS * 60 / bpm, 0);
