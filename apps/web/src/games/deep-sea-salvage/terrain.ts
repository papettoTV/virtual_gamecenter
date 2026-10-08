export const TERRAIN_MAX_DEPTH = 12_000;
export const TERRAIN_STEP = 300;
export const TERRAIN_WIDTH = 960;
export const MIN_TERRAIN_PASSAGE = 120;
export const TERRAIN_STORAGE_KEY = "pulbase.deep-sea-salvage.terrain.v1";

export type TerrainSide = "left" | "right";
export type TerrainFeatureKind = "kelp" | "vent";
export type TerrainPoint = { depth: number; left: number; right: number };
export type TerrainFeature = { id: string; kind: TerrainFeatureKind; side: TerrainSide; depth: number };
export type TerrainCourse = { version: 1; maxDepth: number; points: TerrainPoint[]; features: TerrainFeature[] };

export function nearestTerrainSide(widths: { left: number; right: number }, x: number): TerrainSide {
  return Math.abs(x - widths.left) <= Math.abs(x - (TERRAIN_WIDTH - widths.right)) ? "left" : "right";
}

export function editTerrainWall(point: TerrainPoint, side: TerrainSide, x: number) {
  const opposite = side === "left" ? point.right : point.left;
  point[side] = clamp(side === "left" ? x : TERRAIN_WIDTH - x, 0, TERRAIN_WIDTH - opposite - MIN_TERRAIN_PASSAGE);
}

export function circleHitsTerrainWall(x: number, depth: number, radius: number, side: TerrainSide, top: number, bottom: number, topWidth: number, bottomWidth: number): boolean {
  const localX = side === "left" ? x : TERRAIN_WIDTH - x;
  const width = mix(topWidth, bottomWidth, clamp((depth - top) / Math.max(1, bottom - top), 0, 1));
  if (depth >= top && depth <= bottom && localX >= 0 && localX <= width) return true;
  const vertices = [[0, top], [topWidth, top], [bottomWidth, bottom], [0, bottom]] as const;
  return vertices.some(([ax, ay], index) => {
    const [bx, by] = vertices[(index + 1) % vertices.length]!;
    const dx = bx - ax; const dy = by - ay;
    const t = clamp(((localX - ax) * dx + (depth - ay) * dy) / Math.max(1, dx * dx + dy * dy), 0, 1);
    return Math.hypot(localX - ax - t * dx, depth - ay - t * dy) <= radius;
  });
}

export function createDefaultTerrain(): TerrainCourse {
  const points: TerrainPoint[] = [];
  for (let depth = 0; depth <= TERRAIN_MAX_DEPTH; depth += TERRAIN_STEP) {
    if (depth === 0) { points.push({ depth, left: 0, right: 0 }); continue; }
    const index = depth / TERRAIN_STEP;
    const left = 150 + Math.sin(index * .72) * 42 + Math.sin(index * .21) * 28 - (index % 9 === 5 ? 58 : 0);
    const right = 155 + Math.cos(index * .64 + .8) * 40 + Math.sin(index * .18) * 25 - (index % 11 === 7 ? 62 : 0);
    points.push({ depth, left: Math.round(clamp(left, 80, 280)), right: Math.round(clamp(right, 80, 280)) });
  }
  const features: TerrainFeature[] = [];
  for (let depth = 900; depth < TERRAIN_MAX_DEPTH; depth += 750) {
    const index = Math.floor(depth / 750);
    features.push({ id: `kelp-${depth}`, kind: "kelp", side: index % 2 ? "left" : "right", depth });
  }
  for (let depth = 1_800; depth < TERRAIN_MAX_DEPTH; depth += 1_350) {
    const index = Math.floor(depth / 1_350);
    features.push({ id: `vent-${depth}`, kind: "vent", side: index % 2 ? "right" : "left", depth });
  }
  return { version: 1, maxDepth: TERRAIN_MAX_DEPTH, points, features };
}

