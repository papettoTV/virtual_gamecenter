export function drawPlayerShip(context: CanvasRenderingContext2D, color: string, glowScale = 1) {
  context.save();
  context.lineJoin = "miter";
  context.lineCap = "square";
  context.shadowBlur = 16 * glowScale;
  context.shadowColor = color;

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
