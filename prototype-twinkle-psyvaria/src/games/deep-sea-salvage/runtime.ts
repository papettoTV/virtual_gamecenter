import { DEEP_SEA_SALVAGE } from "../../domain/game";
import { fetchScoreRanking, submitRankingEntry } from "../../features/ranking/ranking-client";
import {
  BASE_POWER_DRAIN,
  FISH_PATTERNS,
  type FishPattern,
  BOSS_BODY_RADIUS_X,
  BOSS_BODY_RADIUS_Y,
  BOSS_TAIL,
  MAX_HULL,
  canFishCollide,
  damageHull,
  getFishSafetyVisual,
  isBossBodyColliding,
  isBossBodyResearchable,
  getFishSpawnMultiplier,
  getBossWobbleDepth,
  calculateFinalScore,
  crossedBossDepth,
  DEFAULT_BOSS_INTERVAL,
  DEFAULT_BOSS_START_DEPTH,
  getResearchRewardMultiplier,
  getRetryScoreMultiplier,
  getCurrentStrength,
  getPowerDrainMultiplier,
  getRareSpawnRate,
  getSeaLayer,
  getRegularFishSpawnCount,
  getSubmarinePitch,
  getSubmarineHeadingTarget,
  getSubmarineLightLevel,
  NORMAL_RESEARCH_RANGE,
  type SeaLayer,
} from "./core";
import { circleHitsTerrainWall, findTerrainRecesses, loadTerrainCourse, terrainWallSegments, terrainWidthsAt, type TerrainCourse } from "./terrain";
import { initTerrainEditor } from "./terrain-editor";
import type { DeepSeaThreeLayer, ThreeFrame } from "./three-game-layer";

type Phase = "ready" | "dive" | "hull-break" | "boss-clear" | "result";
type Species = {
  id: keyof typeof FISH_PATTERNS; name: string; layer: SeaLayer; rare?: boolean; boss?: boolean;
  color: string; glow: string; speed: number; research: number; score: number; power: number; shape: number;
};
type Fish = {
  id: number; speciesId: Species["id"]; x: number; depth: number; vx: number; baseDepth: number;
  phase: number; research: number; completed: boolean; flash: number; completionEffect: number;
  pattern: FishPattern; activated: boolean; alertTimer: number; inHollow: boolean; homeX: number;
};
type BossPass = {
  active: boolean; x: number; depth: number; baseDepth: number; direction: 1 | -1; flash: number;
  wobbleAmplitude: number; wobbleFrequency: number; wobblePhase: number;
};
type HazardKind = "rock" | "kelp" | "vent";
type Hazard = {
  id: number; kind: HazardKind; x: number; depth: number; width: number; height: number;
  phase: number; dangerous: boolean; side?: -1 | 1; hollowDepth?: number; hollowHeight?: number;
  topWidth?: number; bottomWidth?: number;
};

const SPECIES: Species[] = [
  { id: "sun-sardine", name: "ヒカリイワシ", layer: 1, color: "#73d8e6", glow: "#adffff", speed: 32, research: 2.4, score: 420, power: 2.2, shape: 0 },
  { id: "glass-bream", name: "ガラスダイ", layer: 1, color: "#9fd3bd", glow: "#d9fff0", speed: 27, research: 2.7, score: 460, power: 2.2, shape: 1 },
  { id: "ribbon-goby", name: "リボンハゼ", layer: 1, color: "#e7bd7c", glow: "#ffe5a8", speed: 36, research: 2.8, score: 500, power: 2.4, shape: 2 },
  { id: "blue-puffer", name: "アオフグ", layer: 1, color: "#7ca9ec", glow: "#bcd7ff", speed: 23, research: 3, score: 540, power: 2.5, shape: 3 },
  { id: "coral-ray", name: "サンゴエイ", layer: 1, color: "#d68fad", glow: "#ffc5dc", speed: 30, research: 3.2, score: 580, power: 2.6, shape: 4 },
  { id: "silver-hatchet", name: "ギンオノウオ", layer: 2, color: "#7ea4bd", glow: "#bde7ff", speed: 48, research: 4, score: 760, power: 3, shape: 1 },
  { id: "lantern-cod", name: "ランタンタラ", layer: 2, color: "#6b8bb4", glow: "#8ffff5", speed: 52, research: 4.4, score: 820, power: 3.2, shape: 0 },
  { id: "veil-squid", name: "ベールイカ", layer: 2, color: "#a274be", glow: "#f0bdff", speed: 55, research: 4.8, score: 880, power: 3.3, shape: 5 },
  { id: "saw-shrimp", name: "ノコギリエビ", layer: 2, color: "#bc755e", glow: "#ffb191", speed: 58, research: 5, score: 940, power: 3.5, shape: 2 },
  { id: "moon-jelly", name: "ツキクラゲ", layer: 2, color: "#657fd0", glow: "#8eeaff", speed: 42, research: 5.2, score: 1_000, power: 3.6, shape: 5 },
  { id: "abyss-eel", name: "アビスウナギ", layer: 3, color: "#27345f", glow: "#5ffff0", speed: 78, research: 6, score: 1_180, power: 4, shape: 2 },
  { id: "black-fang", name: "クロキバウオ", layer: 3, color: "#382e4e", glow: "#ff5f91", speed: 88, research: 6.5, score: 1_280, power: 4.2, shape: 0 },
  { id: "ghost-squid", name: "ユウレイイカ", layer: 3, color: "#55446e", glow: "#bd88ff", speed: 82, research: 7, score: 1_380, power: 4.4, shape: 5 },
  { id: "star-mouth", name: "ホシグチ", layer: 3, color: "#253e51", glow: "#ffe66d", speed: 92, research: 7.4, score: 1_480, power: 4.6, shape: 3 },
  { id: "deep-ray", name: "シンカイエイ", layer: 3, color: "#26374a", glow: "#59aaff", speed: 76, research: 7.8, score: 1_580, power: 4.8, shape: 4 },
  { id: "prism-fish", name: "プリズムフィッシュ", layer: 2, rare: true, color: "#e7f4ff", glow: "#74fff5", speed: 105, research: 10, score: 4_200, power: 7, shape: 0 },
  { id: "crown-jelly", name: "オウカンクラゲ", layer: 2, rare: true, color: "#e5b5ff", glow: "#ffde69", speed: 98, research: 11, score: 4_500, power: 7, shape: 5 },
  { id: "comet-eel", name: "スイセイウナギ", layer: 3, rare: true, color: "#c4dbff", glow: "#68a8ff", speed: 125, research: 11.5, score: 4_800, power: 7.5, shape: 2 },
  { id: "ruby-angler", name: "ルビーアンコウ", layer: 3, rare: true, color: "#a32f56", glow: "#ff466f", speed: 118, research: 12, score: 5_100, power: 8, shape: 3 },
  { id: "void-manta", name: "ヴォイドマンタ", layer: 3, rare: true, color: "#1e244b", glow: "#bb73ff", speed: 112, research: 13, score: 5_500, power: 8.5, shape: 4 },
  { id: "leviathan", name: "リヴァイアサン", layer: 3, boss: true, color: "#172842", glow: "#ffce59", speed: 0, research: 100, score: 12_000, power: 0, shape: 6 },
];
const speciesIcons = new Map<string, HTMLImageElement>(SPECIES.map((species) => {
  const image = new Image(); image.decoding = "async";
  image.src = `/assets/deep-sea-salvage/encyclopedia/${species.id}.png`;
  return [species.id, image];
}));
const speciesById = new Map<string, Species>(SPECIES.map((species) => [species.id, species]));
const regularByLayer = new Map<SeaLayer, Species[]>([1, 2, 3].map((layer) => [layer as SeaLayer, SPECIES.filter((s) => s.layer === layer && !s.rare && !s.boss)]));
const rareSpecies = SPECIES.filter((species) => species.rare);

const canvas = document.querySelector<HTMLCanvasElement>("#game")!;
const ctx = canvas.getContext("2d")!;
const W = canvas.width;
const H = canvas.height;
const SUB_Y = H * .57;
const CHUNK_DEPTH = 400;
const darknessCanvas = document.createElement("canvas");
darknessCanvas.width = W; darknessCanvas.height = H;
const darknessCtx = darknessCanvas.getContext("2d")!;

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
const rankingRetry = document.querySelector<HTMLButtonElement>("#ranking-retry");
const touchPause = document.querySelector<HTMLButtonElement>("#touch-pause");
const touchCollection = document.querySelector<HTMLButtonElement>("#touch-collection");
const shareResultButton = document.querySelector<HTMLButtonElement>("#salvage-share-result");
const resultCollectionButton = document.querySelector<HTMLButtonElement>("#salvage-result-collection");
const shareMenu = document.querySelector<HTMLElement>("#salvage-share-menu");
const shareNativeButton = document.querySelector<HTMLButtonElement>("#salvage-share-native");
const shareXButton = document.querySelector<HTMLButtonElement>("#salvage-share-x");
const shareLineButton = document.querySelector<HTMLButtonElement>("#salvage-share-line");
const shareBlueskyButton = document.querySelector<HTMLButtonElement>("#salvage-share-bluesky");
const shareSaveButton = document.querySelector<HTMLButtonElement>("#salvage-share-save");
const shareCopyButton = document.querySelector<HTMLButtonElement>("#salvage-share-copy");
const startSoloButton = document.querySelector<HTMLButtonElement>("#start-solo");

const keys = new Set<string>();
const pointer = { active: false, x: 0, y: 0 };
const debugParams = import.meta.env.DEV ? new URLSearchParams(window.location.search) : new URLSearchParams();
const debugNumber = (name: string, fallback: number) => {
  if (!debugParams.has(name)) return fallback;
  const value = Number(debugParams.get(name));
  return Number.isFinite(value) ? value : fallback;
};
const config = {
  initialPower: debugNumber("power", 100),
  powerDrain: debugNumber("powerDrain", BASE_POWER_DRAIN),
  rareRate2: debugNumber("rareRate2", .001),
  rareRate3: debugNumber("rareRate3", .01),
  researchScale: debugNumber("researchScale", 1),
  bossStart: debugNumber("bossStart", DEFAULT_BOSS_START_DEPTH),
  bossInterval: debugNumber("bossInterval", DEFAULT_BOSS_INTERVAL),
};

let threeLayer: DeepSeaThreeLayer | null = null;
const threeRendererEnabled = debugParams.get("renderer") !== "2d" && debugParams.get("threeGame") !== "0";
if (threeRendererEnabled) {
  void import("./three-game-layer")
    .then(({ DeepSeaThreeLayer }) => DeepSeaThreeLayer.create())
    .then((layer) => { threeLayer = layer; })
    .catch((error: unknown) => { console.warn("Three.js gameplay layer unavailable; using the 2D renderer.", error); });
}

let phase: Phase = "ready";
let paused = true;
let collectionOpen = false;
let returnToResult = false;
let lastTime = performance.now();
let elapsed = 0;
let subX = W / 2;
let subDepth = 0;
let maxDepth = 0;
let subVx = 0;
let subVDepth = 0;
let subHeading = 0;
let subHeadingTarget = 0;
let invincible = 0;
let hull = MAX_HULL;
let power = 100;
let earnedScore = 0;
let finalScore = 0;
let finalSubtotal = 0;
let cleared = false;
let retryCount = 0;
let nextFishId = 1;
let nextHazardId = 1;
let nextBossDepth = 4_000;
let bossProgress = 0;
let boss: BossPass = { active: false, x: 0, depth: 0, baseDepth: 0, direction: 1, flash: 0, wobbleAmplitude: 0, wobbleFrequency: 0, wobblePhase: 0 };
let bossClearTimer = 0;
let hullBreakTimer = 0;
let hullBreakTitle = "船体が大破した";
let bossGaugeVisible = false;
let fishes: Fish[] = [];
let hazards: Hazard[] = [];
let terrainCourse: TerrainCourse = loadTerrainCourse();
let targetFishIds = new Set<number>();
let visitedChunks = new Set<number>();
let discovered = new Set<string>();
let researchCounts = new Map<string, number>();
let message = "P / 画面下のボタンで潜航開始";
let messageTimer = 99;
let hazardMessageCooldown = 0;