export function sanitizeTerrainCourse(value: unknown): TerrainCourse {
  if (!value || typeof value !== "object") return createDefaultTerrain();
  const candidate = value as Partial<TerrainCourse>;
  if (!Array.isArray(candidate.points) || candidate.points.length < 2 || !Array.isArray(candidate.features)) return createDefaultTerrain();
  const points = candidate.points
    .map((point) => ({ depth: Number(point?.depth), left: Number(point?.left), right: Number(point?.right) }))
    .filter((point) => Number.isFinite(point.depth) && Number.isFinite(point.left) && Number.isFinite(point.right))
    .map((point) => {
      const left = clamp(point.left, 0, TERRAIN_WIDTH - MIN_TERRAIN_PASSAGE);
      const right = clamp(point.right, 0, TERRAIN_WIDTH - MIN_TERRAIN_PASSAGE);
      const scale = Math.min(1, (TERRAIN_WIDTH - MIN_TERRAIN_PASSAGE) / Math.max(1, left + right));
      return { depth: clamp(point.depth, 0, TERRAIN_MAX_DEPTH), left: left * scale, right: right * scale };
    })
    .sort((a, b) => a.depth - b.depth);
  if (points.length < 2) return createDefaultTerrain();
  const features = candidate.features.flatMap((feature, index) => {
    if (!feature || (feature.kind !== "kelp" && feature.kind !== "vent") || (feature.side !== "left" && feature.side !== "right")) return [];
    const depth = Number(feature.depth); if (!Number.isFinite(depth)) return [];
    return [{ id: typeof feature.id === "string" ? feature.id : `feature-${index}`, kind: feature.kind, side: feature.side, depth: clamp(depth, 0, TERRAIN_MAX_DEPTH) }];
  });
  return { version: 1, maxDepth: TERRAIN_MAX_DEPTH, points, features };
}

export function loadTerrainCourse(storage?: Pick<Storage, "getItem">): TerrainCourse {
  try {
    const stored = (storage ?? window.localStorage).getItem(TERRAIN_STORAGE_KEY);
    return stored ? sanitizeTerrainCourse(JSON.parse(stored)) : createDefaultTerrain();
  } catch { return createDefaultTerrain(); }
}

export function saveTerrainCourse(course: TerrainCourse, storage: Pick<Storage, "getItem" | "setItem"> = window.localStorage) {
  const serialized = JSON.stringify(sanitizeTerrainCourse(course));
  storage.setItem(TERRAIN_STORAGE_KEY, serialized);
  if (storage.getItem(TERRAIN_STORAGE_KEY) !== serialized) throw new Error("Terrain save verification failed");
}

export function terrainWallSegments(course: TerrainCourse): Array<{ from: TerrainPoint; to: TerrainPoint }> {
  return course.points.slice(1).flatMap((to, index) => {
    const from = course.points[index]!;
    return to.depth > from.depth ? [{ from, to }] : [];
  });
}

export function terrainWallLocalPolygon(side: TerrainSide, averageWidth: number, height: number, topWidth: number, bottomWidth: number) {
  const outerX = side === "left" ? -averageWidth / 2 : averageWidth / 2;
  const topInnerX = side === "left" ? topWidth - averageWidth / 2 : averageWidth / 2 - topWidth;
  const bottomInnerX = side === "left" ? bottomWidth - averageWidth / 2 : averageWidth / 2 - bottomWidth;
  return [
    { x: outerX, y: height / 2 },
    { x: topInnerX, y: height / 2 },
    { x: bottomInnerX, y: -height / 2 },
    { x: outerX, y: -height / 2 },
  ];
}

export function terrainWidthsAt(course: TerrainCourse, depth: number): { left: number; right: number } {
  const target = clamp(depth, 0, course.maxDepth);
  const upperIndex = course.points.findIndex((point) => point.depth >= target);
  if (upperIndex === -1) return { left: course.points.at(-1)!.left, right: course.points.at(-1)!.right };
  if (upperIndex <= 0) return { left: course.points[0]!.left, right: course.points[0]!.right };
  const upper = course.points[upperIndex] ?? course.points.at(-1)!; const lower = course.points[upperIndex - 1]!;
  if (target === upper.depth) return { left: upper.left, right: upper.right };
  const amount = (target - lower.depth) / Math.max(1, upper.depth - lower.depth);
  return { left: mix(lower.left, upper.left, amount), right: mix(lower.right, upper.right, amount) };
}

export function findTerrainRecesses(course: TerrainCourse): Array<{ side: TerrainSide; depth: number }> {
  const recesses: Array<{ side: TerrainSide; depth: number }> = [];
  for (let index = 1; index < course.points.length - 1; index += 1) {
    const previous = course.points[index - 1]!; const point = course.points[index]!; const next = course.points[index + 1]!;
    if (point.depth < 1_500) continue;
    if (point.left + 24 < Math.min(previous.left, next.left)) recesses.push({ side: "left", depth: point.depth });
    if (point.right + 24 < Math.min(previous.right, next.right)) recesses.push({ side: "right", depth: point.depth });
  }
  return recesses;
}

function mix(from: number, to: number, amount: number) { return from + (to - from) * amount; }
function clamp(value: number, min: number, max: number) { return Math.max(min, Math.min(max, value)); }
