import { BEAT_SECONDS, COUNT_IN, PATTERNS, TOTAL_BEATS, result, roundAt, type Run } from "./core";

export type Scene = { seconds: number; run: Run; phase: "ready" | "playing" | "paused" | "result"; feedback: string; feedbackAt: number; tappedAt: number };
const INK = "#294c40";
const CREAM = "#fffaf0";
const stages = ["おひさま広場", "夕やけピクニック", "お月見パーティー"];
const skies = ["#f8f1db", "#f6e1d3", "#dfe7f0"];

export function drawScene(ctx: CanvasRenderingContext2D, scene: Scene) {
  const { seconds, run, phase } = scene;
  const beat = Math.max(0, seconds / BEAT_SECONDS);
  const round = roundAt(beat);
  const stage = Math.floor(round / 4);
  const local = (beat - COUNT_IN) % 8;
  const counting = beat < COUNT_IN;
  const responding = !counting && local >= 4;
  const pulse = Math.pow(1 - beat % 1, 3);
  const pattern = PATTERNS[round]!;
  const demoAge = local < 4 ? Math.min(...pattern.filter((note) => note <= local).map((note) => local - note)) : 10;
  const demoStrike = !counting && demoAge < .32 ? Math.sin(demoAge / .32 * Math.PI) : 0;
  const playerAge = seconds - scene.tappedAt;
  const playerStrike = playerAge >= 0 && playerAge < .19 ? Math.sin(playerAge / .19 * Math.PI) : 0;

  function text(value: string, x: number, y: number, size: number, color = INK, align: CanvasTextAlign = "center") {
    ctx.font = `800 ${size}px "Hiragino Kaku Gothic ProN", "Noto Sans JP", sans-serif`;
    ctx.fillStyle = color; ctx.textAlign = align; ctx.fillText(value, x, y);
  }
  function ellipse(x: number, y: number, rx: number, ry: number, color: string, outline = false) {
    ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill();
    if (outline) { ctx.strokeStyle = INK; ctx.lineWidth = 3; ctx.stroke(); }
  }
  function box(x: number, y: number, w: number, h: number, radius: number, color: string) {
    ctx.beginPath(); ctx.roundRect(x, y, w, h, radius); ctx.fillStyle = color; ctx.fill();
  }
  function rabbit(x: number, y: number, flip: boolean, strike: number, apron: string) {
    ctx.save(); ctx.translate(x, y + pulse * 4); if (flip) ctx.scale(-1, 1);
    ellipse(0, 98, 77, 12, "#314b3920");
    ellipse(-30, 82, 27, 16, CREAM, true); ellipse(30, 82, 27, 16, CREAM, true);
    ellipse(0, 30, 54, 62, CREAM, true);
    box(-35, 6, 70, 67, 16, apron);
    ellipse(-26, -109, 17, 57, CREAM, true); ellipse(17, -117, 17, 56, CREAM, true);
    ellipse(-26, -112, 7, 34, "#edb3a0"); ellipse(17, -120, 7, 34, "#edb3a0");
    ellipse(0, -47, 58, 51, CREAM, true);
    ellipse(-22, -50, 4, 5, INK); ellipse(21, -50, 4, 5, INK);
    ellipse(-35, -32, 10, 6, "#edb3a0"); ellipse(34, -32, 10, 6, "#edb3a0");
    text("ᴗ", 0, -24, 24);
    ctx.save(); ctx.translate(40, 35); ctx.rotate(-.25 + strike * 1.8);
    box(-8, -106, 15, 126, 6, "#a87348"); box(-39, -126, 77, 38, 12, "#d3a36b");
    ctx.strokeStyle = INK; ctx.lineWidth = 3; ctx.strokeRect(-30, -119, 58, 23);
    ellipse(0, 4, 17, 16, CREAM, true); ctx.restore(); ctx.restore();
  }

  ctx.clearRect(0, 0, 960, 640);
  ctx.fillStyle = skies[stage]!; ctx.fillRect(0, 0, 960, 640);
  ellipse(804, 166, 54 + pulse * 2, 54 + pulse * 2, stage === 2 ? CREAM : "#e9b460");
  if (stage === 2) {
    for (let i = 0; i < 13; i++) text("✦", 74 + i * 67, 135 + (i % 3) * 35, 12, "#a4b2bb");
  }
  ellipse(125, 464, 360, 125, "#d2dfbf"); ellipse(834, 480, 340, 138, "#c1d3ad");
  ctx.fillStyle = "#b3c8a2"; ctx.fillRect(0, 479, 960, 161);
  for (let i = 0; i < 16; i++) { ellipse(30 + i * 63, 494 + i % 3 * 13, 3, 6, "#819e78"); }

  text("MOCHI BEAT", 36, 42, 17, INK, "left");
  text(`STAGE ${stage + 1} / 3  ·  ${stages[stage]}`, 36, 70, 14, INK, "left");
  text(result(run).score.toLocaleString().padStart(6, "0"), 922, 49, 32, INK, "right");
  text(`${run.combo} COMBO`, 922, 75, 14, INK, "right");
  box(36, 91, 888, 4, 2, "#294c401a");
  box(36, 91, Math.max(4, Math.min(1, beat / TOTAL_BEATS) * 888), 4, 2, INK);

  box(280, 117, 400, 57, 28, responding ? INK : CREAM);
  text(counting ? "リズムにのろう！" : responding ? "あなたの番！" : "お手本をきこう", 480, 154, 27, responding ? CREAM : INK);
  text(counting ? "4拍きいて、4拍で返そう" : `フレーズ ${round + 1} / 12`, 480, 202, 15);

  rabbit(258, 377, false, demoStrike, "#86ada0");
  rabbit(702, 377, true, playerStrike, "#e5a852");
  ellipse(480, 492, 100, 15, "#314b3920");
  box(400, 421, 160, 70, 20, "#bc8858");
  ctx.strokeStyle = "#855d3b"; ctx.lineWidth = 3;
  for (let i = 0; i < 5; i++) { ctx.beginPath(); ctx.moveTo(420 + i * 30, 439); ctx.lineTo(420 + i * 30, 481); ctx.stroke(); }
  ellipse(480, 423, 80, 26, "#dfb780", true);
  ellipse(480, 421, 63, 17, "#8d6441");
  const squish = Math.max(demoStrike, playerStrike);
  ellipse(480, 412 + squish * 8, 53 + squish * 11, 27 - squish * 12, CREAM, true);
  if (squish > .5) for (const [dx, dy] of [[-65, -22], [58, -28], [-25, -60], [30, -65]]) ellipse(480 + dx!, 410 + dy!, 5, 8, CREAM);

  box(180, 501, 154, 29, 14, !responding ? INK : "#ffffff88");
  box(625, 501, 154, 29, 14, responding ? INK : "#ffffff88");
  text("おてほん", 257, 522, 15, !responding ? CREAM : INK);
  text("あなた", 702, 522, 15, responding ? CREAM : INK);

  if (phase === "playing" && seconds - scene.feedbackAt < .65) {
    text(scene.feedback, 480, 284, 30, scene.feedback.startsWith("ぴったり") ? "#a45829" : INK);
  }
  box(290, 550, 380, 64, 28, "#fffaf0df");
  const halfBeat = counting ? beat : local % 4;
  for (let index = 0; index < 8; index++) {
    const x = 329 + index * 43;
    const isNote = !counting && pattern.includes(index / 2);
    const active = Math.floor(halfBeat * 2) === index;
    ellipse(x, 576, active ? 15 : isNote ? 11 : 5, active ? 15 : isNote ? 11 : 5, active ? "#dfa152" : isNote ? INK : "#bdc7b7");
    if (index % 2 === 0) text(String(index / 2 + 1), x, 604, 12);
  }
  if (counting && phase === "playing") text(String(4 - Math.floor(beat)), 480, 331, 75);
  if (phase === "paused") {
    ctx.fillStyle = "#fffaf0dc"; ctx.fillRect(0, 0, 960, 640);
    text("ひとやすみ", 480, 285, 44);
    text("P / 再開ボタンで、続きから", 480, 336, 22);
  }
}
