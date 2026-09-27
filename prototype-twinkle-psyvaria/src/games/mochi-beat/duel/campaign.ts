import { MOVES, createMatch, type Match } from './core';
import type { Engine } from './MochiDuel';

export type CpuStage = 1 | 2 | 3;
export const CPU_STAGES = {
  1: { label: '1st STAGE', name: 'PULSE', title: '基本のリズム', description: 'まずはタップだけ。拍に合わせてリズムを返そう。', color: '#ff39bc' },
  2: { label: '2nd STAGE', name: 'IRON BEAT', title: '中ボス', description: '長押しが登場。帯の終点まで押して、輪に合わせて離そう。', color: '#ffac45' },
  3: { label: '3rd STAGE', name: 'NOVA', title: 'ラスボス', description: '長押しに加えて8分音符が登場。拍と拍の間の音も聴き取ろう。', color: '#b49aff' },
} as const;

export function cpuMoves(stage: CpuStage): number[] {
  return MOVES.flatMap((move, index) => {
    const grid = stage === 3 ? 2 : 1;
    const allowed = move.beats.every(beat => Number.isInteger(beat * grid))
      && (stage > 1 || !move.holds)
      && Object.entries(move.holds ?? {}).every(([start, duration]) => Number.isInteger((Number(start) + duration) * grid));
    return allowed ? [index] : [];
  });
}
export function randomCpuMove(stage: CpuStage, random = Math.random): number {
  const pool = cpuMoves(stage);
  return pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))]!;
}
export function nextCpuStage(stage: CpuStage, match: Match): CpuStage | null {
  return match.winner === 0 && stage < 3 ? (stage + 1) as CpuStage : null;
}
export function freshDuel(mode: Engine['mode'] = 'cpu', ending: Match['ending'] = 'limited', cpuStage: CpuStage = 1): Engine {
  return { phase: 'intro', mode, cpuStage, match: createMatch(ending), selected: 0, exchange: null, seconds: 0, outcome: null, impactElapsed: 0, feedback: '', cpu: [], flash: null, inputWarning: null };
}
export function advanceCampaign(engine: Engine): Engine | null {
  const next = engine.mode === 'cpu' && engine.phase === 'finished' ? nextCpuStage(engine.cpuStage ?? 1, engine.match) : null;
  return next ? freshDuel('cpu', engine.match.ending, next) : null;
}
