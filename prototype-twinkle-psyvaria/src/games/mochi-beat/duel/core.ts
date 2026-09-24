export type Side = 0 | 1;
export type Grade = "perfect" | "good" | "miss";
type Move = { name: string; rhythm: string; beats: readonly number[]; power: number; holds?: Readonly<Record<number, number>> };
export const MOVES: readonly Move[] = [
  { name: "PULSE", rhythm: "トン・トン・トン", beats: [0, 1, 2], power: 22 },
  { name: "DOUBLE", rhythm: "トトン・トトン", beats: [0, .5, 2, 2.5], power: 30 },
  { name: "DELAY", rhythm: "トン……ト・トン", beats: [0, 2.5, 3], power: 34 },
  { name: "REST", rhythm: "トン・トン……トン", beats: [0, 1, 3], power: 22 },
  { name: "ECHO", rhythm: "トン……トン・トン", beats: [0, 2, 3], power: 22 },
  { name: "BOUNCE", rhythm: "トン・トトン・トン", beats: [0, 1, 1.5, 3], power: 26 },
  { name: "CHASE", rhythm: "トン・トン・トトン", beats: [0, 1, 2, 2.5], power: 26 },
  { name: "OFFBEAT", rhythm: "トン・タ・タ・トン", beats: [0, 1.5, 2.5, 3], power: 30 },
  { name: "SPRING", rhythm: "トトン・トン・トトン", beats: [0, .5, 1.5, 2.5, 3], power: 30 },
  { name: "TRIPLET", rhythm: "トトトン……トトン", beats: [0, .5, 1, 2.5, 3], power: 32 },
  { name: "RUSH", rhythm: "トトン・トトン・トトン", beats: [0, .5, 1, 1.5, 2.5, 3], power: 32 },
  { name: "SHIFT", rhythm: "トン・タ・タタ・トン", beats: [0, .5, 1.5, 2, 2.5, 3], power: 32 },
  { name: "OVERDRIVE", rhythm: "トトトト・トトトン", beats: [0, .5, 1, 1.5, 2, 2.5, 3], power: 34 },
  { name: "SONIC", rhythm: "トトトン・トトトン", beats: [0, .5, 1, 2, 2.5, 3], power: 34 },
  { name: "SPARK", rhythm: "トン・タタタ・トトン", beats: [0, 1, 1.5, 2, 2.5, 3], power: 34 },
  { name: "LONG PULSE", rhythm: "トーン・トン", beats: [0, 2, 3], holds: {0: 1}, power: 26 },
  { name: "LONG ECHO", rhythm: "トン・トーン", beats: [0, 1.5], holds: {1.5: 1.5}, power: 28 },
  { name: "LONG BOUNCE", rhythm: "トトン・トーン", beats: [0, .5, 2], holds: {2: 1.5}, power: 30 },
  { name: "DOUBLE HOLD", rhythm: "トーン・トーン", beats: [0, 2], holds: {0: 1.5, 2: 1.5}, power: 32 },
  { name: "HOLD RUSH", rhythm: "トーン・トトトン", beats: [0, 1.5, 2, 2.5, 3], holds: {0: 1}, power: 34 },
] ;
export const TURNS_PER_LEVEL = 4;
export const FINAL_LEVEL = 5;
export const LEVEL_POOLS: readonly (readonly number[])[] = [[0, 3, 4], [1, 5, 6], [2, 7, 8], [9, 10, 11], [12, 13, 14]];
// Tune this single value after playtesting.
export const HOLD_START_LEVEL = 2;
export const HOLD_POOLS: readonly (readonly number[])[] = [[15, 16], [16, 17], [17, 18], [18, 19]];
export function movesAtLevel(level: number): readonly number[] {
  const taps = LEVEL_POOLS[Math.min(level, LEVEL_POOLS.length) - 1]!;
  return level < HOLD_START_LEVEL ? taps : [...taps, ...HOLD_POOLS[Math.min(level - HOLD_START_LEVEL, HOLD_POOLS.length - 1)]!];
}
export type Ending = "limited" | "knockout";
export function levelAt(turn: number) { return 1 + Math.floor(turn / TURNS_PER_LEVEL); }
export function beatAt(turn: number) { return 60 / (108 + (levelAt(turn) - 1) * 12); }
export function randomMove(turn: number, random = Math.random) {
  const pool = movesAtLevel(levelAt(turn));
  return pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))]!;
}
export const MAX_HP = 100;
export const MAX_EXCHANGES = TURNS_PER_LEVEL * FINAL_LEVEL;
export const BEAT = 60 / 108;
export const END_BEAT = 12;
export const WINDOW = .15;
export type Note = { beat: number; grade: Grade | null; endBeat?: number; holdGrade?: Grade };
export type Chart = { notes: Note[]; extras: number };
export type Exchange = { attacker: Side; move: number; beatSeconds: number; attack: Chart; defense: Chart; resolved: boolean };
export type Match = { ending: Ending; hp: [number, number]; bonus: [number, number]; turn: number; winner: Side | "draw" | null; history: Resolution[] };
export type Resolution = { attacker: Side; power: number; damage: number; blocked: number; counter: boolean; attackQuality: number; defenseQuality: number };
export function createMatch(ending: Ending = "limited"): Match { return { ending, hp: [MAX_HP, MAX_HP], bonus: [0, 0], turn: 0, winner: null, history: [] }; }
export function createExchange(attacker: Side, move: number, beatSeconds = BEAT): Exchange {
  if (!Number.isInteger(move) || !MOVES[move]) throw new Error("unknown_move");
  const chart = (offset: number): Chart => ({ extras: 0, notes: MOVES[move]!.beats.map((beat) => ({ beat: beat + offset, grade: null, ...(MOVES[move]!.holds?.[beat] ? { endBeat: beat + offset + MOVES[move]!.holds![beat]! } : {}) })) });
  return { attacker, move, beatSeconds, attack: chart(4), defense: chart(8), resolved: false };
}
export function actorAt(exchange: Exchange, seconds: number): Side | null {
  const beat = seconds / exchange.beatSeconds;
  const window = Math.min(WINDOW, exchange.beatSeconds * .24);
  if (beat < 4 - window / exchange.beatSeconds || beat >= END_BEAT) return null;
  // The first defense note has a symmetric early-input window.
  return beat < 8 - window / exchange.beatSeconds ? exchange.attacker : (1 - exchange.attacker) as Side;
}
// Release windows are wider than press windows, and stay inside the next half-beat.
export const releaseWindow = (beatSeconds: number) => Math.min(.24, beatSeconds * .4);
export const perfectReleaseWindow = (beatSeconds: number) => Math.min(.10, beatSeconds * .2);
export function expire(chart: Chart, seconds: number, beatSeconds = BEAT) {
  for (const note of chart.notes) {
    if (note.grade !== null) continue;
    if (note.holdGrade && note.endBeat !== undefined) {
      if (seconds - note.endBeat * beatSeconds > releaseWindow(beatSeconds) + 1e-9) note.grade = "miss";
    } else if (seconds - note.beat * beatSeconds > Math.min(WINDOW, beatSeconds * .24) + 1e-9) note.grade = "miss";
  }
}
export function tap(exchange: Exchange, side: Side, seconds: number): Grade | null {
  if (exchange.resolved || actorAt(exchange, seconds) !== side) return null;
  const chart = side === exchange.attacker ? exchange.attack : exchange.defense;
  expire(chart, seconds, exchange.beatSeconds);
  const note = chart.notes.filter((note) => note.grade === null && !note.holdGrade).sort((a, b) => Math.abs(a.beat * exchange.beatSeconds - seconds) - Math.abs(b.beat * exchange.beatSeconds - seconds))[0];
  if (note && Math.abs(note.beat * exchange.beatSeconds - seconds) <= Math.min(WINDOW, exchange.beatSeconds * .24) + 1e-9) {
    note.grade = Math.abs(note.beat * exchange.beatSeconds - seconds) <= Math.min(.06, exchange.beatSeconds * .12) + 1e-9 ? "perfect" : "good";
    if (note.endBeat !== undefined) { note.holdGrade = note.grade; note.grade = null; return note.holdGrade; }
    return note.grade;
  }
  chart.extras += 1;
  return "miss";
}
// Both the press and release must succeed; the weaker grade is the final grade.
export function release(exchange: Exchange, side: Side, seconds: number): Grade | null {
  if (exchange.resolved) return null;
  const chart = side === exchange.attacker ? exchange.attack : exchange.defense;
  const note = chart.notes.find(n => n.grade === null && n.holdGrade && n.endBeat !== undefined);
  if (!note) return null;
  const error = Math.abs(seconds - note.endBeat! * exchange.beatSeconds);
  note.grade = error > releaseWindow(exchange.beatSeconds) + 1e-9 ? "miss"
    : note.holdGrade === "perfect" && error <= perfectReleaseWindow(exchange.beatSeconds) + 1e-9 ? "perfect" : "good";
  return note.grade;
}
export function quality(chart: Chart) {
  return Math.max(0, (chart.notes.reduce((sum, note) => sum + (note.grade === "perfect" ? 1 : note.grade === "good" ? .6 : 0), 0) - chart.extras * .35) / chart.notes.length);
}
export function resolve(match: Match, exchange: Exchange): Resolution {
  if (exchange.resolved || match.winner !== null || exchange.attacker !== match.turn % 2) throw new Error("invalid_exchange");
  expire(exchange.attack, Infinity); expire(exchange.defense, Infinity);
  exchange.resolved = true;
  const attacker = exchange.attacker;
  const defender = (1 - attacker) as Side;
  const attackQuality = quality(exchange.attack);
  const defenseQuality = quality(exchange.defense);
  const power = Math.round((MOVES[exchange.move]!.power + match.bonus[attacker]) * attackQuality);
  match.bonus[attacker] = 0;
  const damage = Math.max(0, Math.round(power * (1 - defenseQuality)));
  const counter = power > 0 && exchange.defense.extras === 0 && exchange.defense.notes.every((note) => note.grade === "perfect");
  if (counter) match.bonus[defender] = 5;
  match.hp[defender] = Math.max(0, match.hp[defender] - damage);
  match.turn += 1;
  if (match.hp[defender] === 0) match.winner = attacker;
  else if (match.ending === "limited" && match.turn >= MAX_EXCHANGES) match.winner = match.hp[0] === match.hp[1] ? "draw" : match.hp[0] > match.hp[1] ? 0 : 1;
  const outcome = { attacker, power, damage, blocked: power - damage, counter, attackQuality, defenseQuality };
  match.history.push(outcome);
  return outcome;
}
// CPU outcomes are chosen before the phrase, never in response to the human's input.
export function cpuGrades(move: number, attacking: boolean, random = Math.random): Grade[] {
  const perfectChance = attacking ? .66 : ([.68, .44, .38][move] ?? Math.max(.3, .68 - Math.floor(move / 3) * .08));
  return MOVES[move]!.beats.map(() => {
    const value = random();
    return value < perfectChance ? "perfect" : value < perfectChance + .22 ? "good" : "miss";
  });
}
