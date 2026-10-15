import type { BossRenderState } from "./scene-renderer";

export type BossPoint = readonly [number, number, number];
type BossTriangle = readonly [number, number, number];
export type BossModel = {
  vertices: BossPoint[];
  faces: BossTriangle[];
  edges: Array<readonly [number, number]>;
};

export const BOSS_APPEARANCES = [
  { name: "球体", scale: 1.02, color: [89, 218, 239] },
  { name: "幾何学飛行体", scale: 1.06, color: [112, 177, 255] },
  { name: "トゲのある結晶体", scale: 1.1, color: [193, 144, 255] },
] as const;

export function getBossAppearance(phaseIndex: number) {
  return BOSS_APPEARANCES[phaseIndex] ?? BOSS_APPEARANCES[0];
}

export function getBossRotation(phaseIndex: number, elapsed: number): BossPoint {
  if (phaseIndex === 0) return [0.32, elapsed * 0.35, 0.12];
  if (phaseIndex === 1) return [0.28 + Math.sin(elapsed * 0.4) * 0.1, Math.sin(elapsed * 0.3) * 0.22, Math.sin(elapsed * 0.25) * 0.08];
  return [0.48 + elapsed * 0.11, 0.42 + elapsed * 0.17, elapsed * 0.07];
}

export function getCrystalTipLength(elapsed: number) {
  return 0.81 + 0.19 * Math.cos(elapsed * Math.PI * 2 / 2.4);
}

export function writeBossPositions(model: BossModel, indices: readonly number[], phaseIndex: number, elapsed: number, target: Float32Array) {
  const tipLength = phaseIndex === 2 ? getCrystalTipLength(elapsed) : 1;
  for (let index = 0; index < indices.length; index += 1) {
    const vertexIndex = indices[index]!;
    const point = model.vertices[vertexIndex]!;
    const scale = phaseIndex === 2 && vertexIndex >= 8 ? tipLength : 1;
    target[index * 3] = point[0] * scale;
    target[index * 3 + 1] = point[1] * scale;
    target[index * 3 + 2] = point[2] * scale;
  }
}

export function rotateBossPoint(point: BossPoint, rotation: BossPoint): BossPoint {
  const [pitch, yaw, roll] = rotation;
  const [horizontal, vertical, depth] = point;
  const yawHorizontal = horizontal * Math.cos(yaw) + depth * Math.sin(yaw);
  const yawDepth = -horizontal * Math.sin(yaw) + depth * Math.cos(yaw);
  const pitchedVertical = vertical * Math.cos(pitch) - yawDepth * Math.sin(pitch);
  const pitchedDepth = vertical * Math.sin(pitch) + yawDepth * Math.cos(pitch);
  return [
    yawHorizontal * Math.cos(roll) - pitchedVertical * Math.sin(roll),
    yawHorizontal * Math.sin(roll) + pitchedVertical * Math.cos(roll),
    pitchedDepth,
  ];
}

