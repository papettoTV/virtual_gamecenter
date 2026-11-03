import { describe, expect, it } from "vitest";
import { emitGrazeSparks, GRAZE_SPARK_WIDTH, sparkFade, sparkTail } from "../../src/games/graze-duel/graze-sparks";
import type { ParticleRenderState } from "../../src/games/graze-duel/rendering/scene-renderer";

type Particle = ParticleRenderState & { vx: number; vy: number };

describe("graze sparks", () => {
  it("emits five short-lived thin sparks at the grazed side", () => {
    const particles: Particle[] = [];
    emitGrazeSparks(particles, 100, 200, 130, 200, 512, () => 0.5);
    expect(particles).toHaveLength(5);
    expect(GRAZE_SPARK_WIDTH).toBe(2);
    for (const particle of particles) {
      expect(particle.kind).toBe("spark");
      expect(particle.x).toBe(114);
      expect(particle.y).toBe(200);
      expect(particle.life).toBeCloseTo(0.3);
      expect(Math.hypot(particle.vx, particle.vy)).toBeCloseTo(240);
      const tail = sparkTail(particle);
      expect(Math.hypot(particle.x - tail.x, particle.y - tail.y)).toBeCloseTo(12);
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

  it("shortens and fades the streak before it expires", () => {
    const particle: Particle = { x: 20, y: 30, vx: 100, vy: 0, life: 0.04, maxLife: 0.2, length: 10, color: "#fff5da", kind: "spark" };
    expect(sparkFade(particle)).toBeCloseTo(0.2);
    expect(sparkTail(particle)).toEqual({ x: 15, y: 30 });
    particle.life = 0;
    expect(sparkFade(particle)).toBe(0);
    expect(sparkTail(particle)).toEqual({ x: 20, y: 30 });
  });
});
