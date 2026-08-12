import { DEEP_SEA_SALVAGE } from "../../domain/game";
import { fetchScoreRanking, submitRankingEntry } from "../../features/ranking/ranking-client";

type Phase = "ready" | "dive" | "base" | "boss" | "result";
type Creature = { x: number; y: number; vx: number; vy: number; r: number; kind: number; scan: number; angry: number };
type Treasure = { x: number; y: number; value: number; weight: number; rare: boolean; taken: boolean };
type Upgrade = { name: string; detail: string; apply: () => void };

const canvas = document.querySelector<HTMLCanvasElement>("#game")!;
const ctx = canvas.getContext("2d")!;
const arcadeScreen = document.querySelector<HTMLElement>("#arcade-screen");
const cabinetScreen = document.querySelector<HTMLElement>("#cabinet-screen");
const gameScreen = document.querySelector<HTMLElement>("#game-screen");
const rankingPanel = document.querySelector<HTMLElement>("#ranking-submit-panel");
const rankingResult = document.querySelector<HTMLElement>("#ranking-result");
const rankingHeading = document.querySelector<HTMLElement>("#ranking-submit-heading");
const rankingSubmit = document.querySelector<HTMLButtonElement>("#ranking-submit");
const rankingName = document.querySelector<HTMLInputElement>("#ranking-name");
const rankingList = document.querySelector<HTMLElement>("#ranking-list");
const rankingSubmitList = document.querySelector<HTMLElement>("#ranking-submit-list");
const touchPause = document.querySelector<HTMLButtonElement>("#touch-pause");
const touchScan = document.querySelector<HTMLButtonElement>("#touch-scan");
const touchLight = document.querySelector<HTMLButtonElement>("#touch-light");
const startSoloButton = document.querySelector<HTMLButtonElement>("#start-solo");

const W = canvas.width;
const H = canvas.height;
const keys = new Set<string>();
const pointer = { active: false, x: 0, y: 0 };
let phase: Phase = "ready";
let paused = true;
let lastTime = performance.now();
let elapsed = 0;
let zone = 1;
let distance = 0;
let oxygen = 100;
let hull = 100;
let analysis = 18;
let cargoValue = 0;
let cargoWeight = 0;
let bankedScore = 0;
let runMultiplier = 1;
let lightOn = false;
let scanHeld = false;
let scanPulse = 0;
let message = "P / 画面下のボタンで出航";
let messageTimer = 99;
let creatures: Creature[] = [];
let treasures: Treasure[] = [];
let upgradeOptions: Upgrade[] = [];
let chosenUpgrade = false;
let speedBonus = 0;
let oxygenEfficiency = 1;
let scanBonus = 1;
let armor = 0;
let salvageRange = 24;
let boss = { x: W * .72, y: H * .48, hp: 5, maxHp: 5, angle: 0, attack: 0, exposed: 0 };
let finalScore = 0;
let resultRecorded = false;

const sub = { x: W * .24, y: H * .5, vx: 0, vy: 0, r: 13, invincible: 0 };

function showScreen(screen: "arcade" | "cabinet" | "game") {
  document.body.classList.toggle("is-game-screen", screen === "game");
  arcadeScreen?.classList.toggle("is-hidden", screen !== "arcade");
  cabinetScreen?.classList.toggle("is-hidden", screen !== "cabinet");
  gameScreen?.classList.toggle("is-hidden", screen !== "game");
}

function resetRun() {
  phase = "ready"; paused = true; elapsed = 0; zone = 1; distance = 0;
  oxygen = 100; hull = 100; analysis = 18; cargoValue = 0; cargoWeight = 0;
  bankedScore = 0; runMultiplier = 1; lightOn = false; scanHeld = false;
  speedBonus = 0; oxygenEfficiency = 1; scanBonus = 1; armor = 0; salvageRange = 24;
  sub.x = W * .24; sub.y = H * .5; sub.vx = 0; sub.vy = 0; sub.invincible = 0;
  finalScore = 0; resultRecorded = false; rankingPanel?.classList.remove("is-visible", "is-submitted");
  beginZone();
  setMessage("P / 画面下のボタンで出航", 99);
  updatePauseButton();
}