export function createBossModels(): BossModel[] {
  const sphere: BossModel = { vertices: [], faces: [], edges: [] };
  const longitudeCount = 24;
  const latitudeCount = 12;
  for (let latitude = 0; latitude <= latitudeCount; latitude += 1) {
    const polar = latitude * Math.PI / latitudeCount;
    for (let longitude = 0; longitude <= longitudeCount; longitude += 1) {
      const angle = longitude * Math.PI * 2 / longitudeCount;
      sphere.vertices.push([Math.sin(polar) * Math.cos(angle), Math.cos(polar), Math.sin(polar) * Math.sin(angle)]);
    }
  }
  for (let latitude = 0; latitude < latitudeCount; latitude += 1) {
    for (let longitude = 0; longitude < longitudeCount; longitude += 1) {
      const start = latitude * (longitudeCount + 1) + longitude;
      const below = start + longitudeCount + 1;
      if (latitude > 0) sphere.faces.push([start, below, start + 1]);
      if (latitude < latitudeCount - 1) sphere.faces.push([below, below + 1, start + 1]);
    }
  }
  for (let meridian = 0; meridian < 3; meridian += 1) {
    const angle = meridian * Math.PI / 3;
    appendRing(sphere, progress => [Math.cos(progress) * Math.cos(angle), Math.sin(progress), Math.cos(progress) * Math.sin(angle)]);
  }
  for (const latitude of [-0.5, 0, 0.5]) {
    const radius = Math.sqrt(1 - latitude * latitude);
    appendRing(sphere, progress => [Math.cos(progress) * radius, latitude, Math.sin(progress) * radius]);
  }

  const flyingBody = createPolyhedron(
    [[-1, 0.42, 0], [1, 0.42, 0], [0, -0.96, 0], [0, -0.02, 0.32], [0, -0.02, -0.24]],
    [[0, 1, 3], [1, 2, 3], [2, 0, 3], [1, 0, 4], [2, 1, 4], [0, 2, 4]],
  );

  const crystalVertices: BossPoint[] = [];
  for (const horizontal of [-0.34, 0.34]) {
    for (const vertical of [-0.34, 0.34]) {
      for (const depth of [-0.34, 0.34]) crystalVertices.push([horizontal, vertical, depth]);
    }
  }
  const crystalFaces: BossTriangle[] = [];
  for (let axis = 0; axis < 3; axis += 1) {
    for (const direction of [-1, 1]) {
      const tip: [number, number, number] = [0, 0, 0];
      tip[axis] = direction;
      const tipIndex = crystalVertices.length;
      const faceCorners = crystalVertices.slice(0, 8)
        .map((point, index) => ({ point, index }))
        .filter(({ point }) => point[axis]! * direction > 0)
        .sort((first, second) => {
          const firstAngle = Math.atan2(first.point[(axis + 1) % 3]!, first.point[(axis + 2) % 3]!);
          const secondAngle = Math.atan2(second.point[(axis + 1) % 3]!, second.point[(axis + 2) % 3]!);
          return firstAngle - secondAngle;
        });
      crystalVertices.push(tip);
      for (let corner = 0; corner < 4; corner += 1) {
        crystalFaces.push([faceCorners[corner]!.index, faceCorners[(corner + 1) % 4]!.index, tipIndex]);
      }
    }
  }
  return [sphere, flyingBody, createPolyhedron(crystalVertices, crystalFaces)];
}

function appendRing(model: BossModel, pointAt: (progress: number) => BossPoint) {
  const start = model.vertices.length;
  const segments = 48;
  for (let segment = 0; segment < segments; segment += 1) {
    model.vertices.push(pointAt(segment * Math.PI * 2 / segments));
    model.edges.push([start + segment, start + (segment + 1) % segments]);
  }
}

function createPolyhedron(vertices: BossPoint[], faces: BossTriangle[]): BossModel {
  const edges = new Map<string, readonly [number, number]>();
  const outwardFaces = faces.map(([first, second, third]): BossTriangle => {
    const normal = faceNormal(vertices[first]!, vertices[second]!, vertices[third]!);
    const center = vertices[first]!.map((value, axis) => (value + vertices[second]![axis]! + vertices[third]![axis]!) / 3);
    for (const edge of [[first, second], [second, third], [third, first]] as const) {
      const ordered = [...edge].sort((start, end) => start - end) as [number, number];
      edges.set(ordered.join(":"), ordered);
    }
    return normal.reduce((sum, value, axis) => sum + value * center[axis]!, 0) >= 0
      ? [first, second, third]
      : [first, third, second];
  });
  return { vertices, faces: outwardFaces, edges: [...edges.values()] };
}

function faceNormal(first: BossPoint, second: BossPoint, third: BossPoint): BossPoint {
  const firstEdge = second.map((value, axis) => value - first[axis]!);
  const secondEdge = third.map((value, axis) => value - first[axis]!);
  return [
    firstEdge[1]! * secondEdge[2]! - firstEdge[2]! * secondEdge[1]!,
    firstEdge[2]! * secondEdge[0]! - firstEdge[0]! * secondEdge[2]!,
    firstEdge[0]! * secondEdge[1]! - firstEdge[1]! * secondEdge[0]!,
  ];
}

