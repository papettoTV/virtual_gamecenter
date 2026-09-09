import { describe, expect, it } from "vitest";
import { circleHitsTerrainWall, createDefaultTerrain, editTerrainWall, findTerrainRecesses, MIN_TERRAIN_PASSAGE, nearestTerrainSide, sanitizeTerrainCourse, TERRAIN_MAX_DEPTH, TERRAIN_WIDTH, terrainWallLocalPolygon, terrainWidthsAt } from "../../src/games/deep-sea-salvage/terrain";
import { loadTerrainCourse, saveTerrainCourse, terrainWallSegments } from "../../src/games/deep-sea-salvage/terrain";
import coast from "../fixtures/salvage-coast.json";

describe("深海サルベージの岩壁コース", () => {
  it("添付の海岸コースを保存・読込・岩壁生成しても全制御点の形を変えない", () => {
    const course = sanitizeTerrainCourse(coast);
    expect(course).toEqual(coast);
    const data = new Map<string, string>();
    const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
    saveTerrainCourse(course, storage);
    const loaded = loadTerrainCourse(storage);
    expect(loaded).toEqual(coast);
    for (const segment of terrainWallSegments(loaded)) {
      expect(terrainWidthsAt(loaded, segment.from.depth)).toEqual({ left: segment.from.left, right: segment.from.right });
      expect(terrainWidthsAt(loaded, segment.to.depth)).toEqual({ left: segment.to.left, right: segment.to.right });
    }
    expect(terrainWidthsAt(loaded, 8100).left).toBeCloseTo(675.818661971831);
    expect(terrainWidthsAt(loaded, 8100).right).toBeCloseTo(164.18133802816897);
  });

  it("保存からゲーム生成まで、浅い岩壁・海藻・噴出口の編集位置を維持する", () => {
    const course = createDefaultTerrain();
    course.points[1] = { depth: 300, left: 620, right: 100 };
    course.features = [
      { id: "shallow-kelp", kind: "kelp", side: "left", depth: 100 },
      { id: "shallow-vent", kind: "vent", side: "right", depth: 200 },
    ];
    const data = new Map<string, string>();
    const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
    saveTerrainCourse(course, storage);
    const loaded = loadTerrainCourse(storage);
    expect(loaded).toEqual(course);
    const segments = terrainWallSegments(loaded);
    expect(segments).toHaveLength(course.points.length - 1);
    expect(segments[0]).toEqual({ from: course.points[0], to: course.points[1] });
    expect(terrainWidthsAt(loaded, 150)).toEqual({ left: 310, right: 50 });
  });

  it("保存できない場合は成功扱いにしない", () => {
    expect(() => saveTerrainCourse(createDefaultTerrain(), { getItem: () => null, setItem: () => {} })).toThrow();
    expect(() => saveTerrainCourse(createDefaultTerrain(), { getItem: () => null, setItem: () => { throw new Error("Quota exceeded"); } })).toThrow();
  });

  it("最終点より深い地点でも最初の岩壁幅には戻らない", () => {
    const course = sanitizeTerrainCourse({ points: [{ depth: 0, left: 0, right: 0 }, { depth: 600, left: 600, right: 120 }], features: [] });
    expect(terrainWidthsAt(course, 900)).toEqual({ left: 600, right: 120 });
  });

  it("左右どちらも中央を超えて編集でき、JSON再読込でも幅を維持する", () => {
    const course = createDefaultTerrain();
    const left = course.points[5]!; const right = course.points[7]!;
    editTerrainWall(left, "left", 610);
    editTerrainWall(right, "right", 350);
    const restored = sanitizeTerrainCourse(JSON.parse(JSON.stringify(course)));
    expect(restored.points[5]!.left).toBe(610);
    expect(restored.points[7]!.right).toBe(610);
  });

  it("壁を中央越しにドラッグしても反対の壁を変更せず、通路幅を残す", () => {
    const point = { depth: 900, left: 150, right: 140 };
    editTerrainWall(point, "left", 650);
    expect(point).toEqual({ depth: 900, left: 650, right: 140 });
    editTerrainWall(point, "left", 960);
    expect(TERRAIN_WIDTH - point.left - point.right).toBe(MIN_TERRAIN_PASSAGE);
  });

  it("中央越しの輪郭も壁選択と設備配置で正しい側を選べる", () => {
    expect(nearestTerrainSide({ left: 630, right: 140 }, 628)).toBe("left");
    expect(nearestTerrainSide({ left: 140, right: 630 }, 332)).toBe("right");
  });

  it("左右交互の張り出しでも補間後の通路が塞がらない", () => {
    const course = sanitizeTerrainCourse({ points: [{ depth: 300, left: 700, right: 130 }, { depth: 600, left: 130, right: 700 }], features: [] });
    for (let depth = 300; depth <= 600; depth += 10) {
      const widths = terrainWidthsAt(course, depth);
      expect(TERRAIN_WIDTH - widths.left - widths.right).toBeGreaterThanOrEqual(MIN_TERRAIN_PASSAGE);
    }
  });

  it("読込時に重なった壁は最低通路幅を確保する", () => {
    const course = sanitizeTerrainCourse({ points: [{ depth: 300, left: 700, right: 700 }, { depth: 600, left: 200, right: 200 }], features: [] });
    expect(course.points[0]!.left + course.points[0]!.right).toBeCloseTo(TERRAIN_WIDTH - MIN_TERRAIN_PASSAGE);
  });

  it("ゲームの衝突判定が平均幅ではなく、編集した張り出しと斜面に一致する", () => {
    expect(circleHitsTerrainWall(550, 300, 10, "left", 0, 300, 150, 650)).toBe(true);
    expect(circleHitsTerrainWall(550, 150, 10, "left", 0, 300, 150, 650)).toBe(false);
    expect(circleHitsTerrainWall(410, 300, 10, "right", 0, 300, 150, 650)).toBe(true);
    expect(circleHitsTerrainWall(410, 150, 10, "right", 0, 300, 150, 650)).toBe(false);
  });

  it("3D岩壁メッシュの内側輪郭がエディタの上下制御点と一致する", () => {
    const average = 400;
    const left = terrainWallLocalPolygon("left", average, 300, 650, 150);
    expect(average / 2 + left[1]!.x).toBe(650);
    expect(average / 2 + left[2]!.x).toBe(150);
    const right = terrainWallLocalPolygon("right", average, 300, 650, 150);
    expect(TERRAIN_WIDTH - average / 2 + right[1]!.x).toBe(TERRAIN_WIDTH - 650);
    expect(TERRAIN_WIDTH - average / 2 + right[2]!.x).toBe(TERRAIN_WIDTH - 150);
  });
  it("ゲーム開始時に読み込める0〜12,000mの完全な既定コースを持つ", () => {
    const course = createDefaultTerrain();
    expect(course.points[0]?.depth).toBe(0);
    expect(course.points.at(-1)?.depth).toBe(TERRAIN_MAX_DEPTH);
    expect(course.features.some((feature) => feature.kind === "kelp")).toBe(true);
    expect(course.features.some((feature) => feature.kind === "vent")).toBe(true);
  });

  it("制御点の間を補間して岩壁幅を求める", () => {
    const course = sanitizeTerrainCourse({ version: 1, maxDepth: TERRAIN_MAX_DEPTH, points: [{ depth: 0, left: 0, right: 0 }, { depth: 300, left: 100, right: 200 }], features: [] });
    expect(terrainWidthsAt(course, 150)).toEqual({ left: 50, right: 100 });
  });

  it("周囲より奥まった輪郭をレア魚用のくぼみとして検出する", () => {
    const course = sanitizeTerrainCourse({
      version: 1, maxDepth: TERRAIN_MAX_DEPTH,
      points: [{ depth: 1_200, left: 180, right: 180 }, { depth: 1_500, left: 100, right: 180 }, { depth: 1_800, left: 180, right: 180 }],
      features: [],
    });
    expect(findTerrainRecesses(course)).toContainEqual({ side: "left", depth: 1_500 });
  });
});
