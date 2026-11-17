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

export const LIGHTNING_PATTERNS = [
  [[-112, 1], [-11, 1], [135, 1]],
  [[-155, 1], [-44, 1], [78, 1]],
  [[-82, 1], [28, 0.63], [161, 1]],
  [[-170, 1], [-65, 1], [53, 1]],
  [[-130, 0.72], [-18, 1], [103, 0.56]],
  [[-59, 1], [61, 1], [176, 1]],
  [[-145, 1], [-28, 1], [93, 0.65]],
  [[-101, 1], [17, 1], [151, 1]],
  [[-176, 0.59], [-57, 0.74], [62, 1]],
  [[-117, 1], [8, 1], [119, 1]],
] as const;

export function pickLightningPattern(previous: number | null, sample = Math.random()) {
  const skip = previous !== null && previous >= 0 && previous < LIGHTNING_PATTERNS.length;
  const next = Math.floor(sample * (LIGHTNING_PATTERNS.length - Number(skip)));
  return skip && next >= previous ? next + 1 : next;
}

export function lightningOpacity(remaining: number) {
  return Math.min(1, Math.max(0, remaining / 0.16)) ** 1.6;
}

export function createLightningPaths(bounds: Bounds, remaining: number, patternIndex = 0, seed = 0): LightningPoint[][] {
  if (!(remaining > 0)) return [];
  const age = Math.max(0, LEVEL_UP_FLASH_DURATION - remaining);
  const reach = Math.min(1, 0.34 + age / 0.045);
  const paths: LightningPoint[][] = [];
  const pattern = LIGHTNING_PATTERNS[patternIndex];
  const patternSeed = seed ^ Math.imul((pattern ? patternIndex : 0) + 1, 0x9e3779b9);
  for (const [index, [degrees, lengthRatio]] of (pattern ?? LIGHTNING_PATTERNS[0]).entries()) {
    let randomState = (patternSeed ^ Math.imul(index + 1, 0x85ebca6b)) >>> 0;
    const random = () => {
      randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
      return randomState / 0x100000000;
    };
    const angle = degrees * Math.PI / 180;
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    const edge = Math.min((dx > 0 ? bounds.right : bounds.left) / dx, (dy > 0 ? bounds.bottom : bounds.top) / dy);
    const distance = (Math.max(0, edge) * lengthRatio + (lengthRatio === 1 ? 18 : 0)) * reach;
    const points: LightningPoint[] = [];
    const bend = (random() * 2 - 1) * 0.65;
    const wavePhase = random() * Math.PI * 2;
    const branchStep = 2 + Math.floor(random() * 5);
    const branchAngle = angle + (random() < 0.5 ? -1 : 1) * (0.48 + random() * 0.58);
    const branchRatio = 0.17 + random() * 0.20;
    const hasBranch = random() > 0.17;
    for (let step = 0; step <= BOLT_SEGMENTS; step += 1) {
      const spacing = (random() - 0.5) * 0.76;
      const fraction = (step + (step === 0 || step === BOLT_SEGMENTS ? 0 : spacing)) / BOLT_SEGMENTS;
      const kink = (random() * 2 - 1) * 0.74;
      const ripple = Math.sin(age * 49 - fraction * 9 + wavePhase);
      const offset = step === BOLT_SEGMENTS ? 0 : Math.min(57, distance * 0.2) * Math.sin(Math.PI * fraction)
        * (bend + kink + ripple * 0.34);
      const baseWidth = 3.2 + random() ** 1.35 * 8.8;
      const taper = 1 - fraction * (lengthRatio < 1 ? 0.88 : 0.49);
      const width = baseWidth * taper * (1 + ripple * 0.24);
      points.push({ x: dx * distance * fraction - dy * offset, y: dy * distance * fraction + dx * offset, width });
    }
    paths.push(points);
    if (!hasBranch || distance < 75) continue;
    const start = points[branchStep]!;
    const branchLength = Math.min(105, distance * branchRatio);
    paths.push(Array.from({ length: BRANCH_SEGMENTS + 1 }, (_, step) => {
      const fraction = step / BRANCH_SEGMENTS;
      const offset = Math.sin(Math.PI * fraction) * Math.min(15, branchLength * 0.33)
        * (random() * 2 - 1 + Math.sin(age * 62 + step + wavePhase) * 0.25);
      return {
        x: start.x + Math.cos(branchAngle) * branchLength * fraction - Math.sin(branchAngle) * offset,
        y: start.y + Math.sin(branchAngle) * branchLength * fraction + Math.cos(branchAngle) * offset,
        width: (1.35 + random() * 1.8) * (1 - fraction * 0.96),
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

export function drawLevelUpLightning(context: CanvasRenderingContext2D, x: number, y: number, bounds: Bounds, remaining: number, patternIndex = 0, seed = 0) {
  if (!(remaining > 0)) return;
  const paths = createLightningPaths({ left: bounds.left - x, top: bounds.top - y, right: bounds.right - x, bottom: bounds.bottom - y }, remaining, patternIndex, seed);
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