export function createCanvasBossRenderer() {
  const models = createBossModels();
  return {
    draw(context: CanvasRenderingContext2D, boss: BossRenderState, elapsed: number) {
      const model = models[boss.phaseIndex] ?? models[0];
      if (!model) return;
      const appearance = getBossAppearance(boss.phaseIndex);
      const rotation = getBossRotation(boss.phaseIndex, elapsed);
      const tipLength = boss.phaseIndex === 2 ? getCrystalTipLength(elapsed) : 1;
      const vertices = model.vertices.map((point, index) => rotateBossPoint(
        boss.phaseIndex === 2 && index >= 8 ? [point[0] * tipLength, point[1] * tipLength, point[2] * tipLength] : point,
        rotation,
      ));
      const progress = boss.encounterState === "entering" ? boss.arrivalProgress : 1;
      const radius = boss.radius * appearance.scale * (0.68 + progress * 0.32);
      const color = appearance.color.join(",");
      context.save();
      context.translate(boss.x, boss.y);
      context.globalAlpha *= 0.08 + progress * 0.92;
      if (boss.phaseIndex === 0) {
        const gradient = context.createRadialGradient(-radius * 0.3, -radius * 0.4, 0, 0, 0, radius);
        gradient.addColorStop(0, `rgba(${color},0.22)`);
        gradient.addColorStop(0.7, `rgba(${color},0.04)`);
        gradient.addColorStop(1, `rgba(${color},0.18)`);
        context.fillStyle = gradient;
        context.beginPath();
        context.arc(0, 0, radius, 0, Math.PI * 2);
        context.fill();
      } else {
        const faces = [...model.faces].sort((first, second) => {
          const firstDepth = first.reduce((sum, index) => sum + vertices[index]![2], 0);
          const secondDepth = second.reduce((sum, index) => sum + vertices[index]![2], 0);
          return firstDepth - secondDepth;
        });
        for (const face of faces) {
          const normal = faceNormal(vertices[face[0]]!, vertices[face[1]]!, vertices[face[2]]!);
          const normalLength = Math.hypot(...normal);
          const brightness = Math.max(0, (-normal[0] * 0.3 + normal[1] * 0.5 + normal[2] * 0.8) / normalLength);
          context.fillStyle = `rgba(${color},${0.025 + brightness * 0.14})`;
          context.beginPath();
          face.forEach((vertexIndex, index) => {
            const point = vertices[vertexIndex]!;
            if (index === 0) context.moveTo(point[0] * radius, -point[1] * radius);
            else context.lineTo(point[0] * radius, -point[1] * radius);
          });
          context.closePath();
          context.fill();
        }
      }
      context.lineWidth = 1;
      context.shadowBlur = 6;
      context.shadowColor = `rgb(${color})`;
      const edgeBands: Array<Array<readonly [number, number]>> = [[], [], [], []];
      for (const edge of model.edges) {
        const [first, second] = edge;
        const depth = (vertices[first]![2] + vertices[second]![2]) / 2;
        const normalizedDepth = Math.min(1, Math.max(0, (depth + 0.45) / 1.05));
        const smoothDepth = normalizedDepth * normalizedDepth * (3 - 2 * normalizedDepth);
        edgeBands[Math.round(smoothDepth * 3)]!.push(edge);
      }
      for (let band = 0; band < edgeBands.length; band += 1) {
        const opacity = 0.65 * (0.16 + band / 3 * 0.84);
        context.strokeStyle = boss.flash > 0 ? `rgba(244,250,255,${opacity})` : `rgba(${color},${opacity})`;
        context.beginPath();
        for (const [first, second] of edgeBands[band]!) {
          context.moveTo(vertices[first]![0] * radius, -vertices[first]![1] * radius);
          context.lineTo(vertices[second]![0] * radius, -vertices[second]![1] * radius);
        }
        context.stroke();
      }
      if (boss.phaseIndex === 0) {
        context.strokeStyle = boss.flash > 0 ? "rgba(244,250,255,0.95)" : `rgba(${color},0.9)`;
        context.beginPath();
        context.arc(0, 0, radius, 0, Math.PI * 2);
        context.stroke();
      }
      context.restore();
    },
    dispose() {
      models.length = 0;
    },
  };
}
