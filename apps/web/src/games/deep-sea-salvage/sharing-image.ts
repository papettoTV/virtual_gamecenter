import { drawBrandWordmark } from "../../brand/wordmark-raster";
import type { SharedResult } from "../../domain/shared-result";
import { SPECIES } from "./species";
import { presentSalvageResult } from "./sharing";

function loadPortrait(id: string): Promise<HTMLImageElement | null> {
  return new Promise(resolve => {
    const image = new Image();
    const timeout = setTimeout(() => { image.src = ""; resolve(null); }, 2500);
    const finish = (value: HTMLImageElement | null) => { clearTimeout(timeout); resolve(value); };
    image.onload = () => finish(image);
    image.onerror = () => finish(null);
    image.src = `/assets/deep-sea-salvage/encyclopedia/${id}.png`;
  });
}

export async function drawSalvageResultImage(context: CanvasRenderingContext2D, result: SharedResult) {
  const presentation = presentSalvageResult(result);
  const discovered = new Set(String(result.metrics.speciesIds ?? "").split(","));
  const images = await Promise.all(SPECIES.map(species => discovered.has(species.id) ? loadPortrait(species.id) : Promise.resolve(null)));
  const gradient = context.createLinearGradient(0, 0, 1200, 630);
  gradient.addColorStop(0, "#071d32"); gradient.addColorStop(1, "#01040b");
  context.fillStyle = gradient; context.fillRect(0, 0, 1200, 630);
  context.fillStyle = presentation.accent; context.font = "bold 30px system-ui";
  drawBrandWordmark(context, 64, 24);
  context.fillStyle = presentation.accent;
  context.fillText("DEEP SEA SALVAGE", 440, 64);
  context.fillStyle = "#f3ffff"; context.font = "bold 56px system-ui";
  context.fillText(presentation.headline, 64, 142, 1072);
  context.font = "28px system-ui"; context.fillStyle = "#b8d4dc";
  context.fillText(`${presentation.details[0]} / ${presentation.details[1]}`, 64, 192, 1072);
  SPECIES.forEach((species, index) => {
    const left = 64 + index % 7 * 154;
    const top = 230 + Math.floor(index / 7) * 94;
    const known = discovered.has(species.id);
    context.fillStyle = known ? "#1a4253" : "#0d1b2a";
    context.fillRect(left, top, 138, 84);
    const image = images[index];
    if (image) context.drawImage(image, left + 30, top + 2, 78, 58);
    context.fillStyle = known ? "#e6ffff" : "#53697a";
    context.textAlign = "center"; context.font = "16px system-ui";
    context.fillText(known ? species.name : "？", left + 69, top + 76, 130);
  });
  context.textAlign = "left"; context.font = "24px system-ui"; context.fillStyle = "#ffdb67";
  context.fillText(presentation.details[2]!, 64, 554, 1072);
  context.font = "20px system-ui"; context.fillStyle = "#aeb9d3";
  context.fillText(`${result.playerName} / ${new Date(result.createdAt).toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo" })}`, 64, 596, 1072);
}
