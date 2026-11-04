export type LevelUpLabel = { x: number; y: number; level: number; remaining: number };

export function createLevelUpLabel(player: { x: number; y: number; fieldX: number; level: number }): LevelUpLabel {
  return { x: player.x - player.fieldX, y: player.y - 48, level: player.level, remaining: 1 };
}

export function tickLevelUpLabel(label: LevelUpLabel | null | undefined, delta: number): LevelUpLabel | null {
  if (!label || label.remaining <= delta) return null;
  return { ...label, remaining: label.remaining - delta };
}

export function drawLevelUpLabel(context: CanvasRenderingContext2D, label: LevelUpLabel | null | undefined, fieldX: number, fieldWidth: number, top: number, bottom: number) {
  if (!label || label.remaining <= 0) return;
  context.save();
  context.font = "300 16px system-ui";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillStyle = "rgba(222, 235, 255, 0.85)";
  const text = `LEVEL ${label.level}`;
  const margin = context.measureText(text).width / 2 + 8;
  const horizontal = Math.max(fieldX + margin, Math.min(fieldX + fieldWidth - margin, fieldX + label.x));
  const vertical = Math.max(top + 12, Math.min(bottom - 12, label.y));
  context.fillText(text, horizontal, vertical);
  context.restore();
}
