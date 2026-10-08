import type { Judgment } from "./core";

// Keep the presentation thresholds together so the three finishes can be tuned later.
export const FINISH_THRESHOLDS = { excellent: 80_000, standard: 60_000 };
export function mochiFinish(score: number) {
  if (score >= FINISH_THRESHOLDS.excellent) return { kind: "excellent" as const, title: "とても美味しそうなもち", description: "つやつや、ふっくら！のびのいい、ごちそうもち。" };
  if (score >= FINISH_THRESHOLDS.standard) return { kind: "standard" as const, title: "美味しそうなもち", description: "やわらかく、まあるく。おいしいおもちのできあがり！" };
  return { kind: "poor" as const, title: "まずそうなもち", description: "ごつごつ、ぺたんこ…。次はリズムに合わせて、ふっくらさせよう。" };
}
export type MochiFinish = ReturnType<typeof mochiFinish>["kind"];

export function mochiImpact(judgment: Judgment | null, age: number) {
  if (age < 0 || age >= .46 || judgment === null) return { dent: 0, spread: 0, bounce: 0 };
  const strength = age < .09 ? Math.sin(age / .09 * Math.PI / 2) : Math.pow(1 - (age - .09) / .37, 2);
  if (judgment === "perfect") return { dent: 31 * strength, spread: 22 * strength, bounce: 0 };
  if (judgment === "good") return { dent: 12 * strength, spread: 8 * strength, bounce: 3 * strength };
  return { dent: 0, spread: 0, bounce: 8 * Math.abs(Math.sin(age / .46 * Math.PI * 2)) * (1 - age / .46) };
}

/** Result illustration uses the same native drawing style as the game. */
export function drawFinishedMochi(ctx: CanvasRenderingContext2D, kind: MochiFinish) {
  ctx.clearRect(0, 0, 440, 160);
  const excellent = kind === "excellent";
  const poor = kind === "poor";
  ctx.fillStyle = excellent ? "#fff0c8" : poor ? "#e5dfd2" : "#f8f1df";
  ctx.fillRect(0, 0, 440, 160);
  const oval = (x: number, y: number, rx: number, ry: number, color: string) => {
    ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill();
  };
  oval(220, 134, 123, 12, "#294c4020");
  oval(220, 122, 134, 23, "#709584");
  oval(220, 117, 127, 21, "#e3ecda");
  // Leaf and plate give each finish a shared scale; the mochi itself changes.
  ctx.beginPath(); ctx.moveTo(118, 119); ctx.quadraticCurveTo(200, 66, 322, 118); ctx.quadraticCurveTo(220, 151, 118, 119);
  ctx.fillStyle = "#8da86b"; ctx.fill();
  if (poor) {
    ctx.beginPath(); ctx.moveTo(146, 115); ctx.lineTo(153, 97); ctx.lineTo(176, 98);
    ctx.lineTo(186, 78); ctx.lineTo(211, 95); ctx.lineTo(232, 84); ctx.lineTo(251, 97);
    ctx.lineTo(280, 93); ctx.lineTo(298, 117); ctx.quadraticCurveTo(220, 139, 146, 115);
    ctx.fillStyle = "#b5aa85"; ctx.fill(); ctx.strokeStyle = "#827655"; ctx.lineWidth = 3; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(187, 86); ctx.lineTo(199, 106); ctx.lineTo(192, 117);
    ctx.moveTo(250, 98); ctx.lineTo(237, 112); ctx.lineTo(249, 123); ctx.stroke();
    oval(172, 110, 10, 4, "#938364"); oval(270, 115, 8, 3, "#938364");
  } else {
    const gradient = ctx.createLinearGradient(0, 49, 0, 131);
    gradient.addColorStop(0, "#ffffff"); gradient.addColorStop(.6, "#fffdf0"); gradient.addColorStop(1, excellent ? "#efce8c" : "#e4d8b4");
    ctx.beginPath(); ctx.moveTo(142, 113);
    ctx.bezierCurveTo(140, excellent ? 35 : 60, 298, excellent ? 35 : 60, 298, 113);
    ctx.bezierCurveTo(292, 140, 151, 140, 142, 113);
    ctx.fillStyle = gradient; ctx.fill(); ctx.strokeStyle = "#ad956c"; ctx.lineWidth = 2; ctx.stroke();
    oval(191, excellent ? 77 : 88, 22, 7, "#ffffff");
    if (excellent) {
      ctx.strokeStyle = "#bda677"; ctx.lineWidth = 2; ctx.lineCap = "round";
      for (const x of [195, 220, 245]) {
        ctx.beginPath(); ctx.moveTo(x, 42); ctx.bezierCurveTo(x - 12, 33, x + 12, 25, x, 14); ctx.stroke();
      }
      ctx.fillStyle = "#ce9637";
      for (const [x, y, r] of [[109, 63, 12], [328, 71, 14], [306, 35, 8]]) {
        ctx.beginPath(); ctx.moveTo(x!, y! - r!); ctx.quadraticCurveTo(x!, y!, x! + r!, y!);
        ctx.quadraticCurveTo(x!, y!, x!, y! + r!); ctx.quadraticCurveTo(x!, y!, x! - r!, y!); ctx.quadraticCurveTo(x!, y!, x!, y! - r!); ctx.fill();
      }
    }
  }
}