function beginZone() {
  distance = 0; oxygen = 100; chosenUpgrade = false;
  creatures = Array.from({ length: 4 + zone }, (_, i) => ({
    x: W * (.43 + Math.random() * .45), y: 115 + Math.random() * (H - 220),
    vx: (Math.random() - .5) * (22 + zone * 3), vy: (Math.random() - .5) * 18,
    r: 22 + Math.random() * 15, kind: i % 3, scan: 0, angry: 0,
  }));
  treasures = Array.from({ length: 5 + zone }, (_, i) => ({
    x: 145 + Math.random() * (W - 230), y: 115 + Math.random() * (H - 190),
    value: i === 0 ? 850 : 160 + Math.floor(Math.random() * 280),
    weight: i === 0 ? 18 : 5 + Math.floor(Math.random() * 8), rare: i === 0, taken: false,
  }));
}

function startDive() {
  if (phase === "result") return;
  if (phase === "base") {
    if (!chosenUpgrade) { setMessage("まず 1 / 2 / 3 で装備を選択", 2); return; }
    if (zone >= 2) startBoss();
    else { zone += 1; beginZone(); phase = "dive"; paused = false; setMessage(`DEPTH ${zone} へ潜行`, 2); }
    return;
  }
  phase = "dive"; paused = false; setMessage("潜航開始　黄金色のソナーが基地の方角", 3);
  updatePauseButton();
}

function startBoss() {
  phase = "boss"; paused = false; oxygen = 100;
  boss = { x: W * .72, y: H * .48, hp: 5, maxHp: 5, angle: 0, attack: 1.8, exposed: 0 };
  sub.x = W * .23; sub.y = H * .5;
  setMessage("海域の主　スキャン中に発光する弱点へ接近せよ", 4);
}

function enterBase() {
  phase = "base"; paused = true; oxygen = 100; hull = Math.min(100, hull + 45);
  upgradeOptions = makeUpgrades(); chosenUpgrade = false;
  setMessage("海底基地到着", 3);
  updatePauseButton();
}

function makeUpgrades(): Upgrade[] {
  const pool: Upgrade[] = [
    { name: "高出力スクリュー", detail: "最高速度 +18%", apply: () => { speedBonus += .18; } },
    { name: "広域ソナー", detail: "スキャン速度 +30%", apply: () => { scanBonus *= 1.3; } },
    { name: "酸素リサイクラー", detail: "酸素消費 -22%", apply: () => { oxygenEfficiency *= .78; } },
    { name: "複合装甲", detail: "衝突ダメージ -35%", apply: () => { armor = Math.min(.7, armor + .35); } },
    { name: "磁気グラブ", detail: "財宝回収範囲 +20", apply: () => { salvageRange += 20; } },
  ];
  return [...pool].sort(() => Math.random() - .5).slice(0, 3);
}

function chooseUpgrade(index: number) {
  if (phase !== "base" || chosenUpgrade || !upgradeOptions[index]) return;
  upgradeOptions[index].apply(); chosenUpgrade = true;
  setMessage(`${upgradeOptions[index].name} を装備　Enterで次の海域 / Bで帰還`, 99);
}

function bankAndReturn() {
  if (phase !== "base") return;
  bankedScore += Math.floor(cargoValue * runMultiplier); cargoValue = 0; cargoWeight = 0;
  finish(true, "SALVAGE COMPLETE");
}

