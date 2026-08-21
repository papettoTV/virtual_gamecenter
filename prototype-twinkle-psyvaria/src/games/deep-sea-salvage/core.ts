export const BOSS_ANALYSIS_RANGE = 220;
export const TRANSMITTER_RANGE = 112;
export const MIN_BOSS_ANALYSIS = 50;

export function ensureBossAnalysis(analysis: number): number {
  return Math.max(MIN_BOSS_ANALYSIS, analysis);
}

export function canFireTransmitter({
  distance,
  analysis,
  exposed,
  cooldown,
}: {
  distance: number;
  analysis: number;
  exposed: number;
  cooldown: number;
}): boolean {
  return distance <= TRANSMITTER_RANGE
    && analysis > 0
    && exposed > 0
    && cooldown <= 0;
}

export function fireTransmitter({
  hp,
  distance,
  analysis,
  exposed,
  cooldown,
}: {
  hp: number;
  distance: number;
  analysis: number;
  exposed: number;
  cooldown: number;
}): { fired: boolean; hp: number; cooldown: number; flash: number } {
  const fired = canFireTransmitter({ distance, analysis, exposed, cooldown });
  return fired
    ? { fired: true, hp: Math.max(0, hp - 1), cooldown: .6, flash: .24 }
    : { fired: false, hp, cooldown, flash: 0 };
}
