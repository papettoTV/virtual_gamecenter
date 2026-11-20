export type PlayerShipStage = 1 | 2 | 3;
export type PlayerShipLayer = "all" | "body" | "wings";

export function getPlayerWingRotation(elapsed = 0) {
  return elapsed * Math.PI * 2 / 2.4;
}

export function getPlayerShipStage(level = 0): PlayerShipStage {
  return level >= 30 ? 3 : level >= 10 ? 2 : 1;
}

function drawEvolvedShip(context: CanvasRenderingContext2D, color: string, stage: PlayerShipStage,
  { elapsed = 0, layer = "all" }: { elapsed?: number; layer?: PlayerShipLayer }) {
  const panels = stage === 2 ? [
    [[0, -18], [-6, -9], [-6, 12], [-3, 17], [3, 17], [6, 12], [6, -9]],
    [[-11, -12], [-17, -6], [-17, 14], [-12, 7]],
    [[11, -12], [17, -6], [17, 14], [12, 7]],
  ] : [
    [[-3, -7], [-7, -3], [-7, 4], [-3, 8], [3, 8], [7, 4], [7, -3], [3, -7]],
    [[-3, -18], [-12, -17], [-17, -11], [-16, 2], [-11, -5], [-4, -9]],
    [[3, -18], [12, -17], [17, -11], [16, 2], [11, -5], [4, -9]],
    [[-2, 10], [0, 19], [2, 10]],
  ];
  context.fillStyle = "rgba(6, 26, 53, 0.78)";
  context.strokeStyle = color;
  context.lineWidth = 1.5;
  const wingScale = stage === 3 ? Math.cos(getPlayerWingRotation(elapsed)) : 1;
  for (const [index, panel] of panels.entries()) {
    const wing = stage === 3 && (index === 1 || index === 2);
    if (layer === "body" && wing || layer === "wings" && !wing) continue;
    const scale = wing ? wingScale : 1;
    context.beginPath();
    context.moveTo(panel[0]![0]! * scale, panel[0]![1]!);
    for (const point of panel.slice(1)) context.lineTo(point[0]! * scale, point[1]!);
    context.closePath();
    context.fill();
    context.stroke();
  }
  context.strokeStyle = "#bdfcff";
  context.lineWidth = 1;
  context.beginPath();
  if (stage === 2) {
    context.moveTo(0, -13);
    context.lineTo(0, -3);
    context.moveTo(0, 5);
    context.lineTo(0, 13);
    context.moveTo(-9, -3);
    context.lineTo(-12, 5);
    context.moveTo(9, -3);
    context.lineTo(12, 5);
  } else if (layer !== "body") {
    context.moveTo(-14 * wingScale, -9);
    context.lineTo(-11 * wingScale, -13);
    context.lineTo(-6 * wingScale, -14);
    context.moveTo(14 * wingScale, -9);
    context.lineTo(11 * wingScale, -13);
    context.lineTo(6 * wingScale, -14);
  }
  context.stroke();
  context.fillStyle = "#d9fdff";
  if (stage === 2) context.fillRect(-1, 17, 2, 2);
}

export function drawPlayerShip(context: CanvasRenderingContext2D, color: string, glowScale = 1, level = 0,
  options: { elapsed?: number; layer?: PlayerShipLayer } = {}) {
  context.save();
  context.lineJoin = "miter";
  context.lineCap = "square";
  context.shadowBlur = 16 * glowScale;
  context.shadowColor = color;

  const stage = getPlayerShipStage(level);
  if (options.layer === "wings" && stage !== 3) {
    context.restore();
    return;
  }
  if (stage !== 1) {
    drawEvolvedShip(context, color, stage, options);
    context.restore();
    return;
  }

  context.fillStyle = "#d9fdff";
  context.beginPath();
  context.moveTo(-8, 9);
  context.lineTo(-3, 9);
  context.lineTo(-4, 19);
  context.lineTo(-7, 14);
  context.closePath();
  context.moveTo(3, 9);
  context.lineTo(8, 9);
  context.lineTo(7, 14);
  context.lineTo(4, 19);
  context.closePath();
  context.fill();

  context.fillStyle = "#061a35";
  context.strokeStyle = color;
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(0, -18);
  context.lineTo(-5, -8);
  context.lineTo(-8, -5);
  context.lineTo(-14, 1);
  context.lineTo(-17, 11);
  context.lineTo(-8, 7);
  context.lineTo(-7, 14);
  context.lineTo(0, 10);
  context.lineTo(7, 14);
  context.lineTo(8, 7);
  context.lineTo(17, 11);
  context.lineTo(14, 1);
  context.lineTo(8, -5);
  context.lineTo(5, -8);
  context.closePath();
  context.fill();
  context.stroke();

  context.fillStyle = color;
  context.beginPath();
  context.moveTo(-4, -7);
  context.lineTo(-14, 3);
  context.lineTo(-15, 8);
  context.lineTo(-7, 5);
  context.lineTo(-5, 11);
  context.closePath();
  context.moveTo(4, -7);
  context.lineTo(14, 3);
  context.lineTo(15, 8);
  context.lineTo(7, 5);
  context.lineTo(5, 11);
  context.closePath();
  context.fill();

  context.fillStyle = "#bdfcff";
  context.beginPath();
  context.moveTo(0, -15);
  context.lineTo(-4, -3);
  context.lineTo(-3, 9);
  context.lineTo(0, 7);
  context.lineTo(3, 9);
  context.lineTo(4, -3);
  context.closePath();
  context.fill();

  context.fillStyle = "#0879b8";
  context.beginPath();
  context.moveTo(0, -8);
  context.lineTo(-3, -2);
  context.lineTo(-2, 4);
  context.lineTo(2, 4);
  context.lineTo(3, -2);
  context.closePath();
  context.fill();

  context.fillStyle = "rgba(255, 255, 255, 0.92)";
  context.fillRect(-1, -6, 2, 6);
  context.restore();
}