function update(dt: number) {
  messageTimer = Math.max(0, messageTimer - dt); scanPulse = Math.max(0, scanPulse - dt);
  if (paused || phase === "ready" || phase === "base" || phase === "result") return;
  elapsed += dt; sub.invincible = Math.max(0, sub.invincible - dt);
  const weightPenalty = Math.max(.45, 1 - cargoWeight * .007);
  const speed = 235 * weightPenalty * (1 + speedBonus);
  let dx = Number(keys.has("ArrowRight") || keys.has("KeyD")) - Number(keys.has("ArrowLeft") || keys.has("KeyA"));
  let dy = Number(keys.has("ArrowDown") || keys.has("KeyS")) - Number(keys.has("ArrowUp") || keys.has("KeyW"));
  if (pointer.active) { dx = (pointer.x - sub.x) / 90; dy = (pointer.y - sub.y) / 90; }
  const length = Math.hypot(dx, dy) || 1; if (length > 1) { dx /= length; dy /= length; }
  sub.vx += (dx * speed - sub.vx) * Math.min(1, dt * 5); sub.vy += (dy * speed - sub.vy) * Math.min(1, dt * 5);
  sub.x = clamp(sub.x + sub.vx * dt, 35, W - 35); sub.y = clamp(sub.y + sub.vy * dt, 92, H - 42);
  oxygen -= dt * (phase === "boss" ? 1.15 : .82) * oxygenEfficiency * (lightOn ? 1.28 : 1);
  if (oxygen <= 0) { hull -= dt * 18; oxygen = 0; }
  if (phase === "dive") updateDive(dt); else updateBoss(dt);
  if (hull <= 0) finish(false, "SUBMERSIBLE LOST");
}

function updateDive(dt: number) {
  distance += dt * (34 + Math.max(0, sub.vx) * .12);
  for (const c of creatures) {
    c.x += c.vx * dt; c.y += c.vy * dt;
    if (c.x < 70 || c.x > W - 70) c.vx *= -1; if (c.y < 110 || c.y > H - 65) c.vy *= -1;
    const d = Math.hypot(sub.x - c.x, sub.y - c.y);
    if (lightOn && d < 260) c.angry = Math.min(1, c.angry + dt * .8); else c.angry = Math.max(0, c.angry - dt * .25);
    if (c.angry > .25) { const a = Math.atan2(sub.y - c.y, sub.x - c.x); c.vx += Math.cos(a) * dt * 32; c.vy += Math.sin(a) * dt * 32; }
    if (scanHeld && d < 185) {
      const danger = clamp(2.25 - d / 100, .35, 2.1); c.scan += dt * .18 * danger * scanBonus; analysis = Math.min(100, analysis + dt * 5 * danger);
      bankedScore += Math.floor(dt * 38 * danger * runMultiplier); scanPulse = .12;
      if (c.scan >= 1 && c.scan - dt * .18 * danger * scanBonus < 1) { bankedScore += Math.floor(600 * danger); setMessage(`BIOLOGICAL SCAN COMPLETE  x${danger.toFixed(1)}`, 1.5); }
    }
    if (d < c.r + sub.r && sub.invincible <= 0) damage(18);
  }
  for (const t of treasures) {
    if (!t.taken && Math.hypot(sub.x - t.x, sub.y - t.y) < salvageRange + sub.r) {
      t.taken = true; cargoValue += t.value; cargoWeight += t.weight;
      setMessage(`${t.rare ? "ANCIENT RELIC" : "SALVAGE"} +${t.value} / 積載 ${cargoWeight}kg`, 1.5);
    }
  }
  if (distance >= 1900) enterBase();
}

function updateBoss(dt: number) {
  boss.angle += dt; boss.attack -= dt; boss.exposed = Math.max(0, boss.exposed - dt);
  boss.x = W * .72 + Math.cos(boss.angle * .45) * 50; boss.y = H * .48 + Math.sin(boss.angle * .7) * 90;
  const d = Math.hypot(sub.x - boss.x, sub.y - boss.y);
  if (scanHeld && analysis > 0) { analysis = Math.max(0, analysis - dt * (d < 145 ? 16 : 8)); boss.exposed = .18; }
  if (boss.exposed > 0 && d < 112 && scanHeld) {
    const before = Math.ceil(boss.hp); boss.hp -= dt * .72;
    if (Math.ceil(boss.hp) < before) setMessage("弱点へ発信器命中", 1);
    if (boss.hp <= 0) { bankedScore += 7000 + Math.floor(analysis * 40); cargoValue = 0; finish(true, "ABYSSAL GUARDIAN ANALYZED"); }
  }
  if (boss.attack <= 0) { boss.attack = 2.1; if (d < 330) damage(13); setMessage("衝撃波　距離を取れ", .8); }
  if (d < 68 + sub.r && sub.invincible <= 0) damage(24);
}

