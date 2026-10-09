import { LEVEL_UP_INVINCIBLE_TIME } from "./core";

export function createSimulation({ state, settings }) {
  const { players, boss, particles } = state;
  const { FIELD_TOP, FIELD_BOTTOM, FIELD_MARGIN, FIELD_WIDTH, PLAYER_SPEED_SCALE, PLAYER_TILT_MAX, PLAYER_TILT_LERP, MAX_PARTICLES } = settings;

  function movePlayer(player, moveX, moveY, slow, delta) {
    const length = Math.hypot(moveX, moveY) || 1;
    const speed = (slow ? 155 : 255) * PLAYER_SPEED_SCALE;
    player.targetTilt = clamp(moveX, -1, 1) * PLAYER_TILT_MAX;
    player.x += (moveX / length) * speed * delta;
    player.y += (moveY / length) * speed * delta;
    player.x = clamp(player.x, player.fieldX + FIELD_MARGIN, player.fieldX + FIELD_WIDTH - FIELD_MARGIN);
    player.y = clamp(player.y, FIELD_TOP + FIELD_MARGIN, FIELD_BOTTOM - FIELD_MARGIN);
  }

  function updatePlayerState(player, delta) {
    player.hitInvincible = player.invincible > 0 || player.levelUpInvincible > 0;
    player.comboTimer = Math.max(0, player.comboTimer - delta);
    if (player.comboTimer <= 0) {
      player.combo = 0;
      player.multiplier = 1;
      player.grazeIds.clear();
    }
    player.invincible = Math.max(0, player.invincible - delta);
    player.levelUpInvincible = Math.max(0, player.levelUpInvincible - delta);
    if (player === players[0] && boss.encounterState === "active" && player.levelUpInvincible <= 0) {
      boss.shieldAttackCharges = 0;
    }
    player.barrierRatio += ((player.levelUpInvincible / LEVEL_UP_INVINCIBLE_TIME) - player.barrierRatio) * Math.min(1, delta * 12);
    player.attackFlash = Math.max(0, player.attackFlash - delta);
    player.attackCooldown = Math.max(0, player.attackCooldown - delta);
    player.levelUpFlash = Math.max(0, player.levelUpFlash - delta);
    player.tilt += (player.targetTilt - player.tilt) * PLAYER_TILT_LERP;
  }

  function findClosestBullet(player) {
    let closest = null;
    let best = Infinity;
    for (const bullet of player.bullets) {
      if (bullet.y < FIELD_TOP || bullet.y > FIELD_BOTTOM) continue;
      const distance = Math.hypot(player.x - bullet.x, player.y - bullet.y);
      if (distance < best) {
        best = distance;
        closest = bullet;
      }
    }
    return closest;
  }

  function updateParticles(delta) {
    for (const particle of particles) {
      particle.x += particle.vx * delta;
      particle.y += particle.vy * delta;
      particle.life -= delta;
    }
    for (let index = particles.length - 1; index >= 0; index -= 1) {
      if (particles[index].life <= 0) particles.splice(index, 1);
    }
    if (particles.length > MAX_PARTICLES) {
      particles.splice(0, particles.length - MAX_PARTICLES);
    }
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  return { movePlayer, updatePlayerState, findClosestBullet, updateParticles };
}
