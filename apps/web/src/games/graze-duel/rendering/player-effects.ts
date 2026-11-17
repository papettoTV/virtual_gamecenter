export const LEVEL_UP_FLASH_DURATION = 0.30;
const BOLT_SEGMENTS = 10;
const BRANCH_SEGMENTS = 3;
export const LIGHTNING_VERTEX_CAPACITY = 3 * (BOLT_SEGMENTS + BRANCH_SEGMENTS) * 6;
export const LIGHTNING_LAYERS = [
  { color: "#5143ff", width: 4, opacity: 0.22 },
  { color: "#a877ff", width: 1.9, opacity: 0.84 },
  { color: "#fffaff", width: 1, opacity: 1 },
] as const;

type Bounds = { left: number; top: number; right: number; bottom: number };
type LightningPoint = { x: number; y: number; width: number };

export function lightningOpacity(remaining: number) {
  return Math.min(1, Math.max(0, remaining / 0.16)) ** 1.6;
}

export function createLightningPaths(bounds: Bounds, remaining: number): LightningPoint[][] {
  if (!(remaining > 0)) return [];
  const age = Math.max(0, LEVEL_UP_FLASH_DURATION - remaining);
  const reach = Math.min(1, 0.34 + age / 0.045);
  const paths: LightningPoint[][] = [];
  const directions = [-1.95, -0.2, 2.35];
  for (const [index, angle] of directions.entries()) {
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    const edge = Math.min((dx > 0 ? bounds.right : bounds.left) / dx, (dy > 0 ? bounds.bottom : bounds.top) / dy);
    const distance = (Math.max(0, edge) + 18) * reach;
    const points: LightningPoint[] = [];
    for (let step = 0; step <= BOLT_SEGMENTS; step += 1) {
      const fraction = step / BOLT_SEGMENTS;
      const wiggle = Math.sin(step * 2.27 + index * 3) * 0.8 + Math.sin(step * 3.8 + age * 65) * 0.2;
      const offset = Math.min(40, distance * 0.15) * Math.sin(Math.PI * fraction) * wiggle;
      const width = (4.5 + 3.5 * Math.sin(step * 2.4 + index) ** 2) * (1 - fraction * 0.42);
      points.push({ x: dx * distance * fraction - dy * offset, y: dy * distance * fraction + dx * offset, width });
    }
    paths.push(points);
    if (distance < 75) continue;
    const start = points[3]!;
    const branchAngle = angle + (index === 1 ? -0.65 : 0.72);
    const branchLength = Math.min(90, distance * 0.28);
    paths.push(Array.from({ length: BRANCH_SEGMENTS + 1 }, (_, step) => {
      const fraction = step / BRANCH_SEGMENTS;
      const offset = step === 1 ? 5 : step === 2 ? -4 : 0;
      return {
        x: start.x + Math.cos(branchAngle) * branchLength * fraction - Math.sin(branchAngle) * offset,
        y: start.y + Math.sin(branchAngle) * branchLength * fraction + Math.cos(branchAngle) * offset,
        width: 1.9 * (1 - fraction * 0.94),
      };
    }));
  }
  return paths;
}

export function lightningRibbon(path: LightningPoint[], width: number) {
  return path.map((point, index) => {
    const before = path[Math.max(0, index - 1)]!;
    const after = path[Math.min(path.length - 1, index + 1)]!;
    const length = Math.hypot(after.x - before.x, after.y - before.y) || 1;
    const halfWidth = point.width * width * 0.5;
    const offsetX = (before.y - after.y) / length * halfWidth;
    const offsetY = (after.x - before.x) / length * halfWidth;
    return [
      { x: point.x + offsetX, y: point.y + offsetY },
      { x: point.x - offsetX, y: point.y - offsetY },
    ] as const;
  });
}

export function shieldAppearance(ratio: number, remaining: number, elapsed: number) {
  return {
    radius: 18 + ratio * 28 + (0.55 + Math.sin(elapsed * 18) * 0.22) * 5,
    opacity: remaining <= 0.5 && Math.floor(elapsed * 18) % 2 === 0 ? 0.28 : 1,
  };
}

export function drawPlayerShield(context: CanvasRenderingContext2D, x: number, y: number, radius: number) {
  if (!(radius > 0)) return;
  context.save();
  const gradient = context.createRadialGradient(x, y, 0, x, y, radius);
  gradient.addColorStop(0, "rgba(255, 253, 255, 1)");
  gradient.addColorStop(0.36, "rgba(248, 241, 255, 0.98)");
  gradient.addColorStop(0.62, "rgba(185, 146, 255, 0.93)");
  gradient.addColorStop(0.81, "rgba(126, 84, 255, 0.72)");
  gradient.addColorStop(0.94, "rgba(106, 69, 255, 0.32)");
  gradient.addColorStop(1, "rgba(106, 69, 255, 0)");
  context.fillStyle = gradient;
  context.beginPath();
  context.arc(x, y, radius, 0, Math.PI * 2);
  context.fill();
  context.restore();
}

export function drawLevelUpLightning(context: CanvasRenderingContext2D, x: number, y: number, bounds: Bounds, remaining: number) {
  if (!(remaining > 0)) return;
  const paths = createLightningPaths({ left: bounds.left - x, top: bounds.top - y, right: bounds.right - x, bottom: bounds.bottom - y }, remaining);
  const alpha = context.globalAlpha * lightningOpacity(remaining);
  context.save();
  context.beginPath();
  context.rect(bounds.left, bounds.top, bounds.right - bounds.left, bounds.bottom - bounds.top);
  context.clip();
  for (const layer of LIGHTNING_LAYERS) {
    context.globalAlpha = alpha * layer.opacity;
    context.fillStyle = layer.color;
    for (const path of paths) {
      const ribbon = lightningRibbon(path, layer.width);
      context.beginPath();
      context.moveTo(x + ribbon[0]![0].x, y + ribbon[0]![0].y);
      for (const [left] of ribbon.slice(1)) context.lineTo(x + left.x, y + left.y);
      for (let index = ribbon.length - 1; index >= 0; index -= 1) {
        const right = ribbon[index]![1];
        context.lineTo(x + right.x, y + right.y);
      }
      context.closePath();
      context.fill();
    }
  }
  context.restore();
}