function showScreen(screen: "arcade" | "cabinet" | "game") {
  document.body.classList.toggle("is-game-screen", screen === "game");
  arcadeScreen?.classList.toggle("is-hidden", screen !== "arcade");
  cabinetScreen?.classList.toggle("is-hidden", screen !== "cabinet");
  gameScreen?.classList.toggle("is-hidden", screen !== "game");
}

function resetRun() {
  phase = "ready"; paused = true; collectionOpen = false; returnToResult = false;
  elapsed = 0; subX = W / 2; subDepth = Math.max(0, debugNumber("startDepth", 0)); maxDepth = subDepth;
  subVx = 0; subVDepth = 0; subHeading = 0; subHeadingTarget = 0; invincible = 0;
  hull = clamp(Math.round(debugNumber("hull", MAX_HULL)), 1, MAX_HULL); power = config.initialPower;
  earnedScore = 0; finalScore = 0; finalSubtotal = 0; cleared = false; retryCount = 0;
  nextFishId = 1; nextHazardId = 1; nextBossDepth = Math.max(config.bossStart, subDepth + 200); bossProgress = debugNumber("bossProgress", 0);
  boss = { active: false, x: 0, depth: 0, baseDepth: 0, direction: 1, flash: 0, wobbleAmplitude: 0, wobbleFrequency: 0, wobblePhase: 0 }; bossClearTimer = 0; hullBreakTimer = 0; bossGaugeVisible = false;
  fishes = []; terrainCourse = loadTerrainCourse(); hazards = buildTerrainHazards(terrainCourse); targetFishIds = new Set(); visitedChunks = new Set(); discovered = new Set(); researchCounts = new Map(); hazardMessageCooldown = 0;
  if (debugParams.get("terrainPreview") === "1") {
    const widths = terrainWidthsAt(terrainCourse, subDepth);
    subX = (widths.left + W - widths.right) / 2;
  }
  rankingPanel?.classList.remove("is-visible", "is-submitted");
  if (shareMenu) shareMenu.hidden = true;
  shareResultButton?.setAttribute("aria-expanded", "false");
  ensureChunks(); setMessage("P / 画面下のボタンで潜航開始", 99); updateButtons();
  if (debugParams.get("terrainPreview") === "1") setMessage("地形確認（明るく表示） / Pで通常の潜航開始 / 岩壁エディタで編集へ戻る", 99);
}

function startDive() {
  if (phase === "result") return;
  phase = "dive"; paused = false; setMessage("魚を調査して電力をつなぎ、深海へ潜れ", 3); updateButtons();
}

function ensureChunks() {
  if (boss.active) return;
  const center = Math.floor(subDepth / CHUNK_DEPTH);
  for (let chunk = Math.max(0, center - 2); chunk <= center + 3; chunk += 1) {
    if (visitedChunks.has(chunk)) continue;
    visitedChunks.add(chunk); spawnChunk(chunk);
  }
  fishes = fishes.filter((fish) => Math.abs(fish.depth - subDepth) < 2_400);
}

function spawnChunk(chunk: number) {
  const baseDepth = chunk * CHUNK_DEPTH;
  const layer = getSeaLayer(baseDepth + CHUNK_DEPTH / 2);
  const chunkHazards = hazards.filter((hazard) => Math.abs(hazard.depth - (baseDepth + CHUNK_DEPTH / 2)) <= CHUNK_DEPTH);
  const regular = regularByLayer.get(layer)!;
  const count = getRegularFishSpawnCount(Math.random());
  const spawnMultiplier = getFishSpawnMultiplier(baseDepth + CHUNK_DEPTH / 2, config.bossStart, config.bossInterval);
  for (let i = 0; i < count; i += 1) {
    if (spawnMultiplier < 1 && Math.random() >= spawnMultiplier) continue;
    spawnFish(regular[Math.floor(Math.random() * regular.length)]!, baseDepth + 45 + Math.random() * (CHUNK_DEPTH - 90));
  }
  const baseRareRate = layer === 2 ? config.rareRate2 : layer === 3 ? config.rareRate3 : 0;
  const dangerousZone = chunkHazards.some((hazard) => hazard.dangerous);
  const rareRate = getRareSpawnRate(baseRareRate, dangerousZone) * spawnMultiplier;
  if (Math.random() < rareRate) {
    const candidates = rareSpecies.filter((species) => species.layer <= layer);
    const dangerousHazard = chunkHazards.find((hazard) => hazard.hollowDepth !== undefined)
      ?? chunkHazards.find((hazard) => hazard.dangerous);
    spawnFish(
      candidates[Math.floor(Math.random() * candidates.length)]!,
      dangerousHazard?.hollowDepth ?? (dangerousHazard ? dangerousHazard.depth - 70 : baseDepth + 80 + Math.random() * (CHUNK_DEPTH - 160)),
      dangerousHazard ? dangerSpawnX(dangerousHazard) : undefined,
      dangerousHazard?.hollowDepth !== undefined,
    );
  }
}

function dangerSpawnX(hazard: Hazard) {
  if (hazard.kind !== "rock") return hazard.x;
  const widths = terrainWidthsAt(terrainCourse, hazard.hollowDepth ?? hazard.depth);
  return hazard.side === -1 ? widths.left + 42 : W - widths.right - 42;
}

function buildTerrainHazards(course: TerrainCourse): Hazard[] {
  const built: Hazard[] = [];
  const recesses = findTerrainRecesses(course);
  for (const [segmentIndex, { from, to }] of terrainWallSegments(course).entries()) {
    const index = segmentIndex + 1;
    const depth = (from.depth + to.depth) / 2; const height = to.depth - from.depth;
    const leftWidth = (from.left + to.left) / 2; const rightWidth = (from.right + to.right) / 2;
    const leftRecess = recesses.find((recess) => recess.side === "left" && recess.depth > from.depth && recess.depth <= to.depth);
    const rightRecess = recesses.find((recess) => recess.side === "right" && recess.depth > from.depth && recess.depth <= to.depth);
    built.push({ id: nextHazardId++, kind: "rock", x: 0, depth, width: leftWidth, height, topWidth: from.left, bottomWidth: to.left, phase: index * .73, dangerous: Boolean(leftRecess), side: -1, hollowDepth: leftRecess?.depth, hollowHeight: leftRecess ? 108 : undefined });
    built.push({ id: nextHazardId++, kind: "rock", x: W - rightWidth, depth, width: rightWidth, height, topWidth: from.right, bottomWidth: to.right, phase: index * .61, dangerous: Boolean(rightRecess), side: 1, hollowDepth: rightRecess?.depth, hollowHeight: rightRecess ? 108 : undefined });
  }
  for (const feature of course.features) {
    const widths = terrainWidthsAt(course, feature.depth); const side: -1 | 1 = feature.side === "left" ? -1 : 1;
    if (feature.kind === "vent") {
      built.push({ id: nextHazardId++, kind: "vent", x: side === -1 ? widths.left - 16 : W - widths.right + 16, depth: feature.depth, width: 82, height: 175, phase: feature.depth * .013, dangerous: true, side });
    } else {
      const width = 72;
      built.push({ id: nextHazardId++, kind: "kelp", x: side === -1 ? widths.left - width * .55 : W - widths.right - width * .45, depth: feature.depth, width, height: 165, phase: feature.depth * .009, dangerous: false, side });
    }
  }
  return built;
}

function spawnFish(species: Species, depth: number, preferredX?: number, inHollow = false) {
  const [corridorLeft, corridorRight] = corridorBounds(depth);
  let x = preferredX === undefined
    ? corridorLeft + Math.random() * Math.max(1, corridorRight - corridorLeft)
    : preferredX + (Math.random() - .5) * (inHollow ? 52 : 130);
  x = inHollow ? clamp(x, 35, W - 35) : clamp(x, corridorLeft, corridorRight);
  if (!inHollow && Math.abs(depth - subDepth) < 180 && Math.abs(x - subX) < 220) x = x < subX ? corridorLeft : corridorRight;
  const direction = Math.random() < .5 ? -1 : 1;
  fishes.push({
    id: nextFishId++, speciesId: species.id, x, depth, baseDepth: depth,
    vx: direction * species.speed * (.72 + Math.random() * .55), phase: Math.random() * Math.PI * 2,
    research: 0, completed: false, flash: 0, completionEffect: 0, pattern: FISH_PATTERNS[species.id], activated: false, alertTimer: 0, inHollow, homeX: x,
  });
}

function corridorBounds(depth: number): [number, number] {
  const walls = hazards.filter((hazard) => hazard.kind === "rock" && Math.abs(depth - hazard.depth) <= hazard.height / 2);
  const leftWall = walls.find((hazard) => hazard.side === -1);
  const rightWall = walls.find((hazard) => hazard.side === 1);
  const widths = terrainWidthsAt(terrainCourse, depth);
  return [leftWall ? widths.left + 42 : 75, rightWall ? W - widths.right - 42 : W - 75];
}

function update(dt: number) {
  messageTimer = Math.max(0, messageTimer - dt);
  if (phase === "boss-clear") { updateBossClear(dt); return; }
  if (phase === "hull-break") { updateHullBreak(dt); return; }
  if (paused || collectionOpen || phase !== "dive") return;
  elapsed += dt; invincible = Math.max(0, invincible - dt); hazardMessageCooldown = Math.max(0, hazardMessageCooldown - dt);
  power = Math.max(0, power - config.powerDrain * getPowerDrainMultiplier(subDepth) * dt);
  updateSubmarine(dt); ensureChunks(); updateHazards(dt); updateFishes(dt); updateBoss(dt); updateResearch(dt);
  maxDepth = Math.max(maxDepth, subDepth);
  if (crossedBossDepth(maxDepth, nextBossDepth, boss.active)) startBossPass();
  if (power <= 0) finish(false, "電力が尽きた");
}

function updateSubmarine(dt: number) {
  let dx = Number(keys.has("ArrowRight") || keys.has("KeyD")) - Number(keys.has("ArrowLeft") || keys.has("KeyA"));
  let dy = Number(keys.has("ArrowDown") || keys.has("KeyS")) - Number(keys.has("ArrowUp") || keys.has("KeyW"));
  if (pointer.active) { dx = (pointer.x - subX) / 90; dy = (pointer.y - SUB_Y) / 90; }
  const length = Math.hypot(dx, dy);
  if (length > 1) { dx /= length; dy /= length; }
  const currentX = getCurrentVelocity();
  const currentDepth = getCurrentStrength(subDepth) ? Math.cos(subDepth / 510 + elapsed * .31) * getCurrentStrength(subDepth) * .12 : 0;
  subVx += (dx * 225 + currentX - subVx) * Math.min(1, dt * 5);
  subVDepth += (dy * 92 + currentDepth - subVDepth) * Math.min(1, dt * 5);
  subHeadingTarget = getSubmarineHeadingTarget(dx, subHeadingTarget);
  subHeading += (subHeadingTarget - subHeading) * Math.min(1, dt * 4.2);
  const [leftBound, rightBound] = horizontalBounds();
  subX = clamp(subX + subVx * dt, leftBound, rightBound);
  subDepth = Math.max(0, subDepth + subVDepth * dt);
}

function getCurrentVelocity(depth = subDepth) {
  const strength = getCurrentStrength(depth);
  if (!strength) return 0;
  const flow = Math.sin(Math.floor(depth / 420) * 1.71 + elapsed * .22);
  return Math.sign(flow || 1) * strength * (.45 + Math.abs(flow) * .55);
}

