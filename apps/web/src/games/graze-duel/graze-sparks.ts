import type { ParticleRenderState } from "./rendering/scene-renderer";

type MovingParticle = ParticleRenderState & { vx: number; vy: number };

export function emitGrazeSparks(particles: MovingParticle[], horizontal: number, vertical: number, bulletX: number, bulletY: number, limit: number, random: () => number = Math.random) {
  const direction = Math.atan2(bulletY - vertical, bulletX - horizontal);
  const originX = horizontal + Math.cos(direction) * 14;
  const originY = vertical + Math.sin(direction) * 14;
  const count = Math.min(5, Math.max(0, limit - particles.length));
  for (let index = 0; index < count; index += 1) {
    const angle = direction + index * Math.PI * 2 / 5 + (random() - 0.5) * 0.7;
    const speed = 160 + random() * 160;
    const life = 0.12 + random() * 0.14;
    particles.push({
      x: originX,
      y: originY,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      color: index % 2 === 0 ? "#fff5da" : "#ffbd73",
      kind: "spark",
      length: 8 + random() * 8,
      life,
      maxLife: life,
    });
  }
}

export function sparkFade(particle: ParticleRenderState) {
  return Math.min(1, Math.max(0, particle.life / (particle.maxLife ?? 0.26)));
}

export function sparkTail(particle: ParticleRenderState) {
  const velocityX = particle.vx ?? 0;
  const velocityY = particle.vy ?? 0;
  const speed = Math.hypot(velocityX, velocityY) || 1;
  const length = (particle.length ?? 10) * Math.min(1, Math.max(0, particle.life / 0.08));
  return { x: particle.x - velocityX / speed * length, y: particle.y - velocityY / speed * length };
}
