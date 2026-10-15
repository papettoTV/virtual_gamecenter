import type { BossRenderState } from "./scene-renderer";

export const BOSS_AIRCRAFT_DESIGNS = [
  { name: "重迎撃機", source: "/assets/buzz-barrier/bosses/heavy-interceptor.png", scale: 1.35, color: [89, 218, 239] },
  { name: "ステルス飛行艇", source: "/assets/buzz-barrier/bosses/stealth-flying-boat.png", scale: 1.4, color: [112, 177, 255] },
  { name: "巨大空中要塞", source: "/assets/buzz-barrier/bosses/aerial-fortress.png", scale: 1.45, color: [193, 144, 255] },
] as const;

type StructureStroke = ReadonlyArray<readonly [number, number]>;

const BOSS_STRUCTURE_STROKES: ReadonlyArray<ReadonlyArray<StructureStroke>> = [
  [
    [[0.5, 0.18], [0.46, 0.3], [0.44, 0.59], [0.5, 0.82], [0.56, 0.59], [0.54, 0.3], [0.5, 0.18]],
    [[0.5, 0.61], [0.475, 0.67], [0.5, 0.75], [0.525, 0.67], [0.5, 0.61]],
    [[0.075, 0.4], [0.44, 0.59]],
    [[0.925, 0.4], [0.56, 0.59]],
    [[0.32, 0.17], [0.31, 0.23], [0.33, 0.32], [0.39, 0.32], [0.4, 0.23], [0.38, 0.17]],
    [[0.68, 0.17], [0.69, 0.23], [0.67, 0.32], [0.61, 0.32], [0.6, 0.23], [0.62, 0.17]],
  ],
  [
    [[0.5, 0.15], [0.46, 0.27], [0.43, 0.59], [0.5, 0.89], [0.57, 0.59], [0.54, 0.27], [0.5, 0.15]],
    [[0.5, 0.63], [0.475, 0.69], [0.5, 0.77], [0.525, 0.69], [0.5, 0.63]],
    [[0.08, 0.2], [0.43, 0.59]],
    [[0.92, 0.2], [0.57, 0.59]],
    [[0.32, 0.15], [0.31, 0.2], [0.32, 0.26], [0.39, 0.26], [0.4, 0.2], [0.39, 0.15]],
    [[0.68, 0.15], [0.69, 0.2], [0.68, 0.26], [0.61, 0.26], [0.6, 0.2], [0.61, 0.15]],
  ],
  [
    [[0.5, 0.12], [0.46, 0.22], [0.45, 0.45], [0.43, 0.63], [0.5, 0.91], [0.57, 0.63], [0.55, 0.45], [0.54, 0.22], [0.5, 0.12]],
    [[0.5, 0.68], [0.475, 0.74], [0.5, 0.82], [0.525, 0.74], [0.5, 0.68]],
    [[0.065, 0.28], [0.45, 0.45]],
    [[0.935, 0.28], [0.55, 0.45]],
    [[0.16, 0.59], [0.43, 0.63]],
    [[0.84, 0.59], [0.57, 0.63]],
  ],
];

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
      const sprite = createCyberBossSprite(image, design.color, index);
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

function createCyberBossSprite(image: HTMLImageElement, color: readonly number[], phaseIndex: number): HTMLCanvasElement {
  const size = 512;
  const source = document.createElement("canvas");
  source.width = size;
  source.height = size;
  const sourceContext = source.getContext("2d", { willReadFrequently: true });
  if (!sourceContext) throw new Error("Unable to create boss outline texture");
  sourceContext.drawImage(image, 0, 0, size, size);
  const pixels = sourceContext.getImageData(0, 0, size, size);
  const outline = sourceContext.createImageData(size, size);
  const neighbors = [-size * 3, size * 3, -3, 3, -size * 2 - 2, -size * 2 + 2, size * 2 - 2, size * 2 + 2];
  for (let vertical = 3; vertical < size - 3; vertical += 1) {
    for (let horizontal = 3; horizontal < size - 3; horizontal += 1) {
      const index = vertical * size + horizontal;
      const pixelIndex = index * 4;
      const alpha = pixels.data[pixelIndex + 3]! / 255;
      let minAlpha = alpha;
      let maxAlpha = alpha;
      for (const offset of neighbors) {
        const neighborAlpha = pixels.data[(index + offset) * 4 + 3]! / 255;
        minAlpha = Math.min(minAlpha, neighborAlpha);
        maxAlpha = Math.max(maxAlpha, neighborAlpha);
      }
      const edge = Math.min(1, Math.max(0, (maxAlpha - minAlpha - 0.15) / 0.6));
      const opacity = Math.min(1, edge * 0.95 + alpha * 0.018);
      const highlight = edge * 0.22;
      outline.data[pixelIndex] = color[0]! + (255 - color[0]!) * highlight;
      outline.data[pixelIndex + 1] = color[1]! + (255 - color[1]!) * highlight;
      outline.data[pixelIndex + 2] = color[2]! + (255 - color[2]!) * highlight;
      outline.data[pixelIndex + 3] = Math.round(opacity * 255);
    }
  }
  sourceContext.putImageData(outline, 0, 0);
  const structure = document.createElement("canvas");
  structure.width = size;
  structure.height = size;
  const structureContext = structure.getContext("2d");
  if (!structureContext) throw new Error("Unable to create boss structure texture");
  structureContext.strokeStyle = `rgba(${color.join(",")}, 0.7)`;
  structureContext.lineWidth = 2.8;
  structureContext.lineJoin = "miter";
  for (const stroke of BOSS_STRUCTURE_STROKES[phaseIndex] ?? BOSS_STRUCTURE_STROKES[0]!) {
    structureContext.beginPath();
    stroke.forEach(([horizontal, vertical], index) => {
      if (index === 0) structureContext.moveTo(horizontal * size, vertical * size);
      else structureContext.lineTo(horizontal * size, vertical * size);
    });
    structureContext.stroke();
  }
  structureContext.globalCompositeOperation = "destination-in";
  structureContext.drawImage(image, 0, 0, size, size);
  sourceContext.drawImage(structure, 0, 0);
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
