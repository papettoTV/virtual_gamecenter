import { describe, expect, it } from "vitest";
import { clipSpark, emitGrazeSparks, GRAZE_SPARK_WIDTH, sparkFade, sparkTail } from "../../src/games/graze-duel/graze-sparks";
import type { ParticleRenderState } from "../../src/games/graze-duel/rendering/scene-renderer";

type Particle = ParticleRenderState & { vx: number; vy: number };

describe("graze sparks", () => {
  it("emits eight thick blue-violet streaks at the grazed side", () => {
    const particles: Particle[] = [];
    emitGrazeSparks(particles, 100, 200, 130, 200, 512, () => 0.5);
    expect(particles).toHaveLength(8);
    expect(new Set(particles.map(particle => particle.color))).toEqual(new Set(["#9985ff"]));
    expect(GRAZE_SPARK_WIDTH).toBe(3);
    for (const particle of particles) {
      expect(particle.kind).toBe("spark");
      expect(particle.x).toBe(114);
      expect(particle.y).toBe(200);
      expect(particle.life).toBeCloseTo(0.425);
      expect(Math.hypot(particle.vx, particle.vy)).toBeCloseTo(525);
      const tail = sparkTail(particle);
      expect(Math.hypot(particle.x - tail.x, particle.y - tail.y)).toBeCloseTo(50);
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
        expect(Math.abs(difference)).toBeLessThanOrEqual(Math.PI / 12 + 1e-10);
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

  it("can travel beyond a nearby field edge before fading out", () => {
    const particles: Particle[] = [];
    emitGrazeSparks(particles, 100, 200, 130, 200, 180, () => 0.95);
    const particle = particles[0]!;
    const elapsed = 0.35;
    expect(particle.x + particle.vx * elapsed).toBeGreaterThan(400);
    expect(sparkFade({ ...particle, life: particle.life - elapsed })).toBeGreaterThan(0.3);
  });

  it("varies speed and travel distance below the previous maxima", () => {
    const distances: number[] = [];
    const speeds: number[] = [];
    for (const randomness of [0, 0.3, 0.7, 1]) {
      const particles: Particle[] = [];
      emitGrazeSparks(particles, 100, 200, 130, 200, 180, () => randomness, 50);
      const particle = particles[0]!;
      const speed = Math.hypot(particle.vx, particle.vy);
      expect(particle.fieldX).toBe(50);
      expect(speed).toBeLessThanOrEqual(1300);
      expect(speed * particle.life).toBeLessThanOrEqual(845);
      speeds.push(speed);
      distances.push(speed * particle.life);
    }
    expect(new Set(speeds).size).toBe(4);
    expect(new Set(distances).size).toBe(4);
    expect(Math.min(...speeds)).toBeCloseTo(350);
    expect(Math.max(...speeds)).toBeCloseTo(1050);
  });

  it.each([[410, 200, 100, 0], [-10, 200, -100, 0], [200, 410, 0, 100], [200, -10, 0, -100]])("clips a streak crossing a field edge (%s, %s)", (horizontal, vertical, velocityX, velocityY) => {
    const segment = clipSpark({ x: horizontal, y: vertical, vx: velocityX, vy: velocityY, length: 50, life: 0.4, color: "#9985ff" }, { left: 0, top: 0, right: 400, bottom: 400 });
    expect(segment).not.toBeNull();
    for (const point of [segment!.head, segment!.tail]) {
      expect(point.x).toBeGreaterThanOrEqual(1.5);
      expect(point.x).toBeLessThanOrEqual(398.5);
      expect(point.y).toBeGreaterThanOrEqual(1.5);
      expect(point.y).toBeLessThanOrEqual(398.5);
    }
  });

  it("hides a whole streak beyond its source field instead of drawing it in the opponent field", () => {
    expect(clipSpark({ x: 500, y: 200, vx: 100, vy: 0, length: 50, life: 0.4, color: "#9985ff", fieldX: 0 }, { left: 0, top: 0, right: 400, bottom: 400 })).toBeNull();
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
