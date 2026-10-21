/** Shared Canvas artwork; these values affect rendering only. */
export const LEVEL_UP_FLASH_DURATION = 0.42;
export const LIGHTNING_FRAME_COUNT = 26;
export const LIGHTNING_FRAME_SIZE = 256;
export const LIGHTNING_COLUMNS = 6;

export function lightningFrame(remaining: number): number {
  return Math.max(0, Math.min(LIGHTNING_FRAME_COUNT - 1,
    Math.floor((1 - remaining / LEVEL_UP_FLASH_DURATION) * LIGHTNING_FRAME_COUNT)));
}

export function shieldAppearance(ratio: number, remaining: number, elapsed: number) {
  return {
    radius: 18 + ratio * 28 + (0.55 + Math.sin(elapsed * 18) * 0.22) * 5,
    opacity: remaining <= 0.5 && Math.floor(elapsed * 18) % 2 === 0 ? 0.28 : 1,
  };
}

export function drawPlayerShield(context: CanvasRenderingContext2D, x: number, y: number, radius: number) {
  context.save();
  const gradient = context.createRadialGradient(x, y, 0, x, y, radius);
  gradient.addColorStop(0, "rgba(105, 247, 255, 0.46)");
  gradient.addColorStop(0.48, "rgba(105, 247, 255, 0.28)");
  gradient.addColorStop(1, "rgba(105, 247, 255, 0.12)");
  context.fillStyle = gradient;
  context.beginPath();
  context.arc(x, y, radius, 0, Math.PI * 2);
  context.fill();
  context.restore();
}

/** A frame-local seed keeps pausing and repeated atlas generation deterministic. */
export function drawLevelUpLightning(context: CanvasRenderingContext2D, x: number, y: number, color: string, remaining: number) {
  if (!(remaining > 0)) return;
  const frame = lightningFrame(remaining);
  let seed = frame + 1;
  const random = (min: number, max: number) => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return min + (seed / 4294967296) * (max - min);
  };
  const progress = 1 - frame / LIGHTNING_FRAME_COUNT;
  const alpha = Math.min(1, progress * 1.4);
  context.save();
  context.globalAlpha *= alpha;
  context.fillStyle = `rgba(255, 255, 255, ${0.18 * alpha})`;
  context.shadowBlur = 44;
  context.shadowColor = color;
  context.beginPath();
  context.arc(x, y, 34 + (1 - progress) * 34, 0, Math.PI * 2);
  context.fill();
  for (let bolt = 0; bolt < 10; bolt += 1) {
    const angle = frame / LIGHTNING_FRAME_COUNT * LEVEL_UP_FLASH_DURATION * 12 + Math.PI * 2 * bolt / 10 + random(-0.24, 0.24);
    const radius = random(42, 86);
    context.strokeStyle = bolt % 2 === 0 ? "#ffffff" : color;
    context.lineWidth = bolt % 2 === 0 ? 4 : 2.4;
    context.shadowBlur = 24;
    context.beginPath();
    for (let segment = 0; segment <= 7; segment += 1) {
      const offset = segment === 0 || segment === 7 ? 0 : random(-16, 16);
      const px = x + Math.cos(angle) * radius * segment / 7 - Math.sin(angle) * offset;
      const py = y + Math.sin(angle) * radius * segment / 7 + Math.cos(angle) * offset;
      if (segment === 0) context.moveTo(px, py);
      else context.lineTo(px, py);
    }
    context.stroke();
  }
  context.strokeStyle = "#ffffff";
  context.lineWidth = 5;
  context.globalAlpha *= 0.7;
  context.beginPath();
  context.arc(x, y, 72 - progress * 22, 0, Math.PI * 2);
  context.stroke();
  context.restore();
}
