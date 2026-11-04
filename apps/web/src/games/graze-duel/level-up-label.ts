export type LevelUpLabel = { x: number; y: number; level: number; remaining: number };

export function createLevelUpLabel(player: { x: number; y: number; fieldX: number; level: number }): LevelUpLabel {
  return { x: player.x - player.fieldX, y: player.y - 28, level: player.level, remaining: 1 };
}

export function tickLevelUpLabel(label: LevelUpLabel | null | undefined, delta: number): LevelUpLabel | null {
  if (!label || label.remaining <= delta) return null;
  return { ...label, remaining: label.remaining - delta };
}

export function drawLevelUpLabel(context: CanvasRenderingContext2D, label: LevelUpLabel | null | undefined, fieldX: number, fieldWidth: number, top: number, bottom: number) {
  if (!label || label.remaining <= 0) return;
  context.save();
  context.font = "300 16px system-ui";
  context.textAlign = "left";
  context.textBaseline = "middle";
  context.fillStyle = "rgba(153, 133, 255, 0.9)";
  const titleWidth = context.measureText("LEVEL").width;
  const number = String(label.level);
  context.font = "300 44px system-ui";
  const totalWidth = titleWidth + 8 + context.measureText(number).width;
  const margin = totalWidth / 2 + 8;
  const horizontal = Math.max(fieldX + margin, Math.min(fieldX + fieldWidth - margin, fieldX + label.x));
  const vertical = Math.max(top + 26, Math.min(bottom - 26, label.y));
  const left = horizontal - totalWidth / 2;
  context.font = "300 16px system-ui";
  context.fillText("LEVEL", left, vertical);
  context.font = "300 44px system-ui";
  context.fillText(number, left + titleWidth + 8, vertical);
  context.restore();
}
