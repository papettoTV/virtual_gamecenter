import { describe, expect, it } from "vitest";
import { createGameState } from "../../src/games/graze-duel/state";
import { createSimulation } from "../../src/games/graze-duel/simulation";
import { LEVEL_UP_INVINCIBLE_TIME } from "../../src/games/graze-duel/core";

function fixture() {
  const settings = {
    BOSS_PHASES: [{ spawnLevel: 10, hp: 100 }],
    LEFT_X: 44, RIGHT_X: 524, FIELD_WIDTH: 392, FIELD_TOP: 74, FIELD_BOTTOM: 690, FIELD_HEIGHT: 616,
    FIELD_MARGIN: 34, BOSS_RADIUS: 34, BOSS_ATTACK_TELEGRAPH_TIME: 0, MAX_LIVES: 3, BOSS_ATTACK_INTERVAL: 10,
    PLAYER_SPEED_SCALE: 0.75, PLAYER_TILT_MAX: 1, PLAYER_TILT_LERP: 0.2, MAX_PARTICLES: 3,
  };
  const state = createGameState(settings);
  return { state, settings, simulation: createSimulation({ state, settings }) };
}

describe("BUZZ BARRIER extracted state/simulation dependencies", () => {
  it("creates independent state and initializes both player and boss fields", () => {
    const first = fixture();
    const second = fixture();
    expect(first.state.players[0]!.y).toBe(632);
    expect(first.state.players[0]!.lives).toBe(3);
    expect(first.state.players[1]!.cpu).toBe(true);
    expect(first.state.boss.nextSpawnLevel).toBe(10);
    expect(first.state.boss.hp).toBe(100);
    expect(first.state.opponentBoss.x).toBe(720);
    expect(first.state.particles).not.toBe(second.state.particles);
    expect(first.state.players[0]!.grazeIds).not.toBe(second.state.players[0]!.grazeIds);
  });

  it("moves, normalizes diagonals, applies slow speed and clamps to field margins", () => {
    const { state, simulation } = fixture();
    const player = state.players[0]!;
    player.x = 240;
    player.y = 300;
    simulation.movePlayer(player, 1, 1, false, 0.1);
    expect(player.x).toBeCloseTo(240 + 255 * 0.75 * 0.1 / Math.sqrt(2));
    expect(player.targetTilt).toBe(1);
    simulation.movePlayer(player, -1, 0, true, 0.1);
    expect(player.x).toBeCloseTo(240 + 255 * 0.75 * 0.1 / Math.sqrt(2) - 155 * 0.75 * 0.1);
    simulation.movePlayer(player, 100, -100, false, 100);
    expect(player.x).toBe(402);
    expect(player.y).toBe(108);
    expect(() => simulation.movePlayer(player, 0, 0, false, 0)).not.toThrow();
  });

  it("updates every player timer, combo, core-based barrier ratio and tilt", () => {
    const { state, simulation } = fixture();
    const player = state.players[0]!;
    Object.assign(player, { invincible: 1, levelUpInvincible: 1, comboTimer: 1, combo: 10, multiplier: 2,
      attackFlash: 1, attackCooldown: 1, levelUpFlash: 1, targetTilt: 1 });
    player.grazeIds.add(10);
    state.boss.encounterState = "active";
    state.boss.shieldAttackCharges = 2;
    simulation.updatePlayerState(player, 0.1);
    expect(player.hitInvincible).toBe(true);
    expect(player.combo).toBe(10);
    expect(player.barrierRatio).toBeCloseTo(0.9 / LEVEL_UP_INVINCIBLE_TIME);
    expect(player.tilt).toBeCloseTo(0.2);
    expect(player.attackFlash).toBeCloseTo(0.9);
    expect(player.attackCooldown).toBeCloseTo(0.9);
    expect(player.levelUpFlash).toBeCloseTo(0.9);
    simulation.updatePlayerState(player, 1);
    expect(player.combo).toBe(0);
    expect(player.multiplier).toBe(1);
    expect(player.grazeIds.size).toBe(0);
    expect(player.invincible).toBe(0);
    expect(player.levelUpInvincible).toBe(0);
    expect(state.boss.shieldAttackCharges).toBe(0);
    state.boss.shieldAttackCharges = 2;
    simulation.updatePlayerState(state.players[1]!, 1);
    expect(state.boss.shieldAttackCharges).toBe(2);
  });

  it("finds only the closest bullet inside the vertical field", () => {
    const { state, simulation } = fixture();
    const player = state.players[0]!;
    expect(simulation.findClosestBullet(player)).toBeNull();
    const bullets = player.bullets as Array<{ x: number; y: number }>;
    bullets.push({ x: 44, y: 700 }, { x: 44, y: 60 }, { x: 44, y: 500 }, { x: 44, y: 600 });
    expect(simulation.findClosestBullet(player)).toBe(player.bullets[3]);
  });

  it("handles an empty particle collection without an undeclared dependency", () => {
    const { simulation, state } = fixture();
    expect(() => simulation.updateParticles(0.016)).not.toThrow();
    expect(state.particles).toEqual([]);
  });

  it("moves particles, removes expired particles and enforces injected MAX_PARTICLES", () => {
    const { simulation, state, settings } = fixture();
    state.particles.push(...Array.from({ length: 6 }, (_, index) => ({ x: index, y: 10, vx: 2, vy: -4, life: index === 5 ? 0.1 : 2 })));
    simulation.updateParticles(0.5);
    expect(state.particles).toHaveLength(settings.MAX_PARTICLES);
    expect(state.particles.map(particle => particle.x)).toEqual([3, 4, 5]);
    expect(state.particles.every(particle => particle.y === 8 && particle.life === 1.5)).toBe(true);
  });
});
