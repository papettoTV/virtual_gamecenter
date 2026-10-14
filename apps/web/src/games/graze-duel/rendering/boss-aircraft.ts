import type { BossRenderState } from "./scene-renderer";

export const BOSS_AIRCRAFT_DESIGNS = [
  { name: "重迎撃機", source: "/assets/buzz-barrier/bosses/heavy-interceptor.png", scale: 1.35, color: [89, 218, 239] },
  { name: "ステルス飛行艇", source: "/assets/buzz-barrier/bosses/stealth-flying-boat.png", scale: 1.4, color: [112, 177, 255] },
  { name: "巨大空中要塞", source: "/assets/buzz-barrier/bosses/aerial-fortress.png", scale: 1.45, color: [193, 144, 255] },
] as const;

export function getBossAircraftDesign(phaseIndex: number) {
  return BOSS_AIRCRAFT_DESIGNS[phaseIndex] ?? BOSS_AIRCRAFT_DESIGNS[0];
}

export function createBossAircraftSprites(onReady?: (index: number, sprite: HTMLCanvasElement) => void) {
  const sprites: Array<HTMLCanvasElement | undefined> = [];
  let disposed = false;
  const images = BOSS_AIRCRAFT_DESIGNS.map((design, index) => {
    const image = new Image();
    image.onload = () => {
      if (disposed) return;
      const sprite = createCyberBossSprite(image, design.color);
      sprites[index] = sprite;
      onReady?.(index, sprite);
    };
    image.src = design.source;
    return image;
  });

  return {
    draw(context: CanvasRenderingContext2D, boss: BossRenderState) {
      const image = sprites[boss.phaseIndex] ?? sprites[0];
      if (!image) return;
      const entering = boss.encounterState === "entering";
      const progress = entering ? boss.arrivalProgress : 1;
      const size = boss.radius * getBossAircraftDesign(boss.phaseIndex).scale * 2 * (0.68 + progress * 0.32);
      context.save();
      context.globalAlpha *= entering ? 0.08 + progress * 0.92 : 1;
      context.filter = `brightness(${boss.flash > 0 ? 1.8 : 0.25 + progress * 0.75})`;
      context.drawImage(image, boss.x - size / 2, boss.y - size / 2, size, size);
      context.restore();
    },
    dispose() {
      disposed = true;
      for (const image of images) image.onload = null;
      images.length = 0;
      sprites.length = 0;
    },
  };
}

function createCyberBossSprite(image: HTMLImageElement, color: readonly number[]): HTMLCanvasElement {
  const size = 512;
  const source = document.createElement("canvas");
  source.width = size;
  source.height = size;
  const sourceContext = source.getContext("2d", { willReadFrequently: true });
  if (!sourceContext) throw new Error("Unable to create boss outline texture");
  sourceContext.drawImage(image, 0, 0, size, size);
  const pixels = sourceContext.getImageData(0, 0, size, size);
  const luminance = new Float32Array(size * size);
  for (let index = 0; index < luminance.length; index += 1) {
    const pixelIndex = index * 4;
    luminance[index] = (pixels.data[pixelIndex]! * 0.2126
      + pixels.data[pixelIndex + 1]! * 0.7152
      + pixels.data[pixelIndex + 2]! * 0.0722) / 255;
  }

  const outline = sourceContext.createImageData(size, size);
  const neighbors = [-size * 3, size * 3, -3, 3, -size * 2 - 2, -size * 2 + 2, size * 2 - 2, size * 2 + 2];
  for (let vertical = 3; vertical < size - 3; vertical += 1) {
    for (let horizontal = 3; horizontal < size - 3; horizontal += 1) {
      const index = vertical * size + horizontal;
      const pixelIndex = index * 4;
      const alpha = pixels.data[pixelIndex + 3]! / 255;
      let minAlpha = alpha;
      let maxAlpha = alpha;
      let contrast = 0;
      for (const offset of neighbors) {
        const neighborAlpha = pixels.data[(index + offset) * 4 + 3]! / 255;
        minAlpha = Math.min(minAlpha, neighborAlpha);
        maxAlpha = Math.max(maxAlpha, neighborAlpha);
        if (alpha > 0.8 && neighborAlpha > 0.8) {
          contrast = Math.max(contrast, Math.abs(luminance[index]! - luminance[index + offset]!));
        }
      }
      const edge = Math.min(1, Math.max(0, (maxAlpha - minAlpha - 0.15) / 0.6));
      const panel = Math.min(1, Math.max(0, (contrast - 0.09) / 0.16));
      const scanline = vertical % 24 === 0 ? alpha * 0.06 : 0;
      const opacity = Math.min(1, edge * 0.95 + panel * 0.3 + alpha * 0.025 + scanline);
      const highlight = edge * 0.22;
      outline.data[pixelIndex] = color[0]! + (255 - color[0]!) * highlight;
      outline.data[pixelIndex + 1] = color[1]! + (255 - color[1]!) * highlight;
      outline.data[pixelIndex + 2] = color[2]! + (255 - color[2]!) * highlight;
      outline.data[pixelIndex + 3] = Math.round(opacity * 255);
    }
  }
  sourceContext.putImageData(outline, 0, 0);
  const sprite = document.createElement("canvas");
  sprite.width = size;
  sprite.height = size;
  const spriteContext = sprite.getContext("2d");
  if (!spriteContext) throw new Error("Unable to create boss glow texture");
  spriteContext.shadowColor = `rgb(${color.join(",")})`;
  spriteContext.shadowBlur = 9;
  spriteContext.drawImage(source, 0, 0);
  return sprite;
}
