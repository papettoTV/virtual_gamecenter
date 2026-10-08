import { actorAt, type Exchange, type Side } from "./core";

export function inputHint(exchange: Exchange, side: Side, seconds: number) {
  const actor = actorAt(exchange, seconds);
  return actor === side ? null : actor === null ? "まだ準備中！" : "相手の番！";
}

// Visual turns change on the musical beat; early-hit tolerance remains in core.ts.
export function turnCue(attacker: Side, beat: number) {
  const defender = (1 - attacker) as Side;
  if (beat < 4) return { phase: "ready" as const, current: null, next: attacker, role: "攻撃", nextRole: "攻撃", startBeat: 0 };
  if (beat < 8) return { phase: "attack" as const, current: attacker, next: defender, role: "攻撃", nextRole: "防御", startBeat: 4 };
  return { phase: "defense" as const, current: defender, next: defender, role: "防御", nextRole: "攻撃", startBeat: 8 };
}
export function cueName(side: Side, mode: "cpu" | "local" | "online", viewSide: Side | null = 0) {
  return mode === "local" ? side === 0 ? "1P" : "2P" : side === viewSide ? "あなた" : mode === "cpu" && side === 1 ? "CPU" : "相手";
}

export function countdownCue(attacker: Side, beat: number, mode: "cpu" | "local" | "online", viewSide: Side | null = 0) {
  if (beat < 0 || beat >= 8) return null;
  const side = beat < 4 ? attacker : (1 - attacker) as Side;
  if (mode !== "local" && side !== viewSide) return null;
  return { side, kind: beat < 4 ? "note" as const : "shield" as const, count: (beat < 4 ? 4 : 8) - Math.floor(beat) };
}
