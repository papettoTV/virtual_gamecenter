import type { ParticleRenderState } from "./rendering/scene-renderer";

type MovingParticle = ParticleRenderState & { vx: number; vy: number };
export const GRAZE_SPARK_WIDTH = 3;

export function emitGrazeSparks(particles: MovingParticle[], horizontal: number, vertical: number, bulletX: number, bulletY: number, limit: number, random: () => number = Math.random, fieldX?: number) {
  const direction = Math.atan2(bulletY - vertical, bulletX - horizontal);
  const originX = horizontal + Math.cos(direction) * 14;
  const originY = vertical + Math.sin(direction) * 14;
  const count = Math.min(8, Math.max(0, limit - particles.length));
  for (let index = 0; index < count; index += 1) {
    const angle = direction + (random() + random() - 1) * Math.PI / 12;
    const speed = 350 + random() ** 2 * 700;
    const life = 0.25 + random() * 0.35;
    particles.push({
      x: originX,
      y: originY,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      color: "#9985ff",
      kind: "spark",
      length: 36 + random() * 28,
      life,
      maxLife: life,
      fieldX,
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

export function clipSpark(particle: ParticleRenderState, bounds: { left: number; right: number; top: number; bottom: number }) {
  const tail = sparkTail(particle);
  const deltaX = particle.x - tail.x;
  const deltaY = particle.y - tail.y;
  const inset = GRAZE_SPARK_WIDTH / 2;
  let start = 0;
  let end = 1;
  for (const [origin, delta, minimum, maximum] of [
    [tail.x, deltaX, bounds.left + inset, bounds.right - inset],
    [tail.y, deltaY, bounds.top + inset, bounds.bottom - inset],
  ] as const) {
    if (minimum > maximum) return null;
    if (Math.abs(delta) < 1e-10) {
      if (origin < minimum || origin > maximum) return null;
      continue;
    }
    const first = (minimum - origin) / delta;
    const last = (maximum - origin) / delta;
    start = Math.max(start, Math.min(first, last));
    end = Math.min(end, Math.max(first, last));
    if (start >= end) return null;
  }
  return {
    tail: { x: tail.x + deltaX * start, y: tail.y + deltaY * start },
    head: { x: tail.x + deltaX * end, y: tail.y + deltaY * end },
  };
}
