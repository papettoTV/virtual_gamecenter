import { MOCHI_BEAT } from "../../domain/game";
import { fetchScoreRanking, submitRankingEntry } from "../../features/ranking/ranking-client";
import { BEAT_SECONDS, COUNT_IN, TOTAL_BEATS, createRun, hit, missExpired, result, roundAt } from "./core";
import { MochiAudio } from "./audio";
import { drawScene, type Scene } from "./render";

function element<T extends HTMLElement = HTMLElement>(id: string) { return document.getElementById(id) as T; }
const canvas = element<HTMLCanvasElement>("game");
const ctx = canvas.getContext("2d")!;
const intro = element("mochi-intro");
const start = element<HTMLButtonElement>("mochi-start");
const tap = element<HTMLButtonElement>("mochi-tap");
const pause = element<HTMLButtonElement>("touch-pause");
const volume = element<HTMLInputElement>("mochi-volume");
const offset = element<HTMLInputElement>("mochi-offset");
const status = element("mochi-status");
const panel = element("ranking-submit-panel");
const submit = element<HTMLButtonElement>("ranking-submit");
const preview = import.meta.env.DEV && new URLSearchParams(window.location.search).get("rhythmPreview") === "1";
let audio: MochiAudio | null = null;
let scene: Scene = { seconds: 0, run: createRun(), phase: "ready", feedback: "", feedbackAt: -10, tappedAt: -10 };
let submitting = false;
let submitted = false;
let transition = false;
let lastSection = -1;
let runId = 0;

try {
  const saved = Number(localStorage.getItem("mochi-beat-offset") ?? 0);
  offset.value = String(Number.isFinite(saved) ? Math.max(-200, Math.min(200, saved)) : 0);
} catch { /* Storage can be unavailable in private browsing. */ }
element("mochi-offset-value").textContent = `${offset.value} ms`;

function showScreen(screen: "arcade" | "cabinet" | "game") {
  document.body.classList.toggle("is-game-screen", screen === "game");
  for (const name of ["arcade", "cabinet", "game"]) element(`${name}-screen`).classList.toggle("is-hidden", name !== screen);
}

function reset() {
  runId += 1;
  audio?.stop();
  scene = { seconds: 0, run: createRun(), phase: "ready", feedback: "", feedbackAt: -10, tappedAt: -10 };
  intro.hidden = false; panel.classList.remove("is-visible", "is-submitted");
  submitted = false; submitting = false; lastSection = -1;
  offset.disabled = false; start.disabled = false; tap.disabled = true; pause.disabled = true;
  pause.textContent = "一時停止";
  element("ranking-submit-heading").textContent = "ランキング登録";
  element("mochi-audio-error").textContent = "";
  status.textContent = "お手本のあと、同じリズムを返そう。";
  showScreen("game");
}

async function begin() {
  if (scene.phase !== "ready" || transition) return;
  transition = true; start.disabled = true;
  try {
    audio ??= new MochiAudio(Number(volume.value) / 100);
    await audio.start();
    intro.hidden = true; scene.phase = "playing";
    offset.disabled = true; tap.disabled = false; pause.disabled = false;
  } catch {
    element("mochi-audio-error").textContent = "音を開始できませんでした。もう一度スタートを押してください。";
    start.disabled = false;
  } finally { transition = false; }
}

async function togglePause() {
  if (!audio || transition || !["playing", "paused"].includes(scene.phase)) return;
  transition = true;
  try {
    if (scene.phase === "playing") {
      scene.phase = "paused"; tap.disabled = true;
      await audio.pause(); scene.seconds = audio.seconds;
      pause.textContent = "再開"; status.textContent = "一時停止中。再開すると同じ位置から続きます。";
    } else {
      await audio.resume(); scene.phase = "playing"; tap.disabled = false;
      pause.textContent = "一時停止"; lastSection = -1;
    }
  } catch { status.textContent = "音を再開できませんでした。再開ボタンを押してください。"; }
  finally { transition = false; }
}

function strike() {
  if (scene.phase !== "playing" || !audio) return;
  const seconds = audio.seconds;
  const judgment = hit(scene.run, seconds - Number(offset.value) / 1000);
  scene.tappedAt = seconds;
  audio.thump(judgment?.judgment !== "miss");
  if (!judgment) return;
  scene.feedback = judgment.judgment === "perfect" ? "ぴったり！" : judgment.judgment === "good" ? (judgment.error! < 0 ? "おしい！ はやめ" : "おしい！ おそめ") : "おっと、お休み！";
  scene.feedbackAt = seconds;
}

function finish() {
  scene.phase = "result"; audio?.stop();
  tap.disabled = true; pause.disabled = true;
  const stats = result(scene.run);
  element("ranking-submit-heading").textContent = stats.grade;
  element("ranking-result").textContent = `SCORE ${stats.score.toLocaleString()} / ぴったり ${stats.perfect}・おしい ${stats.good}・ミス ${stats.miss} / 余分なタップ ${scene.run.extras} / 最大 ${scene.run.maxCombo} コンボ`;
  status.textContent = `${stats.grade} スコア ${stats.score.toLocaleString()}。`;
  panel.classList.add("is-visible");
  submit.disabled = preview;
  if (preview) element("ranking-result").textContent += " / 開発プレビュー（ランキング登録なし）";
  void loadRanking();
}

