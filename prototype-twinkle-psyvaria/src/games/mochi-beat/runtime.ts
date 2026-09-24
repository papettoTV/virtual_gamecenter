import { notifications } from "../../features/notifications/notifications";
import { MOCHI_BEAT } from "../../domain/game";
import { fetchScoreRanking, submitRankingEntry, loadRankingWithNotice } from "../../features/ranking/ranking-client";
import { BEAT_SECONDS, COUNT_IN, TOTAL_BEATS, hit, missExpired, roundAt, COMPLETION_SECONDS, advanceCompletion, createSession, advanceSet, completeSet, sessionResult, SET_BPMS, SESSION_SECONDS } from "./core";
import { MochiAudio } from "./audio";
import { drawScene, type Scene } from "./render";
import { drawFinishedMochi, mochiFinish } from "./mochi";

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
function newScene(): Scene {
  const session = createSession();
  return { seconds: 0, session, run: session.runs[0]!, phase: "ready", feedback: "", feedbackAt: -10, tappedAt: -10, tapJudgment: null };
}
let scene = newScene();
const setIntro = element("mochi-set-intro");
const nextSetButton = element<HTMLButtonElement>("mochi-next-set");
function setSeconds() { return TOTAL_BEATS * scene.run.beatSeconds; }
let submitting = false;
let submitted = false;
let transition = false;
let lastSection = -1;
let runId = 0;
let completionElapsed = 0;
let lastFrameTime = performance.now();

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
  completionElapsed = 0;
  audio?.stop();
  scene = newScene();
  setIntro.hidden = true;
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
  if (!["ready", "setBreak"].includes(scene.phase) || transition) return;
  transition = true; start.disabled = true; nextSetButton.disabled = true;
  if (scene.phase === "setBreak" && advanceSet(scene.session)) scene.run = scene.session.runs[scene.session.setIndex]!;
  try {
    audio ??= new MochiAudio(Number(volume.value) / 100);
    await audio.start(scene.run.beatSeconds);
    notifications.dismiss("game-audio");
    scene.seconds = 0; scene.tappedAt = -10; scene.feedbackAt = -10; scene.tapJudgment = null; lastSection = -1;
    setIntro.hidden = true;
    intro.hidden = true; scene.phase = "playing";
    offset.disabled = true; tap.disabled = false; pause.disabled = false;
  } catch {
    notifications.show({ id: "game-audio", scope: MOCHI_BEAT.id, type: "error", message: "音を開始できませんでした。", action: { label: "再試行", run: begin } });
    start.disabled = false; nextSetButton.disabled = false;

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
      await audio.resume(); notifications.dismiss("game-audio"); scene.phase = "playing"; tap.disabled = false;
      pause.textContent = "一時停止"; lastSection = -1;
    }
  } catch { notifications.show({ id: "game-audio", scope: MOCHI_BEAT.id, type: "error", message: "音を再開できませんでした。", action: { label: "再試行", run: togglePause } }); }
  finally { transition = false; }
}

function strike() {
  if (scene.phase !== "playing" || !audio) return;
  const seconds = audio.seconds;
  if (seconds >= setSeconds()) return;
  const judgment = hit(scene.run, seconds - Number(offset.value) / 1000);
  scene.tappedAt = seconds;
  scene.tapJudgment = judgment?.judgment ?? null;
  audio.thump(judgment?.judgment !== "miss");
  if (!judgment) return;
  scene.feedback = judgment.judgment === "perfect" ? "ぴったり！" : judgment.judgment === "good" ? (judgment.error! < 0 ? "おしい！ はやめ" : "おしい！ おそめ") : "おっと、お休み！";
  scene.feedbackAt = seconds;
}

function complete() {
  scene.seconds = setSeconds();
  audio?.stop();
  missExpired(scene.run, setSeconds() - Number(offset.value) / 1000);
  if (!completeSet(scene.session)) {
    scene.phase = "setBreak";
    setIntro.hidden = false;
    nextSetButton.disabled = false;
    tap.disabled = true; pause.disabled = true;
    const next = scene.session.setIndex + 1;
    element("mochi-next-title").textContent = `セット${next + 1}をはじめよう`;
    element("mochi-next-summary").textContent = `セット${next}完了！ 累計スコア ${sessionResult(scene.session).score.toLocaleString()}`;
    element("mochi-next-tempo").textContent = next === 1 ? "次は、もっと速くなるよ！" : "最後は、さらに速くなるよ！";
    element("mochi-next-error").textContent = "";
    status.textContent = `セット${next}完了。スペースか開始ボタンでセット${next + 1}へ。`;
    return;
  }
  scene.phase = "completing";
  completionElapsed = 0;
  lastFrameTime = performance.now();
  tap.disabled = true; pause.disabled = true;
  status.textContent = `おもち、完成！${mochiFinish(sessionResult(scene.session).score).title}。まもなく成績を表示します。`;
}

function finish() {
  scene.phase = "result"; audio?.stop();
  tap.disabled = true; pause.disabled = true;
  const stats = sessionResult(scene.session);
  const finish = mochiFinish(stats.score);
  const art = element<HTMLCanvasElement>("mochi-result-art");
  drawFinishedMochi(art.getContext("2d")!, finish.kind);
  art.setAttribute("aria-label", `${finish.title}。${finish.description}`);
  element("mochi-finish-title").textContent = finish.title;
  element("mochi-finish-description").textContent = finish.description;
  element("ranking-submit-heading").textContent = `ゲームクリア！ ${stats.grade}`;
  element("ranking-result").textContent = `SCORE ${stats.score.toLocaleString()} / ぴったり ${stats.perfect}・おしい ${stats.good}・ミス ${stats.miss} / 余分なタップ ${stats.extras} / 最大 ${stats.maxCombo} コンボ`;
  status.textContent = `${finish.title}。${stats.grade} スコア ${stats.score.toLocaleString()}。`;
  panel.classList.add("is-visible");
  submit.disabled = preview;
  if (preview) element("ranking-result").textContent += " / 開発プレビュー（ランキング登録なし）";
  void loadRanking();
}

