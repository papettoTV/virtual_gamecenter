import { describe, expect, it } from "vitest";
import { Euler, Vector3 } from "three";
import { createBossModels, getBossRotation, getCrystalTipLength, rotateBossPoint, writeBossPositions, type BossPoint } from "../../src/games/graze-duel/rendering/boss-geometry";

describe("geometric bosses", () => {
  it("rotates the stationary sphere faster without changing its tilt", () => {
    expect(getBossRotation(0, 10)).toEqual([0.32, 3.5, 0.12]);
  });

  it("pulses all crystal tips smoothly every 2.4 seconds within the original size", () => {
    expect(getCrystalTipLength(0)).toBeCloseTo(1);
    expect(getCrystalTipLength(1.2)).toBeCloseTo(0.62);
    for (let step = 0; step <= 100; step += 1) {
      const time = step * 0.024;
      const length = getCrystalTipLength(time);
      expect(length).toBeGreaterThanOrEqual(0.62);
      expect(length).toBeLessThanOrEqual(1);
      expect(getCrystalTipLength(time + 2.4)).toBeCloseTo(length, 10);
      expect(Math.abs(getCrystalTipLength(time + 0.001) - length)).toBeLessThan(0.0005);
    }
  });

  it("deforms faces and edges consistently while preserving the core and source model", () => {
    const model = createBossModels()[2]!;
    const original = model.vertices.map(point => [...point]);
    for (const time of [0, 0.6, 1.2, 2.4]) {
      for (const indices of [model.faces.flat(), model.edges.flat()]) {
        const positions = new Float32Array(indices.length * 3);
        writeBossPositions(model, indices, 2, time, positions);
        indices.forEach((vertexIndex, index) => {
          const scale = vertexIndex >= 8 ? getCrystalTipLength(time) : 1;
          model.vertices[vertexIndex]!.forEach((coordinate, axis) => {
            expect(positions[index * 3 + axis]).toBeCloseTo(coordinate * scale, 6);
          });
        });
      }
    }
    expect(model.vertices).toEqual(original);
    for (const phase of [0, 1]) {
      const indices = model.edges.flat();
      const positions = new Float32Array(indices.length * 3);
      writeBossPositions(model, indices, phase, 1.2, positions);
      expect([...positions]).toEqual(indices.flatMap(index => model.vertices[index]!.map(Math.fround)));
    }
  });

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
