import type { BossRenderState } from "./scene-renderer";

export const BOSS_AIRCRAFT_DESIGNS = [
  { name: "重迎撃機", source: "/assets/buzz-barrier/bosses/heavy-interceptor.png", scale: 1.6 },
  { name: "ステルス飛行艇", source: "/assets/buzz-barrier/bosses/stealth-flying-boat.png", scale: 1.9 },
  { name: "巨大空中要塞", source: "/assets/buzz-barrier/bosses/aerial-fortress.png", scale: 2.2 },
] as const;

export function getBossAircraftDesign(phaseIndex: number) {
  return BOSS_AIRCRAFT_DESIGNS[phaseIndex] ?? BOSS_AIRCRAFT_DESIGNS[0];
}

export function createBossAircraftSprites() {
  const images = BOSS_AIRCRAFT_DESIGNS.map(design => {
    const image = new Image();
    image.src = design.source;
    return image;
  });

  return {
    draw(context: CanvasRenderingContext2D, boss: BossRenderState) {
      const image = images[boss.phaseIndex] ?? images[0];
      if (!image?.complete || !image.naturalWidth) return;
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
      images.length = 0;
    },
  };
}