function damage(amount: number) {
  hull -= amount * (1 - armor); sub.invincible = 1.3; sub.vx *= -1.5; sub.vy *= -1.5;
  setMessage(`HULL DAMAGE  ${Math.max(0, Math.ceil(hull))}%`, 1.2);
}

function finish(cleared: boolean, title: string) {
  if (phase === "result") return;
  phase = "result"; paused = true;
  finalScore = Math.max(0, Math.floor(bankedScore + (cleared ? cargoValue * runMultiplier : 0) + (cleared ? oxygen * 20 : 0)));
  setMessage(title, 99); updatePauseButton(); showResult(cleared, title);
}

function showResult(cleared: boolean, title: string) {
  rankingHeading && (rankingHeading.textContent = "ランキング登録");
  rankingResult && (rankingResult.textContent = `${title} / SCORE ${finalScore.toLocaleString()} / DEPTH ${zone} / TIME ${formatTime(elapsed)}`);
  rankingPanel?.classList.add("is-visible"); rankingPanel?.classList.remove("is-submitted");
  rankingSubmit && (rankingSubmit.disabled = !rankingName?.value.trim());
  resultRecorded = cleared;
}

function setMessage(text: string, seconds: number) { message = text; messageTimer = seconds; }
function clamp(v: number, min: number, max: number) { return Math.max(min, Math.min(max, v)); }
function formatTime(s: number) { return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`; }

function draw() {
  const gradient = ctx.createLinearGradient(0, 0, 0, H); gradient.addColorStop(0, phase === "boss" ? "#071321" : "#063a4c"); gradient.addColorStop(1, "#010712");
  ctx.fillStyle = gradient; ctx.fillRect(0, 0, W, H); drawWater();
  if (phase === "dive") { treasures.forEach(drawTreasure); creatures.forEach(drawCreature); drawBaseBeacon(); }
  if (phase === "boss") drawBoss();
  drawSub(); drawHud();
  if (phase === "ready") drawOverlay("深海サルベージ", ["危険生物の近くでスキャンし、財宝を回収", "WASD / 矢印: 移動　 Shift / E: スキャン　 L: ライト", "P または画面下のボタンで出航"]);
  if (phase === "base") drawBaseMenu();
  if (paused && phase === "dive") drawOverlay("PAUSED", ["P で再開"]);
  if (phase === "result") drawOverlay(message, [`SCORE ${finalScore.toLocaleString()}`, "ランキング登録またはリトライを選択"]);
}

function drawWater() {
  ctx.save(); ctx.globalAlpha = lightOn ? .5 : .2; ctx.fillStyle = "#77fff0";
  for (let i = 0; i < 46; i++) { const x = (i * 137 + elapsed * (8 + i % 4)) % W; const y = 80 + (i * 83) % (H - 100); ctx.fillRect(x, y, 2, 2); }
  ctx.restore(); ctx.fillStyle = "#03101b"; ctx.beginPath(); ctx.moveTo(0, H); for (let x = 0; x <= W; x += 80) ctx.lineTo(x, H - 32 - Math.sin(x * .025) * 12); ctx.lineTo(W, H); ctx.fill();
}

function drawSub() {
  ctx.save(); ctx.translate(sub.x, sub.y); ctx.rotate(Math.atan2(sub.vy, Math.abs(sub.vx) + 60) * .35);
  if (lightOn) { const beam = ctx.createLinearGradient(20, 0, 220, 0); beam.addColorStop(0, "rgba(255,238,150,.3)"); beam.addColorStop(1, "rgba(255,238,150,0)"); ctx.fillStyle = beam; ctx.beginPath(); ctx.moveTo(12, -9); ctx.lineTo(240, -72); ctx.lineTo(240, 72); ctx.lineTo(12, 9); ctx.fill(); }
  ctx.globalAlpha = sub.invincible > 0 && Math.floor(sub.invincible * 12) % 2 ? .35 : 1; ctx.fillStyle = "#e5c45b"; ctx.beginPath(); ctx.ellipse(0, 0, 27, 13, 0, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = "#6af6e7"; ctx.beginPath(); ctx.arc(5, -7, 7, Math.PI, 0); ctx.fill(); ctx.fillStyle = "#d77f36"; ctx.fillRect(-31, -4, 8, 8); ctx.restore();
  if (scanHeld) { ctx.strokeStyle = `rgba(89,255,225,${.25 + scanPulse * 4})`; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(sub.x, sub.y, 80 + Math.sin(elapsed * 8) * 12, 0, Math.PI * 2); ctx.stroke(); }
}

function drawCreature(c: Creature) {
  const visible = lightOn || Math.hypot(sub.x - c.x, sub.y - c.y) < 230;
  ctx.save(); ctx.globalAlpha = visible ? .9 : .22; ctx.translate(c.x, c.y); ctx.fillStyle = c.angry > .25 ? "#df5377" : (["#6e8ee8", "#7cc89c", "#ac6bd1"][c.kind] ?? "#6e8ee8");
  ctx.beginPath(); if (c.kind === 1) { for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; ctx.lineTo(Math.cos(a) * (i % 2 ? c.r * .55 : c.r), Math.sin(a) * (i % 2 ? c.r * .55 : c.r)); } } else ctx.ellipse(0, 0, c.r * 1.35, c.r * .72, 0, 0, Math.PI * 2); ctx.closePath(); ctx.fill();
  ctx.fillStyle = "#ffefab"; ctx.beginPath(); ctx.arc(c.r * .5, -3, 3, 0, Math.PI * 2); ctx.fill();
  if (c.scan > 0) { ctx.fillStyle = "rgba(255,255,255,.2)"; ctx.fillRect(-c.r, -c.r - 14, c.r * 2, 4); ctx.fillStyle = "#59ffe1"; ctx.fillRect(-c.r, -c.r - 14, c.r * 2 * Math.min(1, c.scan), 4); }
  ctx.restore();
}

function drawTreasure(t: Treasure) { if (t.taken) return; const visible = lightOn || Math.hypot(sub.x - t.x, sub.y - t.y) < 155; ctx.save(); ctx.globalAlpha = visible ? 1 : .18; ctx.fillStyle = t.rare ? "#ffd95e" : "#b9783d"; ctx.fillRect(t.x - 10, t.y - 8, 20, 16); ctx.strokeStyle = "#ffe99c"; ctx.strokeRect(t.x - 10, t.y - 8, 20, 16); ctx.restore(); }
function drawBaseBeacon() { const ratio = clamp(distance / 1900, 0, 1); ctx.fillStyle = "rgba(255,213,91,.12)"; ctx.fillRect(W - 42, 92, 4, H - 140); ctx.fillStyle = "#ffd55b"; ctx.fillRect(W - 46, H - 48 - (H - 140) * ratio, 12, 5); }

function drawBoss() {
  ctx.save(); ctx.translate(boss.x, boss.y); ctx.rotate(Math.sin(boss.angle) * .12); ctx.fillStyle = "#15283d"; ctx.beginPath(); ctx.ellipse(0, 0, 82, 55, 0, 0, Math.PI * 2); ctx.fill();
  for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3 + boss.angle * .15; ctx.strokeStyle = "#254b64"; ctx.lineWidth = 12; ctx.beginPath(); ctx.moveTo(Math.cos(a) * 45, Math.sin(a) * 30); ctx.quadraticCurveTo(Math.cos(a) * 95, Math.sin(a) * 85, Math.cos(a + .35) * 120, Math.sin(a + .35) * 95); ctx.stroke(); }
  ctx.fillStyle = boss.exposed > 0 ? "#ffda5a" : "#6b334d"; ctx.beginPath(); ctx.arc(-32, 5, 12, 0, Math.PI * 2); ctx.fill(); ctx.restore();
  ctx.fillStyle = "rgba(255,255,255,.14)"; ctx.fillRect(W / 2 - 150, 78, 300, 9); ctx.fillStyle = "#ff6a8b"; ctx.fillRect(W / 2 - 150, 78, 300 * Math.max(0, boss.hp / boss.maxHp), 9);
}

function drawHud() {
  ctx.fillStyle = "rgba(0,8,18,.78)"; ctx.fillRect(0, 0, W, 68); ctx.font = "700 15px system-ui"; ctx.fillStyle = "#dffdfa";
  ctx.fillText(`HULL ${Math.max(0, Math.ceil(hull))}%`, 25, 27); ctx.fillText(`O₂ ${Math.ceil(oxygen)}%`, 25, 51); ctx.fillText(`ANALYSIS ${Math.floor(analysis)}%`, 155, 27); ctx.fillText(`CARGO ${cargoWeight}kg / ${cargoValue.toLocaleString()}`, 155, 51); ctx.fillText(`BANK ${bankedScore.toLocaleString()}`, 405, 27); ctx.fillText(`DEPTH ${zone}`, 405, 51); ctx.fillText(`TIME ${formatTime(elapsed)}`, 555, 27); ctx.fillText(lightOn ? "LIGHT ON" : "LIGHT OFF", 555, 51);
  ctx.fillStyle = "rgba(1,10,18,.76)"; ctx.fillRect(0, H - 34, W, 34); ctx.fillStyle = messageTimer > 0 ? "#ffe48b" : "#8eb7bd"; ctx.textAlign = "center"; ctx.fillText(messageTimer > 0 ? message : "危険に近いほどスキャンが加速", W / 2, H - 12); ctx.textAlign = "left";
}

function drawOverlay(title: string, lines: string[]) { ctx.fillStyle = "rgba(0,5,13,.76)"; ctx.fillRect(0, 0, W, H); ctx.textAlign = "center"; ctx.fillStyle = "#71ffe8"; ctx.font = "800 48px system-ui"; ctx.fillText(title, W / 2, H / 2 - 78); ctx.fillStyle = "#e9fffc"; ctx.font = "600 18px system-ui"; lines.forEach((line, i) => ctx.fillText(line, W / 2, H / 2 - 16 + i * 34)); ctx.textAlign = "left"; }
function drawBaseMenu() { drawOverlay(`SEAFLOOR BASE 0${zone}`, ["酸素・船体を回復　装備を1つ選択", ...upgradeOptions.map((u, i) => `${i + 1}. ${u.name} — ${u.detail}${chosenUpgrade ? (i === -1 ? "" : "") : ""}`), chosenUpgrade ? "Enter: 次へ潜る　 B: 財宝を預けて帰還" : "1 / 2 / 3 で選択"]); }

function togglePause() { if (phase === "ready") startDive(); else if (phase === "dive") paused = !paused; updatePauseButton(); }
function updatePauseButton() { if (!touchPause) return; touchPause.textContent = phase === "ready" ? "出航" : paused && phase === "dive" ? "再開" : "一時停止"; }

window.addEventListener("keydown", (event) => {
  keys.add(event.code);
  if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(event.code)) event.preventDefault();
  if (event.code === "KeyP") togglePause();
  if (event.code === "KeyL") lightOn = !lightOn;
  if (event.code === "ShiftLeft" || event.code === "ShiftRight" || event.code === "KeyE") scanHeld = true;
  if (phase === "base" && /^Digit[123]$/.test(event.code)) chooseUpgrade(Number(event.code.at(-1)) - 1);
  if (phase === "base" && event.code === "Enter") startDive();
  if (phase === "base" && event.code === "KeyB") bankAndReturn();
  if (phase === "result" && event.code === "KeyR") resetRun();
});
window.addEventListener("keyup", (event) => { keys.delete(event.code); if (["ShiftLeft", "ShiftRight", "KeyE"].includes(event.code)) scanHeld = false; });
canvas.addEventListener("pointerdown", (event) => { const r = canvas.getBoundingClientRect(); pointer.active = true; pointer.x = (event.clientX - r.left) * W / r.width; pointer.y = (event.clientY - r.top) * H / r.height; });
canvas.addEventListener("pointermove", (event) => { if (!pointer.active) return; const r = canvas.getBoundingClientRect(); pointer.x = (event.clientX - r.left) * W / r.width; pointer.y = (event.clientY - r.top) * H / r.height; });
window.addEventListener("pointerup", () => { pointer.active = false; });
touchPause?.addEventListener("click", togglePause);
touchLight?.addEventListener("click", () => { lightOn = !lightOn; });
touchScan?.addEventListener("pointerdown", () => { scanHeld = true; });
touchScan?.addEventListener("pointerup", () => { scanHeld = false; });
touchScan?.addEventListener("pointercancel", () => { scanHeld = false; });

window.addEventListener("create-solo-cabinet", ((event: CustomEvent<{ gameId: string }>) => {
  if (event.detail?.gameId !== DEEP_SEA_SALVAGE.id) return;
  startSoloButton?.click();
}) as EventListener);
window.addEventListener("platform-play-approved", ((event: CustomEvent<{ gameId: string }>) => {
  if (event.detail?.gameId !== DEEP_SEA_SALVAGE.id) return;
  resetRun(); showScreen("game"); lastTime = performance.now();
}) as EventListener);
document.querySelector("#back-to-arcade")?.addEventListener("click", () => window.location.assign("/"));
document.querySelector("#cabinet-breadcrumb-arcade")?.addEventListener("click", () => window.location.assign("/"));
document.querySelector("#game-back-to-arcade")?.addEventListener("click", () => window.location.assign("/"));
document.querySelector("#ranking-another-game")?.addEventListener("click", () => window.location.assign("/"));
document.querySelector("#ranking-retry")?.addEventListener("click", () => { resetRun(); showScreen("game"); });
rankingName?.addEventListener("input", () => { if (rankingSubmit) rankingSubmit.disabled = !rankingName.value.trim() || !finalScore; });
rankingSubmit?.addEventListener("click", () => void submitScore());

async function submitScore() {
  if (!finalScore || !rankingSubmit || !rankingName?.value.trim()) return;
  rankingSubmit.disabled = true;
  try {
    await submitRankingEntry({ gameId: DEEP_SEA_SALVAGE.id, elapsedTimeMs: Math.round(elapsed * 1000), cleared: resultRecorded, score: finalScore, maxLevel: zone, defeatedBossCount: resultRecorded && zone >= 2 ? 1 : 0, clientVersion: DEEP_SEA_SALVAGE.currentVersion });
    rankingPanel?.classList.add("is-submitted"); if (rankingHeading) rankingHeading.textContent = "スコアランキング"; await loadRanking();
  } catch { if (rankingResult) rankingResult.textContent += " / ランキングAPIに接続できません"; rankingSubmit.disabled = false; }
}

async function loadRanking() {
  try { renderRanking(await fetchScoreRanking(DEEP_SEA_SALVAGE.id, 20, DEEP_SEA_SALVAGE.currentVersion)); }
  catch { for (const el of [rankingList, rankingSubmitList]) if (el) el.innerHTML = '<tr><td colspan="4">ランキングAPI未接続</td></tr>'; }
}
function renderRanking(entries: Awaited<ReturnType<typeof fetchScoreRanking>>) {
  const html = entries.map((e, i) => `<tr><td>${i + 1}</td><td>${escapeHtml(e.player_name)}</td><td>${e.score.toLocaleString()}</td><td>${new Date(e.created_at).toLocaleDateString("ja-JP")}</td></tr>`).join("") || '<tr><td colspan="4">まだ記録がありません</td></tr>';
  for (const el of [rankingList, rankingSubmitList]) if (el) el.innerHTML = html;
}
function escapeHtml(value: string) { const el = document.createElement("span"); el.textContent = value; return el.innerHTML; }

function syncInitialScreen() { showScreen(window.location.pathname.startsWith("/cabinets/") ? "cabinet" : "arcade"); }
function loop(now: number) { const dt = Math.min(.05, (now - lastTime) / 1000); lastTime = now; update(dt); draw(); requestAnimationFrame(loop); }
resetRun(); syncInitialScreen(); void loadRanking(); requestAnimationFrame(loop);

export {};