function updateFishes(dt: number) {
  for (const fish of fishes) {
    const species = speciesById.get(fish.speciesId)!;
    fish.phase += dt * (species.rare ? 2.2 : .9);
    fish.flash = Math.max(0, fish.flash - dt);
    fish.completionEffect = Math.max(0, fish.completionEffect - dt);
    const currentDrift = getCurrentVelocity(fish.depth) * .28;
    if (fish.completed && fish.pattern === "ambush") {
      fish.activated = false; fish.alertTimer = 0;
      const leaveDirection = fish.x < subX ? -1 : 1;
      fish.vx += (leaveDirection * species.speed * 1.45 - fish.vx) * Math.min(1, dt * 3.2);
      fish.baseDepth += clamp(fish.baseDepth - subDepth, -1, 1) * species.speed * .18 * dt;
      fish.x += (fish.vx + currentDrift) * dt;
      fish.depth = fish.baseDepth + Math.sin(fish.phase) * 12;
    } else if (fish.pattern === "cruise") {
      fish.x += (fish.vx + currentDrift) * dt;
      fish.depth = fish.baseDepth + Math.sin(fish.phase) * 15;
    } else if (fish.pattern === "wave") {
      fish.x += (fish.vx * .82 + Math.sin(fish.phase * 1.45) * species.speed * .32 + currentDrift) * dt;
      fish.depth = fish.baseDepth + Math.sin(fish.phase * 1.7) * (fish.inHollow ? 34 : species.rare ? 62 : 42);
    } else if (fish.pattern === "dart") {
      const burst = .38 + Math.pow(Math.max(0, Math.sin(fish.phase * 1.3)), 3) * 2.2;
      fish.x += (fish.vx * burst + currentDrift) * dt;
      fish.depth = fish.baseDepth + Math.sin(fish.phase * .8) * 25;
    } else {
      const sy = screenY(fish.depth); const distance = Math.hypot(fish.x - subX, sy - SUB_Y);
      if (!fish.activated && distance < 265) {
        fish.alertTimer += dt; fish.flash = .08;
        if (fish.alertTimer >= .65) fish.activated = true;
      } else if (!fish.activated) fish.alertTimer = Math.max(0, fish.alertTimer - dt * .5);
      if (fish.activated) {
        const desiredDirection = subX < fish.x ? -1 : 1;
        fish.vx += (desiredDirection * species.speed * 1.18 - fish.vx) * Math.min(1, dt * 2.6);
        fish.baseDepth += clamp(subDepth - fish.baseDepth, -75, 75) * dt * .62;
        fish.x += (fish.vx + currentDrift) * dt;
        fish.depth = fish.baseDepth + Math.sin(fish.phase * 1.9) * 15;
      } else {
        fish.x += (fish.vx * .1 + currentDrift) * dt;
        fish.depth = fish.baseDepth + Math.sin(fish.phase * .65) * 7;
      }
    }
    const [fishLeft, fishRight] = fish.inHollow ? [fish.homeX - 48, fish.homeX + 48] : corridorBounds(fish.depth);
    if (!(fish.completed && fish.pattern === "ambush") && (fish.x < fishLeft || fish.x > fishRight)) { fish.vx *= -1; fish.x = clamp(fish.x, fishLeft, fishRight); }
    const sy = screenY(fish.depth);
    if (canFishCollide(fish.completed, invincible) && sy > 76 && sy < H - 35 && Math.hypot(fish.x - subX, sy - SUB_Y) < fishRadius(species) + 16) collide(fish.x);
  }
  fishes = fishes.filter((fish) => !(fish.completed && fish.pattern === "ambush" && (fish.x < -90 || fish.x > W + 90)));
}

function updateHazards(dt: number) {
  for (const hazard of hazards) {
    const sy = screenY(hazard.depth);
    if (sy < -hazard.height - 50 || sy > H + hazard.height + 50) continue;
    if (hazard.kind === "rock") {
      if (hitsRockWall(hazard, subX, SUB_Y, 18) && invincible <= 0) {
        collideHull("岩壁", hazard.x + hazard.width / 2);
      }
    } else if (hazard.kind === "kelp") {
      if (circleHitsRect(subX, SUB_Y, 16, hazard.x, sy - hazard.height, hazard.width, hazard.height)) {
        subVx *= Math.max(0, 1 - dt * 5); subVDepth *= Math.max(0, 1 - dt * 4); power = Math.max(0, power - dt * .7);
        if (hazardMessageCooldown <= 0) { setMessage("海藻に絡まった　推進力低下", 1.2); hazardMessageCooldown = 1.8; }
      }
    } else if (isVentActive(hazard)) {
      if (circleHitsRect(subX, SUB_Y, 17, hazard.x - hazard.width / 2, sy - hazard.height, hazard.width, hazard.height) && invincible <= 0) {
        collideVent(hazard);
      }
    }
  }
}

function hitsRockWall(hazard: Hazard, cx: number, cy: number, radius: number) {
  const sy = screenY(hazard.depth);
  return circleHitsTerrainWall(cx, cy, radius, hazard.side === -1 ? "left" : "right", sy - hazard.height / 2, sy + hazard.height / 2, hazard.topWidth ?? hazard.width, hazard.bottomWidth ?? hazard.width);
}

function collideHull(label: string, sourceX: number) {
  hull = damageHull(hull); invincible = 2.2; subDepth = Math.max(0, subDepth - 7); subVDepth = -78;
  subVx = subX < sourceX ? -155 : 155;
  if (hull <= 0) beginHullBreak("船体が大破した");
  else setMessage(`${label}に接触　船体損傷`, 1.7);
}

function collideVent(hazard: Hazard) {
  const loss = 18;
  power = Math.max(0, power - loss); invincible = 2.2; subDepth = Math.max(0, subDepth - 7); subVDepth = -78;
  subVx = subX < hazard.x ? -155 : 155;
  setMessage(`熱水噴出　電力 -${loss}%`, 1.7);
}

function circleHitsRect(cx: number, cy: number, radius: number, x: number, y: number, width: number, height: number) {
  const nearestX = clamp(cx, x, x + width); const nearestY = clamp(cy, y, y + height);
  return Math.hypot(cx - nearestX, cy - nearestY) < radius;
}

function isVentActive(hazard: Hazard) {
  return (elapsed + hazard.phase) % 4.8 < 2.25;
}

function collide(sourceX: number, label = "魚") {
  hull = damageHull(hull); invincible = 2.2; subVx = sourceX < subX ? 180 : -180; subVDepth = -80;
  if (hull <= 0) beginHullBreak("船体が大破した");
  else setMessage(`${label}と衝突　船体損傷`, 1.6);
}

function chooseResearchTargets(): Fish[] {
  return fishes.filter((fish) => {
    if (fish.completed) return false;
    const sy = screenY(fish.depth);
    return sy > 76 && sy < H - 35 && Math.hypot(fish.x - subX, sy - SUB_Y) <= NORMAL_RESEARCH_RANGE;
  });
}

function updateResearch(dt: number) {
  const targets = chooseResearchTargets();
  targetFishIds = new Set(targets.map((fish) => fish.id));
  for (const fish of fishes) {
    if (!fish.completed && !targetFishIds.has(fish.id)) fish.research = Math.max(0, fish.research - dt * .18);
  }
  for (const target of targets) {
    const species = speciesById.get(target.speciesId)!;
    const knownSpeed = discovered.has(species.id) ? .55 : 1;
    target.research += dt / (species.research * knownSpeed * config.researchScale);
    if (target.research >= 1) completeResearch(species, target);
  }
  updateBossResearch(dt);
}

function completeResearch(species: Species, fish: Fish) {
  const count = researchCounts.get(species.id) ?? 0;
  const multiplier = getResearchRewardMultiplier(count);
  const first = count === 0;
  researchCounts.set(species.id, count + 1); discovered.add(species.id);
  const gainedScore = Math.floor(species.score * multiplier) + (first ? 300 : 0);
  const gainedPower = species.power * multiplier;
  earnedScore += gainedScore; power = Math.min(100, power + gainedPower);
  fish.research = 1; fish.completed = true; fish.flash = .7; fish.completionEffect = 1.6; targetFishIds.delete(fish.id);
  setMessage(first ? `図鑑登録　${species.name}  +${gainedScore}` : gainedScore ? `${species.name} 再調査 +${gainedScore}` : `${species.name} 調査済み（報酬なし）`, 1.8);
}

function startBossPass() {
  targetFishIds.clear();
  const direction: 1 | -1 = Math.floor(nextBossDepth / config.bossInterval) % 2 ? 1 : -1;
  const baseDepth = nextBossDepth + 120;
  boss = {
    active: true, x: direction === 1 ? -340 : W + 340, depth: baseDepth, baseDepth, direction, flash: 0,
    wobbleAmplitude: 55 + Math.random() * 35,
    wobbleFrequency: .62 + Math.random() * .34,
    wobblePhase: Math.random() * Math.PI * 2,
  };
  bossGaugeVisible = false;
  nextBossDepth += config.bossInterval;
  setMessage("巨大反応接近　胴体・尾の近くでも調査できる", 3);
}

function updateBoss(dt: number) {
  if (!boss.active) return;
  boss.x += boss.direction * 102 * dt; boss.flash = Math.max(0, boss.flash - dt);
  boss.depth = getBossWobbleDepth(boss.baseDepth, elapsed, boss.wobbleAmplitude, boss.wobbleFrequency, boss.wobblePhase);
  const sy = screenY(boss.depth);
  if (sy > -170 && sy < H + 170 && isBossBodyColliding(subX, SUB_Y, 17, boss.x, sy, boss.direction) && invincible <= 0) {
    collide(boss.x, "巨大深海魚");
  }
  if ((boss.direction === 1 && boss.x > W + 470) || (boss.direction === -1 && boss.x < -470)) {
    boss.active = false; setMessage(`巨大魚を見失った　調査 ${Math.floor(bossProgress)}%`, 2);
  }
}

function updateBossResearch(dt: number) {
  if (!canResearchBoss()) return;
  bossGaugeVisible = true;
  bossProgress = Math.min(100, bossProgress + dt * 6.5 / config.researchScale); boss.flash = .15;
  if (bossProgress >= 100) beginBossClear();
}

function beginBossClear() {
  if (phase !== "dive") return;
  discovered.add("leviathan"); researchCounts.set("leviathan", 1);
  phase = "boss-clear"; paused = false; bossClearTimer = 0; boss.flash = 1;
  boss.x = W / 2; boss.depth = subDepth + 28;
  boss.baseDepth = boss.depth; boss.wobbleAmplitude = 0;
  subVx = 0; subVDepth = 0; targetFishIds.clear();
  setMessage("巨大深海魚の調査完了", 99); updateButtons();
}

function beginHullBreak(title: string) {
  if (phase !== "dive") return;
  phase = "hull-break"; paused = false; hullBreakTimer = 0; hullBreakTitle = title;
  invincible = 99; subVx = 0; subVDepth = 0; targetFishIds.clear();
  setMessage("", 0); updateButtons();
}

function updateHullBreak(dt: number) {
  hullBreakTimer += dt; elapsed += dt;
  if (hullBreakTimer >= 3) finish(false, hullBreakTitle);
}

function updateBossClear(dt: number) {
  bossClearTimer += dt;
  boss.flash = Math.max(0, boss.flash - dt);
  if (bossClearTimer >= 5.8) finish(true, "巨大深海魚の調査完了");
}

function canResearchBoss() {
  if (!boss.active) return false;
  return isBossBodyResearchable(subX, SUB_Y, boss.x, screenY(boss.depth), boss.direction, W, H);
}

function finish(wasCleared: boolean, title: string) {
  if (phase === "result") return;
  phase = "result"; paused = true; cleared = wasCleared;
  const score = calculateFinalScore({ earnedScore, cleared, remainingPower: power, retryCount });
  finalSubtotal = score.subtotal; finalScore = score.total;
  setMessage(title, 99); showResult(title, score.multiplier); updateButtons();
}

function showResult(title: string, multiplier: number) {
  const rareCount = [...discovered].filter((id) => speciesById.get(id)?.rare).length;
  if (rankingHeading) rankingHeading.textContent = "ランキング登録";
  if (shareMenu) shareMenu.hidden = true;
  shareResultButton?.setAttribute("aria-expanded", "false");
  if (rankingResult) rankingResult.textContent = `${title} / SCORE ${finalScore.toLocaleString()}（適用前 ${finalSubtotal.toLocaleString()}・倍率 ${(multiplier * 100).toFixed(0)}%） / 図鑑 ${discovered.size}/21 / レア ${rareCount}/5 / 最大 ${Math.floor(maxDepth).toLocaleString()}m`;
  rankingPanel?.classList.add("is-visible"); rankingPanel?.classList.remove("is-submitted");
  if (rankingSubmit) rankingSubmit.disabled = !rankingName?.value.trim() || finalScore <= 0;
  if (rankingRetry) rankingRetry.textContent = cleared ? "もう一度遊ぶ" : "1クレジットでリトライ";
}

