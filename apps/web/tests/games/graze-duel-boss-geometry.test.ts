import { describe, expect, it } from "vitest";
import { Euler, Vector3 } from "three";
import { createBossModels, getBossRotation, rotateBossPoint, type BossPoint } from "../../src/games/graze-duel/rendering/boss-geometry";

describe("geometric bosses", () => {
  it("keeps every rotating model within its intended collision-sized envelope", () => {
    for (const model of createBossModels()) {
      for (const vertex of model.vertices) {
        expect(vertex.every(Number.isFinite)).toBe(true);
        expect(Math.hypot(...vertex)).toBeLessThanOrEqual(1.1);
      }
      for (const face of model.faces) {
        const points = face.map(index => new Vector3(...model.vertices[index]!));
        const area = points[1]!.clone().sub(points[0]!).cross(points[2]!.clone().sub(points[0]!)).length();
        expect(area).toBeGreaterThan(0.00001);
      }
    }
  });

  it("keeps the sphere round with a small number of closed meridians and latitudes", () => {
    const sphere = createBossModels()[0]!;
    for (const vertex of sphere.vertices) expect(Math.hypot(...vertex)).toBeCloseTo(1, 10);
    const connections = new Map<number, number>();
    for (const edge of sphere.edges) {
      for (const index of edge) connections.set(index, (connections.get(index) ?? 0) + 1);
    }
    for (const count of connections.values()) expect(count).toBe(2);
    expect(sphere.edges.length).toBeLessThan(300);
  });

  it("builds closed polyhedra with unique edges and six broad crystal tips", () => {
    const models = createBossModels();
    for (const model of models.slice(1)) {
      const sharedEdges = new Map<string, number>();
      for (const [first, second, third] of model.faces) {
        for (const edge of [[first, second], [second, third], [third, first]]) {
          const key = edge.sort((start, end) => start! - end!).join(":");
          sharedEdges.set(key, (sharedEdges.get(key) ?? 0) + 1);
        }
      }
      for (const count of sharedEdges.values()) expect(count).toBe(2);
      expect(model.edges.length).toBe(sharedEdges.size);
    }
    expect(models[2]!.vertices.filter(point => Math.hypot(...point) > 0.9)).toHaveLength(6);
    expect(models[2]!.faces.length).toBeLessThan(30);
  });

  it("projects the Canvas fallback in the same orientation as Three.js", () => {
    const point: BossPoint = [0.31, -0.6, 0.47];
    for (const phase of [0, 1, 2]) {
      for (const elapsed of [0, 3, 10, 120]) {
        const rotation = getBossRotation(phase, elapsed);
        const projected = rotateBossPoint(point, rotation);
        const expected = new Vector3(...point).applyEuler(new Euler(...rotation, "ZXY"));
        expect(projected[0]).toBeCloseTo(expected.x, 10);
        expect(projected[1]).toBeCloseTo(expected.y, 10);
        expect(projected[2]).toBeCloseTo(expected.z, 10);
        expect(Math.hypot(...projected)).toBeCloseTo(Math.hypot(...point), 10);
      }
    }
  });
});
