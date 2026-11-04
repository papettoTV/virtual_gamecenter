import { describe, expect, it } from "vitest";
import { emitGrazeSparks, GRAZE_SPARK_WIDTH, sparkFade, sparkTail } from "../../src/games/graze-duel/graze-sparks";
import type { ParticleRenderState } from "../../src/games/graze-duel/rendering/scene-renderer";

type Particle = ParticleRenderState & { vx: number; vy: number };

describe("graze sparks", () => {
  it("emits twelve long cyan and violet streaks at the grazed side", () => {
    const particles: Particle[] = [];
    emitGrazeSparks(particles, 100, 200, 130, 200, 512, () => 0.5);
    expect(particles).toHaveLength(12);
    expect(new Set(particles.map(particle => particle.color))).toEqual(new Set(["#f4fcff", "#72eaff", "#ef91ff"]));
    expect(GRAZE_SPARK_WIDTH).toBe(2);
    for (const particle of particles) {
      expect(particle.kind).toBe("spark");
      expect(particle.x).toBe(114);
      expect(particle.y).toBe(200);
      expect(particle.life).toBeCloseTo(0.41);
      expect(Math.hypot(particle.vx, particle.vy)).toBeCloseTo(420);
      const tail = sparkTail(particle);
      expect(Math.hypot(particle.x - tail.x, particle.y - tail.y)).toBeCloseTo(36);
      expect(sparkFade(particle)).toBe(1);
    }
  });

  it("never exceeds the shared particle budget", () => {
    const particles: Particle[] = [];
    emitGrazeSparks(particles, 0, 0, 0, 0, 3);
    emitGrazeSparks(particles, 0, 0, 0, 0, 3);
    expect(particles).toHaveLength(3);
    expect(particles.every(particle => [particle.x, particle.y, particle.vx, particle.vy].every(Number.isFinite))).toBe(true);
  });

  it.each([[30, -30], [-30, 30], [30, 0], [-30, 0], [0, -30], [0, 30]])("aims sparks toward the graze at (%s, %s) with a bounded random fan", (bulletX, bulletY) => {
    const direction = Math.atan2(bulletY, bulletX);
    const angles = new Set<number>();
    for (const randomness of [0, 0.25, 0.5, 0.75, 1]) {
      const particles: Particle[] = [];
      emitGrazeSparks(particles, 0, 0, bulletX, bulletY, 180, () => randomness);
      for (const particle of particles) {
        const angle = Math.atan2(particle.vy, particle.vx);
        const difference = Math.atan2(Math.sin(angle - direction), Math.cos(angle - direction));
        expect(Math.abs(difference)).toBeLessThanOrEqual(Math.PI / 6 + 1e-10);
        expect(particle.vx * bulletX + particle.vy * bulletY).toBeGreaterThan(0);
        angles.add(angle);
      }
    }
    expect(angles.size).toBeGreaterThan(1);
  });

  it("stays within the game budget during repeated directional grazes", () => {
    const particles: Particle[] = [];
    for (let index = 0; index < 30; index += 1) emitGrazeSparks(particles, 0, 0, 30, 0, 180);
    expect(particles).toHaveLength(180);
  });

  it("shortens and fades the streak before it expires", () => {
    const particle: Particle = { x: 20, y: 30, vx: 100, vy: 0, life: 0.04, maxLife: 0.2, length: 10, color: "#fff5da", kind: "spark" };
    expect(sparkFade(particle)).toBeCloseTo(0.2);
    expect(sparkTail(particle)).toEqual({ x: 15, y: 30 });
    particle.life = 0;
    expect(sparkFade(particle)).toBe(0);
    expect(sparkTail(particle)).toEqual({ x: 20, y: 30 });
  });
});
