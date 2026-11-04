import type { ParticleRenderState } from "./rendering/scene-renderer";

type MovingParticle = ParticleRenderState & { vx: number; vy: number };
export const GRAZE_SPARK_WIDTH = 2;

export function emitGrazeSparks(particles: MovingParticle[], horizontal: number, vertical: number, bulletX: number, bulletY: number, limit: number, random: () => number = Math.random) {
  const direction = Math.atan2(bulletY - vertical, bulletX - horizontal);
  const originX = horizontal + Math.cos(direction) * 14;
  const originY = vertical + Math.sin(direction) * 14;
  const count = Math.min(12, Math.max(0, limit - particles.length));
  for (let index = 0; index < count; index += 1) {
    const angle = direction + (random() + random() - 1) * Math.PI / 6;
    const speed = 320 + random() * 200;
    const life = 0.32 + random() * 0.18;
    particles.push({
      x: originX,
      y: originY,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      color: index % 3 === 0 ? "#f4fcff" : index % 3 === 1 ? "#72eaff" : "#ef91ff",
      kind: "spark",
      length: 24 + random() * 24,
      life,
      maxLife: life,
    });
  }
}

export function sparkFade(particle: ParticleRenderState) {
  return Math.min(1, Math.max(0, particle.life / (particle.maxLife ?? 0.38)));
}

export function sparkTail(particle: ParticleRenderState) {
  const velocityX = particle.vx ?? 0;
  const velocityY = particle.vy ?? 0;
  const speed = Math.hypot(velocityX, velocityY) || 1;
  const length = (particle.length ?? 10) * Math.min(1, Math.max(0, particle.life / 0.08));
  return { x: particle.x - velocityX / speed * length, y: particle.y - velocityY / speed * length };
}
