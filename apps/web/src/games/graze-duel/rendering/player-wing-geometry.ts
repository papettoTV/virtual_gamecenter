export type WingPoint = readonly [number, number, number];

function createWingSectors() {
  const vertices: WingPoint[] = [];
  const faces: number[][] = [];
  const seams: number[][] = [];
  const edges: number[][] = [];
  const segments = 12;
  const profile = [[13.5, -18], [17, -2], [11, -5], [8, -14]] as const;
  for (const center of [0, Math.PI]) {
    const offset = vertices.length;
    for (let step = 0; step <= segments; step += 1) {
      const angle = center + (step / segments - 0.5) * Math.PI * 165 / 180;
      for (const [radius, height] of profile) vertices.push([radius * Math.cos(angle), height, radius * Math.sin(angle)]);
    }
    for (let step = 0; step < segments; step += 1) {
      for (let side = 0; side < 4; side += 1) {
        const first = offset + step * 4 + side;
        const second = offset + step * 4 + (side + 1) % 4;
        faces.push([first, second, second + 4, first + 4]);
        edges.push([first, first + 4]);
      }
    }
    faces.push([offset, offset + 3, offset + 2, offset + 1]);
    const end = offset + segments * 4;
    faces.push([end, end + 1, end + 2, end + 3]);
    for (const boundary of [offset, end]) {
      for (let side = 0; side < 4; side += 1) edges.push([boundary + side, boundary + (side + 1) % 4]);
    }
    const middle = offset + segments / 2 * 4;
    seams.push([middle, middle + 1, middle + 2, middle + 3]);
  }
  return { vertices, faces, seams, edges };
}

export const PLAYER_WING_MODEL = createWingSectors();

export function projectPlayerWings(angle: number): WingPoint[] {
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return PLAYER_WING_MODEL.vertices.map(([pointX, pointY, pointZ]) => [
    pointX * cosine + pointZ * sine, pointY, -pointX * sine + pointZ * cosine,
  ]);
}

export function drawPlayerWings(context: CanvasRenderingContext2D, color: string, angle: number) {
  const vertices = projectPlayerWings(angle);
  const faces = PLAYER_WING_MODEL.faces.map(indices => ({
    points: indices.map(index => vertices[index]!),
    depth: indices.reduce((sum, index) => sum + vertices[index]![2], 0) / indices.length,
  })).sort((left, right) => left.depth - right.depth);
  const shadowBlur = context.shadowBlur;
  context.shadowBlur = 0;
  context.fillStyle = "rgba(8, 70, 94, 0.3)";
  context.strokeStyle = color;
  context.lineWidth = 0.65;
  for (const { points } of faces) {
    context.beginPath();
    context.moveTo(points[0]![0], points[0]![1]);
    for (const point of points.slice(1)) context.lineTo(point[0], point[1]);
    context.closePath();
    context.fill();
  }
  context.shadowBlur = shadowBlur;
  context.beginPath();
  for (const [firstIndex, secondIndex] of PLAYER_WING_MODEL.edges) {
    const first = vertices[firstIndex!]!;
    const second = vertices[secondIndex!]!;
    context.moveTo(first[0], first[1]);
    context.lineTo(second[0], second[1]);
  }
  context.stroke();
  context.shadowBlur = 0;
  context.strokeStyle = "#bdfcff";
  context.lineWidth = 0.9;
  for (const seam of PLAYER_WING_MODEL.seams) {
    context.beginPath();
    const first = vertices[seam[0]!]!;
    context.moveTo(first[0], first[1]);
    for (const index of seam.slice(1)) context.lineTo(vertices[index]![0], vertices[index]![1]);
    context.stroke();
  }
  context.shadowBlur = shadowBlur;
}