function retryFromResult() {
  if (phase !== "result" || cleared) { resetRun(); startDive(); return; }
  retryCount += 1; bossProgress = 0; boss.active = false; bossGaugeVisible = false; power = Math.max(65, config.initialPower * .65);
  invincible = 3; hull = MAX_HULL; subX = findSafeRetryX(); subVx = 0; subVDepth = 0; subHeading = 0; subHeadingTarget = 0; targetFishIds = new Set();
  fishes = fishes.filter((fish) => Math.hypot(fish.x - subX, screenY(fish.depth) - SUB_Y) > 210);
  phase = "dive"; paused = false; cleared = false; finalScore = 0; finalSubtotal = 0;
  rankingPanel?.classList.remove("is-visible", "is-submitted");
  setMessage(`CONTINUE　最終スコア倍率 ${(getRetryScoreMultiplier(retryCount) * 100).toFixed(0)}%`, 3); updateButtons(); lastTime = performance.now();
}

function findSafeRetryX() {
  const [left, right] = horizontalBounds();
  const candidates = [W / 2, W / 2 - 110, W / 2 + 110, W / 2 - 220, W / 2 + 220].map((x) => clamp(x, left, right));
  return candidates.find((x) => !hazards.some((hazard) => {
    const sy = screenY(hazard.depth);
    if (hazard.kind === "rock") return hitsRockWall(hazard, x, SUB_Y, 38);
    if (hazard.kind === "kelp") return circleHitsRect(x, SUB_Y, 38, hazard.x, sy - hazard.height, hazard.width, hazard.height);
    return circleHitsRect(x, SUB_Y, 38, hazard.x - hazard.width / 2, sy - hazard.height, hazard.width, hazard.height);
  })) ?? W / 2;
}

function togglePause() {
  if (collectionOpen) { toggleCollection(); return; }
  if (phase === "ready") startDive(); else if (phase === "dive") paused = !paused;
  updateButtons();
}

function toggleCollection(force?: boolean) {
  if (phase === "hull-break") return;
  if (paused && phase === "dive" && force === undefined) return;
  const next = force ?? !collectionOpen;
  collectionOpen = next;
  if (next) {
    returnToResult = phase === "result";
    rankingPanel?.classList.remove("is-visible");
  } else if (returnToResult) rankingPanel?.classList.add("is-visible");
  updateButtons();
}

function updateButtons() {
  if (touchPause) {
    touchPause.textContent = phase === "ready" ? "潜航開始" : phase === "boss-clear" ? "調査完了" : phase === "hull-break" ? "大破" : paused ? "再開" : "一時停止";
    touchPause.disabled = phase === "boss-clear" || phase === "hull-break";
  }
  if (touchCollection) { touchCollection.textContent = collectionOpen ? "図鑑を閉じる" : "図鑑"; touchCollection.disabled = phase === "hull-break"; }
}

function draw() {
  drawBackground();
  const renderedInThree = drawThreeGameObjects();
  if (!renderedInThree) {
    for (const hazard of hazards) { const sy = screenY(hazard.depth); if (sy > -hazard.height - 50 && sy < H + hazard.height + 50) drawHazard(hazard, sy); }
    for (const fish of fishes) { const sy = screenY(fish.depth); if (sy > 62 && sy < H + 50) drawFish(fish, sy); }
    if (boss.active) drawBoss();
  } else drawThreeFishLabels();
  drawCurrentSignals(); drawDarkness(); drawHazardSignals(); drawDeepSignals(); drawFishSafetySignals(renderedInThree); drawBossSignal(renderedInThree);
  if (!renderedInThree) drawSubmarine(); else drawThreeSubmarineSignals();
  drawHud();
  if ((boss.active && bossGaugeVisible) || phase === "boss-clear") drawBossResearchGauge();
  if (phase === "ready" && debugParams.get("terrainPreview") !== "1") drawStartOverlay();
  if (paused && phase === "dive" && !collectionOpen) drawCollection("pause");
  if (phase === "result" && !collectionOpen) drawOverlay(message, [`SCORE ${finalScore.toLocaleString()}`, `図鑑 ${discovered.size} / 21　最大深度 ${Math.floor(maxDepth).toLocaleString()}m`]);
  if (phase === "boss-clear") drawBossClearSequence();
  if (phase === "hull-break") drawHullBreakSequence();
  if (collectionOpen) drawCollection();
}

function drawThreeGameObjects() {
  if (!threeLayer) return false;
  const breaking = phase === "hull-break";
  const submarineAlpha = breaking ? Math.max(0, 1 - hullBreakTimer / 1.35) : invincible > 0 && Math.floor(invincible * 10) % 2 ? .35 : 1;
  const visibleFishes = fishes.flatMap((fish) => {
    const y = screenY(fish.depth); if (y < 55 || y > H + 55) return [];
    const species = speciesById.get(fish.speciesId)!;
    const radius = fishRadius(species); const distance = Math.hypot(fish.x - subX, y - SUB_Y);
    const darkness = debugParams.get("terrainPreview") === "1" && phase === "ready" ? 0 : clamp(subDepth / 3500, 0, 1) * .965;
    const visibility = Math.max(1 - darkness, clamp((210 - distance) / 65, 0, 1));
    const preparingAmbush = fish.pattern === "ambush" && !fish.completed && !fish.activated && fish.alertTimer > 0;
    const safety = getFishSafetyVisual(fish.completed, preparingAmbush ? 0 : distance, radius, elapsed);
    return [{
      id: fish.id, speciesId: species.id, x: fish.x, y, radius, direction: fish.vx < 0 ? -1 as const : 1 as const,
      color: species.color, glow: species.glow, known: fish.completed || discovered.has(species.id), completed: fish.completed, rare: Boolean(species.rare),
      outlineAlpha: safety.showOutline ? safety.alpha * visibility : 0, outlineWarning: safety.warning,
    }];
  });
  // Keep the complete edited course resident in the Three.js scene. Objects are
  // frustum-culled instead of being destroyed and recreated while scrolling.
  const terrainHazards = hazards.map((hazard) => ({
    id: hazard.id, kind: hazard.kind, x: hazard.x + (hazard.kind === "rock" ? hazard.width / 2 : 0),
    y: screenY(hazard.depth), width: hazard.width, height: hazard.height,
    topWidth: hazard.topWidth, bottomWidth: hazard.bottomWidth,
    side: hazard.side, active: hazard.kind !== "vent" || isVentActive(hazard),
  }));
  const frame: ThreeFrame = {
    elapsed,
    submarine: {
      x: subX, y: SUB_Y, heading: subHeading, pitch: getSubmarinePitch(subVDepth, subHeading), alpha: submarineAlpha, hull,
      lightLevel: getSubmarineLightLevel(subDepth),
      breaking, breakProgress: breaking ? clamp(hullBreakTimer / 1.8, 0, 1) : 0,
    },
    fishes: visibleFishes,
    hazards: terrainHazards,
    boss: { active: boss.active, x: boss.x, y: screenY(boss.depth), direction: boss.direction, flash: boss.flash, revealed: phase === "boss-clear" },
  };
  try { ctx.drawImage(threeLayer.render(frame), 0, 0, W, H); }
  catch (error) {
    console.warn("Three.js gameplay render failed; returning to the 2D renderer.", error);
    threeLayer = null;
    return false;
  }
  return true;
}

function drawThreeFishLabels() {
  ctx.save(); ctx.fillStyle = "rgba(235,249,255,.78)"; ctx.font = "900 22px system-ui"; ctx.textAlign = "center";
  for (const fish of fishes) {
    const species = speciesById.get(fish.speciesId)!; const y = screenY(fish.depth);
    if (fish.completed || discovered.has(species.id) || y < 65 || y > H) continue;
    ctx.fillText("?", fish.x, y - fishRadius(species) - 12);
  }
  for (const fish of fishes) {
    const species = speciesById.get(fish.speciesId)!; const y = screenY(fish.depth); const radius = fishRadius(species);
    if (y < 65 || y > H || (fish.completed || (!targetFishIds.has(fish.id) && fish.research <= 0))) continue;
    ctx.fillStyle = "rgba(255,255,255,.24)"; ctx.fillRect(fish.x - 32, y - radius - 22, 64, 5);
    ctx.fillStyle = "#65ffe9"; ctx.fillRect(fish.x - 32, y - radius - 22, 64 * clamp(fish.research, 0, 1), 5);
  }
  ctx.restore();
}