async function loadRanking() {
  try {
    const entries = await fetchScoreRanking(MOCHI_BEAT.id, 20, MOCHI_BEAT.currentVersion);
    for (const id of ["ranking-list", "ranking-submit-list"]) {
      const body = element(id); body.replaceChildren();
      for (const [index, entry] of entries.entries()) {
        const tr = document.createElement("tr");
        for (const value of [index + 1, entry.player_name, entry.score.toLocaleString(), new Date(entry.created_at).toLocaleDateString("ja-JP")]) {
          const td = document.createElement("td"); td.textContent = String(value); tr.appendChild(td);
        }
        body.appendChild(tr);
      }
      if (!entries.length) rankingMessage(body, "まだ記録がありません");
    }
  } catch { for (const id of ["ranking-list", "ranking-submit-list"]) rankingMessage(element(id), "ランキングを読み込めませんでした"); }
}
function rankingMessage(body: HTMLElement, message: string) {
  const row = document.createElement("tr"); const cell = document.createElement("td");
  cell.colSpan = 4; cell.textContent = message; row.appendChild(cell); body.replaceChildren(row);
}

submit.addEventListener("click", async () => {
  if (preview || scene.phase !== "result" || submitting || submitted) return;
  const currentRun = runId;
  submitting = true; submit.disabled = true;
  try {
    await submitRankingEntry({ gameId: MOCHI_BEAT.id, elapsedTimeMs: Math.round(TOTAL_BEATS * BEAT_SECONDS * 1000), cleared: result(scene.run).score >= 60_000, score: result(scene.run).score, maxLevel: 3, defeatedBossCount: 0, clientVersion: MOCHI_BEAT.currentVersion });
    if (currentRun !== runId) return;
    submitted = true; panel.classList.add("is-submitted");
    element("ranking-submit-heading").textContent = "スコアを登録しました";
    await loadRanking();
  } catch {
    if (currentRun !== runId) return;
    element("ranking-submit-heading").textContent = "登録できませんでした。もう一度お試しください。";
    submit.disabled = false;
  } finally { if (currentRun === runId) submitting = false; }
});

start.addEventListener("click", () => void begin());
pause.addEventListener("click", () => void togglePause());
tap.addEventListener("pointerdown", (event) => { if (!event.isPrimary || event.button !== 0) return; event.preventDefault(); strike(); });
// Keyboard and assistive-technology activation of the native button.
tap.addEventListener("click", (event) => { if (event.detail === 0) strike(); });
canvas.addEventListener("pointerdown", (event) => { if (!event.isPrimary || event.button !== 0) return; event.preventDefault(); strike(); });
window.addEventListener("keydown", (event) => {
  if (element("game-screen").classList.contains("is-hidden")) return;
  if (event.target instanceof Element && event.target.closest("input, textarea, select, button, [role=dialog], [contenteditable=true]")) return;
  if (event.code === "Space") { event.preventDefault(); if (!event.repeat) { if (scene.phase === "ready") void begin(); else strike(); } }
  if (event.code === "KeyP" && !event.repeat) { event.preventDefault(); void togglePause(); }
  if (event.code === "KeyR" && !event.repeat) reset(); // Replayed only after the platform credit gate approves.
});
document.addEventListener("visibilitychange", () => { if (document.hidden && scene.phase === "playing") void togglePause(); });
window.addEventListener("blur", () => { if (scene.phase === "playing") void togglePause(); });
volume.addEventListener("input", () => audio?.setVolume(Number(volume.value) / 100));
offset.addEventListener("input", () => {
  element("mochi-offset-value").textContent = `${offset.value} ms`;
  try { localStorage.setItem("mochi-beat-offset", offset.value); } catch { /* Optional preference. */ }
});
element(preview ? "mochi-preview-retry" : "ranking-retry").addEventListener("click", reset);
window.addEventListener("platform-play-approved", ((event: CustomEvent<{ gameId: string }>) => { if (event.detail?.gameId === MOCHI_BEAT.id) reset(); }) as EventListener);
window.addEventListener("create-solo-cabinet", ((event: CustomEvent<{ gameId: string }>) => { if (event.detail?.gameId === MOCHI_BEAT.id) element("start-solo").click(); }) as EventListener);
for (const id of ["back-to-arcade", "cabinet-breadcrumb-arcade", "game-back-to-arcade", "ranking-another-game"]) element(id)?.addEventListener("click", () => { audio?.stop(); window.location.assign("/"); });
// The arcade directory uses history navigation; a full navigation disposes this audio/runtime.
window.addEventListener("popstate", () => { audio?.stop(); window.location.reload(); });

function frame() {
  if (!element("game-screen").classList.contains("is-hidden")) {
    if (scene.phase === "playing" && audio) {
      scene.seconds = audio.seconds;
      audio.schedule();
      if (missExpired(scene.run, scene.seconds - Number(offset.value) / 1000)) { scene.feedback = "つぎ、いこう！"; scene.feedbackAt = scene.seconds; }
      const section = Math.floor(Math.max(0, scene.seconds / BEAT_SECONDS) / 4);
      if (section !== lastSection) {
        lastSection = section;
        const beat = scene.seconds / BEAT_SECONDS;
        status.textContent = beat < COUNT_IN ? "リズムにのろう！" : `ステージ ${Math.floor(roundAt(beat) / 4) + 1}。${section % 2 ? "お手本をきこう" : "あなたの番！"}`;
      }
      if (scene.seconds >= TOTAL_BEATS * BEAT_SECONDS + .3) finish();
    }
    drawScene(ctx, scene);
  }
  requestAnimationFrame(frame);
}
pause.disabled = true;
showScreen(window.location.pathname.startsWith("/cabinets/") ? "cabinet" : "arcade");
if (preview) reset();
void loadRanking();
requestAnimationFrame(frame);