async function loadRanking() {
  await loadRankingWithNotice(MOCHI_BEAT.id, async () => {
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
  });
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
    await submitRankingEntry({ gameId: MOCHI_BEAT.id, elapsedTimeMs: Math.round(SESSION_SECONDS * 1000), cleared: scene.session.completedSets === SET_BPMS.length, score: sessionResult(scene.session).score, maxLevel: 9, defeatedBossCount: 0, clientVersion: MOCHI_BEAT.currentVersion });
    if (currentRun !== runId) return;
    submitted = true; panel.classList.add("is-submitted");
    element("ranking-submit-heading").textContent = "スコアを登録しました";
    await loadRanking();
  } catch {
    if (currentRun !== runId) return;

    submit.disabled = false;
  } finally { if (currentRun === runId) submitting = false; }
});

start.addEventListener("click", () => void begin());
nextSetButton.addEventListener("click", () => void begin());
pause.addEventListener("click", () => void togglePause());
tap.addEventListener("pointerdown", (event) => { if (!event.isPrimary || event.button !== 0) return; event.preventDefault(); strike(); });
// Keyboard and assistive-technology activation of the native button.
tap.addEventListener("click", (event) => { if (event.detail === 0) strike(); });
canvas.addEventListener("pointerdown", (event) => { if (!event.isPrimary || event.button !== 0) return; event.preventDefault(); strike(); });
window.addEventListener("keydown", (event) => {
  if (element("game-screen").classList.contains("is-hidden")) return;
  if (event.target instanceof Element && event.target.closest("input, textarea, select, button, [role=dialog], [contenteditable=true]")) return;
  if (event.code === "Space") { event.preventDefault(); if (!event.repeat) { if (scene.phase === "ready" || scene.phase === "setBreak") void begin(); else strike(); } }
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

function frame(now: number) {
  const delta = (now - lastFrameTime) / 1000;
  lastFrameTime = now;
  if (!element("game-screen").classList.contains("is-hidden")) {
    if (scene.phase === "playing" && audio) {
      scene.seconds = Math.min(audio.seconds, setSeconds());
      audio.schedule();
      if (missExpired(scene.run, scene.seconds - Number(offset.value) / 1000)) { scene.feedback = "つぎ、いこう！"; scene.feedbackAt = scene.seconds; }
      const section = Math.min(TOTAL_BEATS / 4 - 1, Math.floor(Math.max(0, scene.seconds / scene.run.beatSeconds) / 4));
      if (section !== lastSection) {
        lastSection = section;
        const beat = scene.seconds / scene.run.beatSeconds;
        status.textContent = beat < COUNT_IN ? "リズムにのろう！" : `セット${scene.session.setIndex + 1}、ステージ ${Math.floor(roundAt(beat) / 4) + 1}。${section % 2 ? "お手本をきこう" : "あなたの番！"}`;
      }
      if (scene.seconds >= setSeconds()) complete();
    }
    else if (scene.phase === "completing") {
      completionElapsed = advanceCompletion(completionElapsed, delta, !document.hidden);
      if (completionElapsed >= COMPLETION_SECONDS) finish();
    }
    drawScene(ctx, scene);
  }
  requestAnimationFrame(frame);
}
pause.disabled = true;
showScreen(window.location.pathname.startsWith("/cabinets/") ? "cabinet" : "arcade");
if (preview) {
  reset();
  // Development-only art review; never submits a fabricated result.
  const finishPreview = new URLSearchParams(window.location.search).get("mochiResult");
  if (["excellent", "standard", "poor"].includes(finishPreview ?? "")) {
    for (const note of scene.session.runs.flatMap((run) => run.notes)) note.judgment = finishPreview === "excellent" ? "perfect" : finishPreview === "standard" ? "good" : "miss";
    scene.session.setIndex = 2; scene.session.completedSets = 2; scene.run = scene.session.runs[2]!;
    scene.run.combo = scene.run.maxCombo = finishPreview === "poor" ? 0 : scene.run.notes.length * 3;
    scene.seconds = setSeconds();
    intro.hidden = true;
    complete();
  }
  const setEndPreview = new URLSearchParams(window.location.search).get("mochiSetEnd");
  if (!finishPreview && (setEndPreview === "1" || setEndPreview === "2")) {
    scene.session.setIndex = Number(setEndPreview) - 1;
    scene.session.completedSets = scene.session.setIndex;
    scene.run = scene.session.runs[scene.session.setIndex]!;
    intro.hidden = true;
    complete();
  }
  const hitPreview = new URLSearchParams(window.location.search).get("mochiHit");
  if (!finishPreview && (hitPreview === "perfect" || hitPreview === "good" || hitPreview === "miss")) {
    intro.hidden = true;
    scene.seconds = 8 * BEAT_SECONDS + .09;
    scene.tappedAt = 8 * BEAT_SECONDS;
    scene.tapJudgment = hitPreview;
    status.textContent = "開発用：もちの反応の静止表示";
  }
}
void loadRanking();
requestAnimationFrame(frame);