function drawThreeSubmarineSignals() {
  if (phase !== "ready") {
    ctx.save(); ctx.strokeStyle = "rgba(101,255,233,.24)"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(subX, SUB_Y, NORMAL_RESEARCH_RANGE, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
  }
  if (phase === "ready" || hull >= MAX_HULL) return;
  const bubbleCount = hull === 1 ? 5 : 2;
  ctx.save(); ctx.strokeStyle = "rgba(176,241,255,.72)"; ctx.lineWidth = 1;
  for (let i = 0; i < bubbleCount; i += 1) {
    const age = (elapsed * (30 + i * 4) + i * 13) % 35;
    ctx.beginPath(); ctx.arc(subX - 8 + i * 4, SUB_Y - 10 - age, 1.5 + i % 2, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.restore();
}

function drawHazard(hazard: Hazard, sy: number) {
  ctx.save();
  if (hazard.kind === "rock") {
    const side = hazard.side ?? (hazard.x < W / 2 ? -1 : 1);
    const edgeX = side === -1 ? hazard.x + hazard.width : hazard.x;
    const outerX = side === -1 ? 0 : W;
    const inward = side === -1 ? -1 : 1;
    const top = sy - hazard.height / 2; const bottom = sy + hazard.height / 2;
    const rock = ctx.createLinearGradient(edgeX, sy, outerX, sy);
    rock.addColorStop(0, "#718995"); rock.addColorStop(1, "#334752");
    ctx.fillStyle = rock; ctx.strokeStyle = "#a2bac4"; ctx.lineWidth = 2;
    const topX = outerX - inward * (hazard.topWidth ?? hazard.width);
    const bottomX = outerX - inward * (hazard.bottomWidth ?? hazard.width);
    ctx.beginPath(); ctx.moveTo(outerX, top); ctx.lineTo(topX, top);
    ctx.lineTo(bottomX, bottom); ctx.lineTo(outerX, bottom); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(topX, top); ctx.lineTo(bottomX, bottom); ctx.stroke();

    if (hazard.hollowDepth !== undefined && hazard.hollowHeight !== undefined) {
      const hollowY = screenY(hazard.hollowDepth); const glowX = dangerSpawnX(hazard);
      const caveGlow = ctx.createRadialGradient(glowX, hollowY, 2, glowX, hollowY, 74);
      caveGlow.addColorStop(0, "rgba(83,219,210,.2)"); caveGlow.addColorStop(1, "rgba(3,18,28,0)");
      ctx.fillStyle = caveGlow; ctx.fillRect(glowX - 75, hollowY - 65, 150, 130);
    }
    ctx.fillStyle = "rgba(112,165,162,.45)";
    for (let i = 0; i < 7; i += 1) {
      const markY = top + 35 + i * (hazard.height - 70) / 6;
      ctx.fillRect(edgeX + inward * (18 + i % 3 * 22), markY + Math.sin(i + hazard.phase) * 5, 18 + i % 2 * 12, 3);
    }
  } else if (hazard.kind === "kelp") {
    ctx.lineCap = "round";
    const stalks = Math.max(3, Math.floor(hazard.width / 15));
    for (let i = 0; i < stalks; i += 1) {
      const x = hazard.x + 7 + i * (hazard.width - 14) / Math.max(1, stalks - 1);
      ctx.strokeStyle = i % 2 ? "#3d8e70" : "#2e725e"; ctx.lineWidth = 5;
      ctx.beginPath(); ctx.moveTo(x, sy);
      ctx.bezierCurveTo(x + Math.sin(elapsed * 1.3 + hazard.phase + i) * 18, sy - hazard.height * .35, x - 18, sy - hazard.height * .68, x + Math.sin(elapsed + i) * 12, sy - hazard.height);
      ctx.stroke();
    }
    ctx.fillStyle = "#274e44"; ctx.fillRect(hazard.x - 5, sy - 7, hazard.width + 10, 12);
  } else {
    ctx.translate(hazard.x, sy);
    ctx.fillStyle = "#283944"; ctx.strokeStyle = "#596d74"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(-45, 0); ctx.lineTo(-24, -42); ctx.lineTo(-7, -25); ctx.lineTo(5, -58); ctx.lineTo(25, -31); ctx.lineTo(43, 0); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = isVentActive(hazard) ? "#ff8f5d" : "#55706f";
    ctx.beginPath(); ctx.ellipse(0, -48, 12, 5, 0, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

function drawCurrentSignals() {
  const velocity = getCurrentVelocity();
  if (!velocity) return;
  ctx.save(); ctx.globalAlpha = .1 + Math.min(.14, Math.abs(velocity) / 300); ctx.strokeStyle = "#a4f6ff"; ctx.lineWidth = 1.5;
  const direction = Math.sign(velocity);
  for (let i = 0; i < 16; i += 1) {
    const x = ((i * 137 + elapsed * velocity * 2) % (W + 120) + W + 120) % (W + 120) - 60;
    const y = 90 + i * 43 % (H - 150); const length = 24 + i % 4 * 11;
    ctx.beginPath(); ctx.moveTo(x - direction * length, y); ctx.lineTo(x, y); ctx.stroke();
  }
  ctx.restore();
}

function drawHazardSignals() {
  for (const hazard of hazards) {
    if (hazard.kind !== "vent" || !isVentActive(hazard)) continue;
    const sy = screenY(hazard.depth); if (sy < 65 || sy > H + hazard.height) continue;
    ctx.save(); ctx.fillStyle = "#ff9a63"; ctx.shadowColor = "#ff633e"; ctx.shadowBlur = 22;
    for (let i = 0; i < 8; i += 1) {
      const progress = ((elapsed * .65 + hazard.phase * .13 + i / 8) % 1);
      const x = hazard.x + Math.sin(progress * 12 + i) * (8 + progress * 18);
      const y = sy - 48 - progress * (hazard.height - 42);
      ctx.globalAlpha = .8 * (1 - progress); ctx.beginPath(); ctx.arc(x, y, 3 + progress * 5, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }
}

function drawBackground() {
  const { top, bottom, particleAlpha } = oceanPalette(subDepth);
  const gradient = ctx.createLinearGradient(0, 0, 0, H); gradient.addColorStop(0, top); gradient.addColorStop(1, bottom);
  ctx.fillStyle = gradient; ctx.fillRect(0, 0, W, H);
  ctx.save(); ctx.globalAlpha = particleAlpha;
  for (let i = 0; i < 55; i += 1) {
    const x = (i * 151 + elapsed * (7 + i % 4)) % W;
    const y = 70 + ((i * 89 - subDepth * (.12 + i % 3 * .03)) % (H - 70) + (H - 70)) % (H - 70);
    ctx.fillStyle = i % 7 ? "#a8fff3" : "#fff1b0"; ctx.fillRect(x, y, i % 7 ? 2 : 3, i % 7 ? 2 : 3);
  }
  ctx.restore();
  drawSurfaceScene();
}

function drawSurfaceScene() {
  const surfaceY = screenY(0);
  if (surfaceY <= 63) return;
  const horizonY = Math.min(H, surfaceY);

  ctx.save(); ctx.beginPath(); ctx.rect(0, 64, W, Math.max(0, horizonY - 64)); ctx.clip();
  const sky = ctx.createLinearGradient(0, 64, 0, horizonY);
  sky.addColorStop(0, "#57b8dc"); sky.addColorStop(.68, "#9de0e9"); sky.addColorStop(1, "#f5d9a1");
  ctx.fillStyle = sky; ctx.fillRect(0, 64, W, horizonY - 64);
  const sunY = surfaceY - 190;
  ctx.fillStyle = "rgba(255,239,168,.9)"; ctx.shadowColor = "#fff0a8"; ctx.shadowBlur = 28;
  ctx.beginPath(); ctx.arc(130, sunY, 29, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0;

  const drawCloud = (x: number, y: number, scale: number) => {
    ctx.fillStyle = "rgba(247,255,255,.72)";
    ctx.beginPath(); ctx.ellipse(x, y, 42 * scale, 13 * scale, 0, 0, Math.PI * 2);
    ctx.ellipse(x - 24 * scale, y + 3 * scale, 26 * scale, 10 * scale, 0, 0, Math.PI * 2);
    ctx.ellipse(x + 21 * scale, y + 4 * scale, 31 * scale, 11 * scale, 0, 0, Math.PI * 2); ctx.fill();
  };
  drawCloud(340, surfaceY - 220, .75); drawCloud(690, surfaceY - 155, .52);
  ctx.restore();

  const islandX = W * .77;
  ctx.save(); ctx.translate(islandX, surfaceY);
  ctx.fillStyle = "#d6b775"; ctx.beginPath(); ctx.ellipse(0, 2, 112, 15, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#477551"; ctx.beginPath(); ctx.moveTo(-88, -3); ctx.quadraticCurveTo(-48, -46, -10, -20); ctx.quadraticCurveTo(28, -72, 83, -4); ctx.closePath(); ctx.fill();
  ctx.fillStyle = "#315a43"; ctx.beginPath(); ctx.moveTo(-18, -16); ctx.quadraticCurveTo(25, -60, 75, -3); ctx.lineTo(4, -2); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = "#66513a"; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(-54, -8); ctx.quadraticCurveTo(-56, -32, -46, -52); ctx.stroke();
  ctx.fillStyle = "#347050";
  for (let i = 0; i < 5; i += 1) { ctx.save(); ctx.translate(-46, -52); ctx.rotate(-1.1 + i * .52); ctx.beginPath(); ctx.ellipse(13, 0, 18, 5, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore(); }
  ctx.restore();

  ctx.save();
  const reflection = ctx.createLinearGradient(0, surfaceY, 0, surfaceY + 44);
  reflection.addColorStop(0, "rgba(210,245,239,.32)"); reflection.addColorStop(1, "rgba(210,245,239,0)");
  ctx.fillStyle = reflection; ctx.fillRect(0, surfaceY, W, 44);
  ctx.strokeStyle = "rgba(225,255,249,.86)"; ctx.lineWidth = 3;
  for (let row = 0; row < 3; row += 1) {
    ctx.beginPath();
    for (let x = -20; x <= W + 20; x += 24) {
      const y = surfaceY + row * 7 + Math.sin(x * .055 + elapsed * 2.3 + row) * (2.5 - row * .5);
      if (x === -20) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.globalAlpha = .75 - row * .2; ctx.stroke();
  }
  ctx.restore();
}

function drawFish(fish: Fish, sy: number) {
  const species = speciesById.get(fish.speciesId)!;
  const known = fish.completed || discovered.has(species.id);
  const radius = fishRadius(species);
  ctx.save(); ctx.translate(fish.x, sy); if (fish.vx < 0) ctx.scale(-1, 1);
  ctx.globalAlpha = known ? 1 : .48; ctx.filter = known ? "none" : "blur(2px)";
  ctx.shadowColor = species.glow; ctx.shadowBlur = species.layer === 3 || species.rare ? 15 : 4;
  ctx.fillStyle = fish.flash > 0 ? "#ffffff" : species.color;
  drawFishBody(species.shape, radius); ctx.filter = "none"; ctx.shadowBlur = 0;
  ctx.fillStyle = species.glow; ctx.beginPath(); ctx.arc(radius * .48, -3, species.rare ? 4 : 2.6, 0, Math.PI * 2); ctx.fill();
  // Labels remain upright regardless of fish direction.
  ctx.restore(); ctx.save(); ctx.translate(fish.x, sy);
  if (!known) { ctx.fillStyle = "#f7ffff"; ctx.font = "900 20px system-ui"; ctx.textAlign = "center"; ctx.fillText("?", 0, -radius - 10); }
  if (targetFishIds.has(fish.id) || (!fish.completed && fish.research > 0)) {
    ctx.fillStyle = "rgba(255,255,255,.24)"; ctx.fillRect(-32, -radius - 22, 64, 5);
    ctx.fillStyle = "#65ffe9"; ctx.fillRect(-32, -radius - 22, 64 * clamp(fish.research, 0, 1), 5);
  }
  ctx.restore();
}

function drawFishSafetySignals(exactThreeOutline = false) {
  const darkness = debugParams.get("terrainPreview") === "1" && phase === "ready" ? 0 : clamp(subDepth / 3500, 0, 1) * .965;
  for (const fish of fishes) {
    const sy = screenY(fish.depth);
    if (sy < 76 || sy > H - 35) continue;
    const species = speciesById.get(fish.speciesId)!; const radius = fishRadius(species);
    const distance = Math.hypot(fish.x - subX, sy - SUB_Y);
    const visibility = Math.max(1 - darkness, clamp((210 - distance) / 65, 0, 1));
    if (visibility < .08) continue;
    const preparingAmbush = fish.pattern === "ambush" && !fish.completed && !fish.activated && fish.alertTimer > 0;
    const visual = getFishSafetyVisual(fish.completed, preparingAmbush ? 0 : distance, radius, elapsed);
    ctx.save(); ctx.translate(fish.x, sy);
    ctx.globalAlpha = visual.alpha * visibility; ctx.strokeStyle = visual.color;
    ctx.lineWidth = visual.lineWidth; ctx.shadowColor = visual.color; ctx.shadowBlur = visual.warning ? 8 : 3;
    if (visual.showOutline && !exactThreeOutline) {
      ctx.save(); if (fish.vx < 0) ctx.scale(-1, 1);
      drawFishBody(species.shape, radius + 2, true); ctx.restore();
    }
    if (visual.warning) {
      ctx.font = "900 16px system-ui"; ctx.textAlign = "center"; ctx.fillStyle = visual.color;
      ctx.fillText("!", radius * 1.8 + 6, -radius * .5);
    }
    if (fish.completed && fish.completionEffect > 0) {
      const progress = 1 - fish.completionEffect / 1.6;
      ctx.globalAlpha = (1 - progress) * visibility; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(0, 0, radius + 6 + progress * 36, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.restore();
  }
}

function drawFishBody(shape: number, r: number, strokeOnly = false, target: CanvasRenderingContext2D = ctx) {
  target.beginPath();
  if (shape === 4) { target.moveTo(-r * 1.5, 0); target.quadraticCurveTo(0, -r, r * 1.5, 0); target.quadraticCurveTo(0, r * .5, -r * 1.5, 0); }
  else if (shape === 5) { target.arc(0, -2, r, Math.PI, 0); target.lineTo(r * .65, r); target.lineTo(0, r * .45); target.lineTo(-r * .65, r); target.closePath(); }
  else { target.ellipse(0, 0, shape === 2 ? r * 1.7 : r * 1.25, shape === 3 ? r : r * .65, 0, 0, Math.PI * 2); target.moveTo(-r, 0); target.lineTo(-r * 1.65, -r * .55); target.lineTo(-r * 1.65, r * .55); target.closePath(); }
  if (strokeOnly) target.stroke(); else target.fill();
}

function drawBoss() {
  const sy = screenY(boss.depth);
  const revealed = phase === "boss-clear";
  ctx.save(); ctx.translate(boss.x, sy); if (boss.direction < 0) ctx.scale(-1, 1);
  ctx.shadowColor = revealed ? "#67dff4" : "#244b77"; ctx.shadowBlur = revealed ? 58 : 40; ctx.fillStyle = revealed ? "#327492" : "#14243d";
  ctx.beginPath(); ctx.ellipse(0, 0, BOSS_BODY_RADIUS_X, BOSS_BODY_RADIUS_Y, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); BOSS_TAIL.forEach(([x, y], index) => { if (index === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); }); ctx.closePath(); ctx.fill();
  if (revealed) {
    ctx.strokeStyle = "rgba(143,255,244,.7)"; ctx.lineWidth = 8; ctx.shadowBlur = 16;
    for (let x = -210; x <= 80; x += 72) { ctx.beginPath(); ctx.arc(x, 2, 52, -.75, .75); ctx.stroke(); }
    ctx.fillStyle = "#204d70"; ctx.beginPath(); ctx.moveTo(-45, -94); ctx.lineTo(35, -178); ctx.lineTo(92, -94); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(-35, 94); ctx.lineTo(50, 164); ctx.lineTo(105, 92); ctx.closePath(); ctx.fill();
  }
  ctx.fillStyle = boss.flash > 0 ? "#ffffff" : "#ffce59"; ctx.shadowColor = "#ffce59"; ctx.shadowBlur = 28;
  ctx.beginPath(); ctx.arc(155, -18, 18, 0, Math.PI * 2); ctx.fill(); ctx.restore();
}

function drawBossResearchGauge() {
  const x = W / 2 - 210; const y = 75; const width = 420; const scanning = phase === "dive" && canResearchBoss();
  ctx.save();
  ctx.fillStyle = "rgba(0,8,18,.94)"; ctx.strokeStyle = scanning ? "#fff09a" : "rgba(128,220,235,.72)"; ctx.lineWidth = 2;
  ctx.fillRect(x - 10, y - 8, width + 20, 42); ctx.strokeRect(x - 10, y - 8, width + 20, 42);
  ctx.fillStyle = "rgba(255,255,255,.2)"; ctx.fillRect(x, y + 13, width, 11);
  ctx.fillStyle = phase === "boss-clear" ? "#7cfff0" : "#ffdc62"; ctx.fillRect(x, y + 13, width * bossProgress / 100, 11);
  ctx.fillStyle = "#f5ffff"; ctx.font = "900 14px system-ui"; ctx.textAlign = "center";
  ctx.fillText(phase === "boss-clear" ? "巨大魚調査 COMPLETE" : `巨大魚調査 ${Math.floor(bossProgress)}%${scanning ? "　解析中" : ""}`, W / 2, y + 6);
  ctx.restore();
}

function drawBossClearSequence() {
  const reveal = smoothstep(bossClearTimer / 1.4);
  const titleAlpha = smoothstep((bossClearTimer - .6) / 1);
  const clearAlpha = smoothstep((bossClearTimer - 2.1) / 1);
  ctx.save();
  ctx.fillStyle = `rgba(103,255,239,${.08 * reveal})`; ctx.fillRect(0, 64, W, H - 64);
  ctx.textAlign = "center"; ctx.shadowColor = "#62fff0"; ctx.shadowBlur = 28;
  ctx.globalAlpha = titleAlpha; ctx.fillStyle = "#dffffb"; ctx.font = "900 30px system-ui"; ctx.fillText("調査完了", W / 2, H - 112);
  ctx.globalAlpha = clearAlpha; ctx.fillStyle = "#ffe075"; ctx.font = "900 52px system-ui"; ctx.fillText("GAME CLEAR", W / 2, H / 2 - 142);
  ctx.font = "800 18px system-ui"; ctx.fillStyle = "#f3ffff"; ctx.fillText("リヴァイアサンを図鑑に登録しました", W / 2, H / 2 - 108);
  ctx.restore();
}

function drawDarkness() {
  if (phase === "ready" && debugParams.get("terrainPreview") === "1") return;
  const clearReveal = phase === "boss-clear" ? 1 - smoothstep(bossClearTimer / 1.4) : 1;
  const darkness = clamp(subDepth / 3_500, 0, 1) * .965 * clearReveal;
  if (darkness <= .03) return;
  darknessCtx.clearRect(0, 0, W, H); darknessCtx.globalCompositeOperation = "source-over";
  darknessCtx.fillStyle = `rgba(0,2,8,${darkness})`; darknessCtx.fillRect(0, 64, W, H - 64);
  darknessCtx.globalCompositeOperation = "destination-out";
  const radius = 270 - darkness * 115;
  const ambient = darknessCtx.createRadialGradient(subX, SUB_Y, 20, subX, SUB_Y, radius);
  ambient.addColorStop(0, "rgba(0,0,0,1)"); ambient.addColorStop(.55, "rgba(0,0,0,.82)"); ambient.addColorStop(1, "rgba(0,0,0,0)");
  darknessCtx.fillStyle = ambient; darknessCtx.beginPath(); darknessCtx.arc(subX, SUB_Y, radius, 0, Math.PI * 2); darknessCtx.fill();
  darknessCtx.globalCompositeOperation = "source-over"; ctx.drawImage(darknessCanvas, 0, 0);
}

function drawDeepSignals() {
  if (getSeaLayer(subDepth) !== 3) return;
  for (const fish of fishes) {
    const species = speciesById.get(fish.speciesId)!; const sy = screenY(fish.depth);
    if (sy < 65 || sy > H || Math.hypot(fish.x - subX, sy - SUB_Y) < 145) continue;
    ctx.save(); ctx.globalAlpha = fish.completed ? .4 : .35 + Math.sin(elapsed * 5 + fish.phase) * .15; ctx.fillStyle = fish.completed ? "#75e8ef" : species.glow; ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = 18;
    ctx.beginPath(); ctx.arc(fish.x + (fish.vx > 0 ? 8 : -8), sy - 2, species.rare ? 4 : 2.5, 0, Math.PI * 2); ctx.fill(); ctx.restore();
  }
}

function drawBossSignal(renderedInThree = false) {
  if (!boss.active || phase === "boss-clear") return;
  const sy = screenY(boss.depth);
  if (renderedInThree) {
    const eyeX = boss.x + boss.direction * 155;
    ctx.save(); ctx.globalAlpha = .92; ctx.fillStyle = "#ffce59"; ctx.shadowColor = "#ffce59"; ctx.shadowBlur = 30;
    ctx.beginPath(); ctx.arc(eyeX, sy - 18, 16, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    return;
  }
  ctx.save(); ctx.translate(boss.x, sy); if (boss.direction < 0) ctx.scale(-1, 1);
  ctx.globalAlpha = .28; ctx.fillStyle = "#315277"; ctx.shadowColor = "#487fb6"; ctx.shadowBlur = 35;
  ctx.beginPath(); ctx.ellipse(0, 0, BOSS_BODY_RADIUS_X, BOSS_BODY_RADIUS_Y, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); BOSS_TAIL.forEach(([x, y], index) => { if (index === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); }); ctx.closePath(); ctx.fill();
  ctx.globalAlpha = .92; ctx.fillStyle = "#ffce59"; ctx.shadowColor = "#ffce59"; ctx.shadowBlur = 30;
  ctx.beginPath(); ctx.arc(155, -18, 18, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

function drawSubmarine() {
  const yaw = clamp(subHeading, 0, Math.PI);
  const side = Math.cos(yaw);
  const sideAmount = Math.abs(side);
  const bowTowardViewer = Math.sin(yaw);
  const bodyRadiusX = 15 + 17 * sideAmount;
  const bodyRadiusY = 14 + 3 * bowTowardViewer;
  const pitch = getSubmarinePitch(subVDepth, yaw);
  const breaking = phase === "hull-break";
  const shake = breaking ? Math.max(0, 1 - hullBreakTimer / 1.1) : 0;
  const submarineAlpha = breaking ? Math.max(0, 1 - hullBreakTimer / 1.35) : invincible > 0 && Math.floor(invincible * 10) % 2 ? .35 : 1;
  ctx.save(); ctx.translate(subX + Math.sin(hullBreakTimer * 62) * 4 * shake, SUB_Y + Math.cos(hullBreakTimer * 49) * 3 * shake); ctx.rotate(pitch);
  ctx.globalAlpha = submarineAlpha;

  // The propeller and tail recede behind the hull as the bow turns toward the viewer.
  if (sideAmount > .04) {
    const tailX = -side * (bodyRadiusX + 4);
    ctx.globalAlpha *= .42 + sideAmount * .58;
    ctx.fillStyle = "#b96732"; ctx.fillRect(tailX - side * 4 - 4, -4, 8, 8);
    ctx.strokeStyle = "#f2a251"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(tailX, -8); ctx.lineTo(tailX, 8); ctx.stroke();
    ctx.globalAlpha = submarineAlpha;
  }

  // Dive planes become symmetrical in the head-on view.
  ctx.fillStyle = "#a88b3e";
  const finReach = 7 + 13 * bowTowardViewer;
  ctx.beginPath(); ctx.moveTo(-bodyRadiusX * .55, 2); ctx.lineTo(-bodyRadiusX - finReach, 9); ctx.lineTo(-bodyRadiusX * .7, 10); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.moveTo(bodyRadiusX * .55, 2); ctx.lineTo(bodyRadiusX + finReach, 9); ctx.lineTo(bodyRadiusX * .7, 10); ctx.closePath(); ctx.fill();

  const hullGradient = ctx.createLinearGradient(0, -bodyRadiusY, 0, bodyRadiusY);
  hullGradient.addColorStop(0, "#f8df75"); hullGradient.addColorStop(.52, "#dbae3d"); hullGradient.addColorStop(1, "#bd8f27");
  ctx.fillStyle = hullGradient; ctx.shadowColor = "rgba(255,221,111,.35)"; ctx.shadowBlur = 10 + bowTowardViewer * 8;
  ctx.beginPath(); ctx.ellipse(0, 0, bodyRadiusX, bodyRadiusY, 0, 0, Math.PI * 2); ctx.fill();

  // Project the two circular side windows from the cylindrical hull. Their
  // horizontal radius is foreshortened by the surface angle, so one naturally
  // becomes edge-on before the opposite-side window rotates into view.
  const drawProjectedSideWindow = (windowSide: 1 | -1) => {
    const surfaceFacing = windowSide * side;
    if (surfaceFacing <= .02) return;
    const windowX = 10 * side - windowSide * 8 * bowTowardViewer;
    const projectedRadiusX = 7 * surfaceFacing;
    ctx.save();
    ctx.fillStyle = "#163b4a"; ctx.strokeStyle = "#a7fff6"; ctx.lineWidth = .8 + 1.2 * surfaceFacing;
    ctx.beginPath(); ctx.ellipse(windowX, -2, projectedRadiusX, 6, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = "#75fff0"; ctx.globalAlpha *= .72;
    ctx.beginPath(); ctx.ellipse(windowX - windowSide * projectedRadiusX * .2, -4, projectedRadiusX * .43, 1.7, -.25 * windowSide, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  };
  drawProjectedSideWindow(1);
  drawProjectedSideWindow(-1);

  const drawProjectedHullCrack = (surfaceSide: 1 | -1) => {
    if (hull >= MAX_HULL) return;
    const surfaceFacing = surfaceSide * side;
    if (surfaceFacing <= .02) return;
    ctx.save();
    // The crack lies on each side of the curved hull: it becomes edge-on during
    // the turn, then its counterpart on the other side comes into view.
    ctx.translate(-7 * side, 1);
    ctx.scale(surfaceFacing, 1);
    ctx.globalAlpha *= .45 + surfaceFacing * .55;
    ctx.strokeStyle = hull === 1 ? "#ffd0aa" : "#ff9d79"; ctx.lineWidth = .75;
    ctx.shadowColor = hull === 1 ? "#ff3a32" : "#ff6a48"; ctx.shadowBlur = hull === 1 ? 5 : 3;
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    // First damage: several fine, branching fractures instead of one short line.
    ctx.beginPath();
    ctx.moveTo(-11, 5); ctx.lineTo(-6, 1); ctx.lineTo(-1, -1); ctx.lineTo(2, -7); ctx.lineTo(1, -11);
    ctx.moveTo(-6, 1); ctx.lineTo(-8, -5); ctx.lineTo(-5, -9);
    ctx.moveTo(-1, -1); ctx.lineTo(5, 1); ctx.lineTo(10, -2);
    ctx.moveTo(5, 1); ctx.lineTo(8, 6); ctx.lineTo(13, 8);
    ctx.moveTo(-1, -1); ctx.lineTo(-2, 6); ctx.lineTo(-6, 10);
    if (hull === 1) {
      // Second damage: the original fracture grows and new branches spread out.
      ctx.moveTo(-11, 5); ctx.lineTo(-15, 1); ctx.lineTo(-14, -5);
      ctx.moveTo(1, -11); ctx.lineTo(5, -14);
      ctx.moveTo(10, -2); ctx.lineTo(15, -6); ctx.lineTo(18, -4);
      ctx.moveTo(13, 8); ctx.lineTo(16, 12);
      ctx.moveTo(-6, 10); ctx.lineTo(-11, 13);
      ctx.moveTo(3, 4); ctx.lineTo(1, 10); ctx.lineTo(5, 14);
      ctx.moveTo(-10, -3); ctx.lineTo(-15, -9);
    }
    ctx.stroke(); ctx.restore();
  };
  drawProjectedHullCrack(1);
  drawProjectedHullCrack(-1);

  ctx.globalAlpha = submarineAlpha;
  ctx.fillStyle = "#87652c";
  ctx.fillRect(-2 - side * 5, -bodyRadiusY - 6, 4, 8);
  ctx.restore();
  if (phase !== "ready" && hull < MAX_HULL) {
    const bubbleCount = hull === 1 ? 5 : 2;
    ctx.save(); ctx.strokeStyle = "rgba(176,241,255,.72)"; ctx.lineWidth = 1;
    for (let i = 0; i < bubbleCount; i += 1) {
      const age = (elapsed * (30 + i * 4) + i * 13) % 35;
      ctx.beginPath(); ctx.arc(subX - 8 + i * 4, SUB_Y - 10 - age, 1.5 + i % 2, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.restore();
  }
  if (phase !== "ready") {
    ctx.strokeStyle = "rgba(101,255,233,.24)"; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(subX, SUB_Y, NORMAL_RESEARCH_RANGE, 0, Math.PI * 2); ctx.stroke();
  }
}

function drawHullBreakSequence() {
  const t = hullBreakTimer;
  const burst = smoothstep(Math.min(1, t / 1.8));
  const flash = Math.max(0, 1 - t / .55);
  ctx.save();
  ctx.fillStyle = `rgba(255,70,55,${flash * .16})`; ctx.fillRect(0, 64, W, H - 98);
  ctx.translate(subX, SUB_Y);
  ctx.strokeStyle = `rgba(255,210,120,${Math.max(0, 1 - t / 2)})`;
  ctx.lineWidth = Math.max(.5, 4 - t * 1.5);
  for (let i = 0; i < 2; i += 1) {
    ctx.beginPath(); ctx.arc(0, 0, 18 + burst * (48 + i * 34), 0, Math.PI * 2); ctx.stroke();
  }
  ctx.fillStyle = "#d5ad47"; ctx.strokeStyle = "#fff0a0"; ctx.lineWidth = .7;
  for (let i = 0; i < 8; i += 1) {
    const angle = i * Math.PI / 4 + .22;
    const distance = burst * (30 + i % 3 * 12);
    ctx.save(); ctx.translate(Math.cos(angle) * distance, Math.sin(angle) * distance); ctx.rotate(angle + t * (i % 2 ? 3 : -3));
    ctx.beginPath(); ctx.moveTo(-4, -2); ctx.lineTo(6, 0); ctx.lineTo(-3, 4); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore();
  }
  ctx.strokeStyle = "rgba(190,245,255,.82)"; ctx.lineWidth = 1;
  for (let i = 0; i < 22; i += 1) {
    const angle = i * 2.4; const distance = burst * (20 + i * 2.6);
    ctx.beginPath(); ctx.arc(Math.cos(angle) * distance, Math.sin(angle) * distance - t * 13, 1.5 + i % 3, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.restore();
  const vignette = Math.max(0, (t - 1.15) / 1.85);
  ctx.fillStyle = `rgba(0,2,8,${vignette * .72})`; ctx.fillRect(0, 64, W, H - 98);
}

function drawHud() {
  ctx.fillStyle = "rgba(0,8,18,.86)"; ctx.fillRect(0, 0, W, 64);
  ctx.fillStyle = "#e9ffff"; ctx.font = "800 15px system-ui";
  const drawHullLamps = (startX: number, y: number) => {
    for (let i = 0; i < MAX_HULL; i += 1) {
      ctx.fillStyle = i < hull ? "#7aff9b" : "#5a1d29";
      ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = i < hull ? 7 : 0;
      ctx.beginPath(); ctx.arc(startX + i * 15, y, 5, 0, Math.PI * 2); ctx.fill();
    }
    ctx.shadowBlur = 0;
  };
  if (isCompactCanvas()) {
    ctx.fillText(`深度 ${Math.floor(subDepth).toLocaleString()}m`, 326, 25); ctx.fillText(`POWER ${Math.ceil(power)}%`, 514, 25);
    ctx.fillText(`SCORE ${earnedScore.toLocaleString()}`, 326, 49); ctx.fillText(`BOSS ${Math.floor(bossProgress)}%`, 514, 49);
    ctx.fillStyle = "#63f4d9"; ctx.fillRect(326, 57, 330 * power / 100, 5);
    drawHullLamps(704, 24);
  } else {
  ctx.fillText(`深度 ${Math.floor(subDepth).toLocaleString()}m`, 22, 25); ctx.fillText(`最高 ${Math.floor(maxDepth).toLocaleString()}m`, 22, 49);
  ctx.fillText(`図鑑 ${discovered.size}/21`, 200, 25);
  const current = getCurrentVelocity();
  if (current) { ctx.fillStyle = "#8fefff"; ctx.fillText(`潮流 ${current > 0 ? "→" : "←"} ${Math.round(Math.abs(current))}`, 200, 49); ctx.fillStyle = "#e9ffff"; }
  ctx.fillText(`SCORE ${earnedScore.toLocaleString()}`, 330, 25); ctx.fillText(`CONTINUE ×${getRetryScoreMultiplier(retryCount).toFixed(2)}`, 330, 49);
  ctx.fillText(`BOSS ${Math.floor(bossProgress)}%`, 555, 25); ctx.fillText(`TIME ${formatTime(elapsed)}`, 555, 49);
  drawHullLamps(730, 24);
  const barX = W - 28; const barY = 82; const barH = H - 132;
  ctx.fillStyle = "rgba(2,10,18,.88)"; ctx.fillRect(barX - 7, barY - 7, 22, barH + 14);
  ctx.fillStyle = power > 25 ? "#63f4d9" : "#ff526f"; ctx.fillRect(barX, barY + barH * (1 - power / 100), 8, barH * power / 100);
  ctx.save(); ctx.translate(barX - 11, H / 2); ctx.rotate(-Math.PI / 2); ctx.fillStyle = "#efffff"; ctx.textAlign = "center"; ctx.font = "900 12px system-ui"; ctx.fillText(`POWER ${Math.ceil(power)}%`, 0, 0); ctx.restore();
  }
  ctx.fillStyle = "rgba(1,10,18,.8)"; ctx.fillRect(0, H - 34, W, 34); ctx.fillStyle = messageTimer > 0 ? "#ffe48b" : "#8eb7bd"; ctx.textAlign = "center";
  ctx.fillText(messageTimer > 0 ? message : "魚を調査して電力を補充", W / 2, H - 12); ctx.textAlign = "left";
}

function drawCollection(mode: "collection" | "pause" = "collection") {
  ctx.fillStyle = "rgba(0,5,13,.96)"; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#6effe9"; ctx.font = "900 34px system-ui"; ctx.textAlign = "center"; ctx.fillText(`${mode === "pause" ? "PAUSED　" : ""}今回の調査図鑑　${discovered.size} / 21`, W / 2, 48);
  const cols = 7; const cellW = 122; const cellH = 156; const startX = (W - cols * cellW) / 2;
  SPECIES.forEach((species, index) => {
    const col = index % cols; const row = Math.floor(index / cols); const x = startX + col * cellW; const y = 76 + row * cellH; const known = discovered.has(species.id);
    ctx.fillStyle = known ? "rgba(30,72,90,.72)" : "rgba(255,255,255,.055)"; ctx.strokeStyle = species.rare && known ? "#ffd65c" : known ? "#5fffea" : "rgba(255,255,255,.16)";
    ctx.lineWidth = species.boss ? 3 : 1; ctx.fillRect(x + 4, y, cellW - 8, cellH - 9); ctx.strokeRect(x + 4, y, cellW - 8, cellH - 9);
    drawSpeciesPortrait(ctx, species, known, x + 10, y + 10, cellW - 20, 84);
    ctx.fillStyle = known ? "#eaffff" : "#76828c"; ctx.font = "800 12px system-ui"; ctx.textAlign = "center"; ctx.fillText(known ? species.name : "？", x + cellW / 2, y + 112);
    if (species.boss || species.rare) {
      ctx.fillStyle = species.boss ? "#ffce59" : "#e9b5ff"; ctx.font = "700 10px system-ui"; ctx.fillText(species.boss ? "BOSS" : "RARE", x + cellW / 2, y + 134);
    }
  });
  const footer = mode === "pause" ? "P / 一時停止ボタンで再開" : returnToResult ? "F / クリックでリザルトへ戻る" : "F / 図鑑ボタンで閉じる";
  ctx.fillStyle = "#a9c6ca"; ctx.font = "700 14px system-ui"; ctx.fillText(footer, W / 2, H - 18); ctx.textAlign = "left";
}

function drawSpeciesPortrait(target: CanvasRenderingContext2D, species: Species, known: boolean, x: number, y: number, width: number, height: number) {
  const image = speciesIcons.get(species.id);
  target.save(); target.globalAlpha = known ? 1 : .72;
  target.filter = known ? "none" : "brightness(0) saturate(0)";
  if (image?.complete && image.naturalWidth > 0) target.drawImage(image, x, y, width, height);
  else {
    target.translate(x + width / 2, y + height / 2); target.fillStyle = known ? species.color : "#182632";
    drawFishBody(species.shape === 6 ? 0 : species.shape, species.boss ? 26 : 20, false, target);
  }
  target.restore();
}

function drawOverlay(title: string, lines: string[]) {
  ctx.fillStyle = "rgba(0,5,13,.78)"; ctx.fillRect(0, 0, W, H); ctx.textAlign = "center";
  ctx.fillStyle = "#71ffe8"; ctx.font = "900 46px system-ui"; ctx.fillText(title, W / 2, H / 2 - 74);
  ctx.fillStyle = "#e9fffc"; ctx.font = "700 18px system-ui"; lines.forEach((line, index) => ctx.fillText(line, W / 2, H / 2 - 14 + index * 34)); ctx.textAlign = "left";
}

function drawStartOverlay() {
  const panelX = W / 2 - 300;
  // Center the instructions between the HUD and the sea surface.
  const panelY = Math.max(76, (76 + screenY(0) - 154) / 2);
  ctx.fillStyle = "rgba(0,18,30,.76)"; ctx.strokeStyle = "rgba(123,255,238,.42)"; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.roundRect(panelX, panelY, 600, 154, 18); ctx.fill(); ctx.stroke();
  ctx.textAlign = "center"; ctx.fillStyle = "#71ffe8"; ctx.font = "900 34px system-ui"; ctx.fillText("深海サルベージ", W / 2, panelY + 43);
  ctx.fillStyle = "#e9fffc"; ctx.font = "700 16px system-ui";
  ctx.fillText("魚に近づくと自動で調査", W / 2, panelY + 78);
  ctx.fillText("WASD / 矢印: 移動　F: 図鑑", W / 2, panelY + 105);
  ctx.fillStyle = "#ffe48b"; ctx.fillText("P または画面下のボタンで潜航開始", W / 2, panelY + 133); ctx.textAlign = "left";
}

function fishRadius(species: Species) { return species.rare ? 25 : 20 + species.shape % 3 * 2; }
function screenY(depth: number) { return SUB_Y + depth - subDepth; }
function isCompactCanvas() { const rect = canvas.getBoundingClientRect(); return rect.height > rect.width * 1.2; }
function horizontalBounds(): [number, number] { return isCompactCanvas() ? [325, 635] : [42, W - 42]; }
function oceanPalette(depth: number) {
  const shallow = { top: "#247f9b", bottom: "#0e506f", particle: .35 };
  const middle = { top: "#0b3957", bottom: "#061b32", particle: .22 };
  const deep = { top: "#020913", bottom: "#00030a", particle: .14 };
  if (depth < 1_200) return { top: shallow.top, bottom: shallow.bottom, particleAlpha: shallow.particle };
  if (depth < 1_800) {
    const t = smoothstep((depth - 1_200) / 600);
    return { top: mixHex(shallow.top, middle.top, t), bottom: mixHex(shallow.bottom, middle.bottom, t), particleAlpha: mix(shallow.particle, middle.particle, t) };
  }
  if (depth < 3_200) return { top: middle.top, bottom: middle.bottom, particleAlpha: middle.particle };
  if (depth < 3_800) {
    const t = smoothstep((depth - 3_200) / 600);
    return { top: mixHex(middle.top, deep.top, t), bottom: mixHex(middle.bottom, deep.bottom, t), particleAlpha: mix(middle.particle, deep.particle, t) };
  }
  return { top: deep.top, bottom: deep.bottom, particleAlpha: deep.particle };
}
function smoothstep(value: number) { const t = clamp(value, 0, 1); return t * t * (3 - 2 * t); }
function mix(from: number, to: number, amount: number) { return from + (to - from) * amount; }
function mixHex(from: string, to: string, amount: number) {
  const a = Number.parseInt(from.slice(1), 16); const b = Number.parseInt(to.slice(1), 16);
  const channel = (shift: number) => Math.round(mix((a >> shift) & 255, (b >> shift) & 255, amount));
  return `rgb(${channel(16)}, ${channel(8)}, ${channel(0)})`;
}
function setMessage(text: string, seconds: number) { message = text; messageTimer = seconds; }
function clamp(value: number, min: number, max: number) { return Math.max(min, Math.min(max, value)); }
function formatTime(seconds: number) { return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`; }

function shareText() {
  return `深海サルベージで21種中${discovered.size}種を調査！最大${Math.floor(maxDepth).toLocaleString()}mまで潜航しました。\n#深海サルベージ #PULBASE`;
}

function shareUrl() {
  const url = new URL(window.location.href);
  for (const key of [...url.searchParams.keys()]) if (key !== "game") url.searchParams.delete(key);
  url.searchParams.set("game", DEEP_SEA_SALVAGE.id);
  return url.toString();
}

async function createShareFile() {
  const shareCanvas = document.createElement("canvas"); shareCanvas.width = 1200; shareCanvas.height = 630;
  const shareCtx = shareCanvas.getContext("2d")!; const gradient = shareCtx.createLinearGradient(0, 0, 1200, 630);
  gradient.addColorStop(0, "#071d32"); gradient.addColorStop(1, "#01040b"); shareCtx.fillStyle = gradient; shareCtx.fillRect(0, 0, 1200, 630);
  shareCtx.fillStyle = "#69f7ff"; shareCtx.font = "900 34px system-ui"; shareCtx.fillText("PULBASE / DEEP SEA SALVAGE", 64, 70);
  shareCtx.fillStyle = "#f3ffff"; shareCtx.font = "900 72px system-ui"; shareCtx.fillText(`図鑑収集率 ${Math.round(discovered.size / 21 * 100)}%`, 64, 164);
  shareCtx.font = "800 34px system-ui"; shareCtx.fillStyle = "#b8d4dc"; shareCtx.fillText(`${discovered.size} / 21 SPECIES　最大 ${Math.floor(maxDepth).toLocaleString()}m`, 68, 218);
  SPECIES.forEach((species, index) => {
    const x = 75 + index % 11 * 95; const y = 290 + Math.floor(index / 11) * 125; const known = discovered.has(species.id);
    shareCtx.fillStyle = known ? "rgba(45,110,125,.65)" : "rgba(255,255,255,.06)"; shareCtx.fillRect(x, y, 76, 94);
    drawSpeciesPortrait(shareCtx, species, known, x + 4, y + 4, 68, 62);
    shareCtx.fillStyle = known ? "#f0ffff" : "#80909b"; shareCtx.textAlign = "center"; shareCtx.font = "800 18px system-ui"; shareCtx.fillText(known ? "✓" : "?", x + 38, y + 78);
  });
  shareCtx.textAlign = "left"; shareCtx.fillStyle = "#ffdb67"; shareCtx.font = "800 25px system-ui"; shareCtx.fillText(cleared ? "巨大深海魚の調査に成功！" : "今回の深海調査記録", 64, 570);
  const blob = await new Promise<Blob | null>((resolve) => shareCanvas.toBlob(resolve, "image/png"));
  return blob ? new File([blob], "deep-sea-salvage-result.png", { type: "image/png" }) : null;
}

function showShareMenu() {
  if (!shareMenu) return;
  shareMenu.hidden = false;
  shareResultButton?.setAttribute("aria-expanded", "true");
  shareMenu.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

function setShareFeedback(text: string) {
  if (!shareResultButton) return;
  shareResultButton.textContent = text;
  window.setTimeout(() => { shareResultButton.textContent = "結果をシェア"; }, 2_000);
}

async function shareResult() {
  if (phase !== "result") return;
  showShareMenu();
}

async function shareWithDevice() {
  const file = await createShareFile();
  if (!file) { setShareFeedback("共有画像を作成できませんでした"); return; }
  try {
    if (navigator.share && (!navigator.canShare || navigator.canShare({ files: [file] }))) {
      await navigator.share({ title: "深海サルベージ 調査記録", text: shareText(), url: shareUrl(), files: [file] });
      return;
    }
    if (navigator.share) {
      await navigator.share({ title: "深海サルベージ 調査記録", text: shareText(), url: shareUrl() });
      return;
    }
    await copyShareText();
    setShareFeedback("共有機能がないため文章をコピーしました");
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return;
    setShareFeedback("共有できませんでした");
  }
}

async function saveShareImage() {
  const file = await createShareFile();
  if (!file) return;
  const objectUrl = URL.createObjectURL(file);
  const link = document.createElement("a"); link.href = objectUrl; link.download = file.name; link.click();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1_000); setShareFeedback("シェア用画像を保存しました");
}

async function copyShareText() {
  const text = `${shareText()}\n${shareUrl()}`;
  if (navigator.clipboard) await navigator.clipboard.writeText(text);
  else {
    const textarea = document.createElement("textarea"); textarea.value = text; textarea.style.position = "fixed"; textarea.style.opacity = "0";
    document.body.appendChild(textarea); textarea.select(); document.execCommand("copy"); textarea.remove();
  }
  setShareFeedback("文章をコピーしました");
}

async function submitScore() {
  if (!finalScore || !rankingSubmit || !rankingName?.value.trim()) return;
  rankingSubmit.disabled = true;
  try {
    await submitRankingEntry({ gameId: DEEP_SEA_SALVAGE.id, elapsedTimeMs: Math.round(elapsed * 1000), cleared, score: finalScore, maxLevel: Math.floor(maxDepth), defeatedBossCount: cleared ? 1 : 0, clientVersion: DEEP_SEA_SALVAGE.currentVersion });
    rankingPanel?.classList.add("is-submitted"); if (rankingHeading) rankingHeading.textContent = "スコアランキング"; await loadRanking();
  } catch { if (rankingResult) rankingResult.textContent += " / ランキングAPIに接続できません"; rankingSubmit.disabled = false; }
}

async function loadRanking() {
  try { renderRanking(await fetchScoreRanking(DEEP_SEA_SALVAGE.id, 20, DEEP_SEA_SALVAGE.currentVersion)); }
  catch { for (const element of [rankingList, rankingSubmitList]) if (element) element.innerHTML = '<tr><td colspan="4">ランキングAPI未接続</td></tr>'; }
}
function renderRanking(entries: Awaited<ReturnType<typeof fetchScoreRanking>>) {
  const html = entries.map((entry, index) => `<tr><td>${index + 1}</td><td>${escapeHtml(entry.player_name)}</td><td>${entry.score.toLocaleString()}</td><td>${new Date(entry.created_at).toLocaleDateString("ja-JP")}</td></tr>`).join("") || '<tr><td colspan="4">まだ記録がありません</td></tr>';
  for (const element of [rankingList, rankingSubmitList]) if (element) element.innerHTML = html;
}
function escapeHtml(value: string) { const element = document.createElement("span"); element.textContent = value; return element.innerHTML; }

window.addEventListener("keydown", (event) => {
  keys.add(event.code); if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(event.code)) event.preventDefault();
  if (event.code === "KeyP") togglePause();
  if (event.code === "KeyF") toggleCollection();
  if (phase === "result" && event.code === "KeyR") retryFromResult();
});
window.addEventListener("keyup", (event) => keys.delete(event.code));
canvas.addEventListener("pointerdown", (event) => {
  if (collectionOpen && returnToResult) { toggleCollection(false); return; }
  const rect = canvas.getBoundingClientRect(); pointer.active = true; pointer.x = (event.clientX - rect.left) * W / rect.width; pointer.y = (event.clientY - rect.top) * H / rect.height;
});
canvas.addEventListener("pointermove", (event) => { if (pointer.active) { const rect = canvas.getBoundingClientRect(); pointer.x = (event.clientX - rect.left) * W / rect.width; pointer.y = (event.clientY - rect.top) * H / rect.height; } });
window.addEventListener("pointerup", () => { pointer.active = false; });
touchPause?.addEventListener("click", togglePause); touchCollection?.addEventListener("click", () => toggleCollection());
shareResultButton?.addEventListener("click", () => void shareResult()); resultCollectionButton?.addEventListener("click", () => toggleCollection(true));
shareNativeButton?.addEventListener("click", () => void shareWithDevice());
shareXButton?.addEventListener("click", () => window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(`${shareText()}\n${shareUrl()}`)}`, "_blank", "noopener,noreferrer"));
shareLineButton?.addEventListener("click", () => window.open(`https://line.me/R/msg/text/?${encodeURIComponent(`${shareText()}\n${shareUrl()}`)}`, "_blank", "noopener,noreferrer"));
shareBlueskyButton?.addEventListener("click", () => window.open(`https://bsky.app/intent/compose?text=${encodeURIComponent(`${shareText()}\n${shareUrl()}`)}`, "_blank", "noopener,noreferrer"));
shareSaveButton?.addEventListener("click", () => void saveShareImage());
shareCopyButton?.addEventListener("click", () => void copyShareText());
rankingRetry?.addEventListener("click", () => { retryFromResult(); showScreen("game"); });
rankingName?.addEventListener("input", () => { if (rankingSubmit) rankingSubmit.disabled = !rankingName.value.trim() || !finalScore; });
rankingSubmit?.addEventListener("click", () => void submitScore());
window.addEventListener("create-solo-cabinet", ((event: CustomEvent<{ gameId: string }>) => { if (event.detail?.gameId === DEEP_SEA_SALVAGE.id) startSoloButton?.click(); }) as EventListener);
window.addEventListener("platform-play-approved", ((event: CustomEvent<{ gameId: string }>) => { if (event.detail?.gameId === DEEP_SEA_SALVAGE.id) { resetRun(); showScreen("game"); lastTime = performance.now(); } }) as EventListener);
for (const id of ["back-to-arcade", "cabinet-breadcrumb-arcade", "game-back-to-arcade", "ranking-another-game"]) document.querySelector(`#${id}`)?.addEventListener("click", () => window.location.assign("/"));

function syncInitialScreen() { showScreen(window.location.pathname.startsWith("/cabinets/") ? "cabinet" : "arcade"); }
function loop(now: number) {
  const dt = Math.min(.05, (now - lastTime) / 1_000); lastTime = now;
  if (!document.hidden) { update(dt); draw(); }
  requestAnimationFrame(loop);
}
document.addEventListener("visibilitychange", () => { lastTime = performance.now(); });
initTerrainEditor();
resetRun();
if (debugParams.get("terrainEditor") === "1") {
  showScreen("game"); updateButtons();
}
else if (debugParams.get("surfacePreview") === "1") {
  showScreen("game"); updateButtons();
}
else if (debugParams.get("bossPractice") === "1") {
  subDepth = debugParams.has("startDepth") ? debugNumber("startDepth", 0) : Math.max(3_850, config.bossStart - 150);
  maxDepth = subDepth; nextBossDepth = config.bossStart; phase = "dive"; paused = false; showScreen("game"); updateButtons();
  if (debugParams.get("turnPractice") === "1") {
    subVx = -160;
    subHeadingTarget = Math.PI;
  }
  const headingPreview = debugParams.get("headingPreview");
  if (headingPreview === "front") subHeading = subHeadingTarget = Math.PI / 2;
  else if (headingPreview === "left") subHeading = subHeadingTarget = Math.PI;
  else if (headingPreview !== null && Number.isFinite(Number(headingPreview))) {
    subHeading = subHeadingTarget = clamp(Number(headingPreview), 0, 180) * Math.PI / 180;
  }
}
else syncInitialScreen();
void loadRanking(); requestAnimationFrame(loop);

export {};
