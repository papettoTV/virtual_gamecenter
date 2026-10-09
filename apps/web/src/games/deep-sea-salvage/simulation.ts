import {
  MAX_HULL,
  getRetryScoreMultiplier,
  FISH_PATTERNS,
  canFishCollide,
  damageHull,
  isBossBodyColliding,
  isBossBodyResearchable,
  getFishSpawnMultiplier,
  getBossWobbleDepth,
  calculateFinalScore,
  crossedBossDepth,
  getResearchRewardMultiplier,
  getCurrentStrength,
  getPowerDrainMultiplier,
  getRareSpawnRate,
  getSeaLayer,
  getRegularFishSpawnCount,
  getSubmarineHeadingTarget,
  NORMAL_RESEARCH_RANGE,
} from "./core";
import { circleHitsTerrainWall, findTerrainRecesses, terrainWallSegments, terrainWidthsAt, type TerrainCourse } from "./terrain";
import type { Fish, Hazard } from "./live-state";
import { speciesById, regularByLayer, rareSpecies, type Species } from "./species";
import type { State } from "./state";
import { clamp, fishRadius } from "./utils";

export type SimulationConfig = {
  initialPower: number; powerDrain: number; rareRate2: number; rareRate3: number;
  researchScale: number; bossStart: number; bossInterval: number;
};

export type SimulationInput = { keys: Set<string>; pointer: { active: boolean; x: number; y: number } };

export type RunOptions = { startDepth: number; hull: number; bossProgress: number; terrainPreview: boolean };

export function createSimulation(state: State, config: SimulationConfig, input: SimulationInput, viewport: { width: number; height: number; horizontalBounds: () => [number, number] }, effects: { updateButtons: () => void; onFinish: (title: string, multiplier: number) => void }) {
  const W = viewport.width;
  const H = viewport.height;
  const SUB_Y = H * .57;
  const CHUNK_DEPTH = 400;
  const { keys, pointer } = input;
  const { horizontalBounds } = viewport;
  const { updateButtons, onFinish } = effects;

  function reset(course: TerrainCourse, options: RunOptions) {
    state.phase = "ready"; state.paused = true; state.collectionOpen = false; state.returnToResult = false;
    state.elapsed = 0; state.subX = W / 2; state.subDepth = Math.max(0, options.startDepth); state.maxDepth = state.subDepth;
    state.subVx = 0; state.subVDepth = 0; state.subHeading = 0; state.subHeadingTarget = 0; state.invincible = 0;
    state.hull = clamp(Math.round(options.hull), 1, MAX_HULL); state.power = config.initialPower;
    state.earnedScore = 0; state.finalScore = 0; state.finalSubtotal = 0; state.cleared = false; state.retryCount = 0;
    state.nextFishId = 1; state.nextHazardId = 1; state.nextBossDepth = Math.max(config.bossStart, state.subDepth + 200); state.bossProgress = options.bossProgress;
    state.boss = { active: false, x: 0, depth: 0, baseDepth: 0, direction: 1, flash: 0, wobbleAmplitude: 0, wobbleFrequency: 0, wobblePhase: 0 }; state.bossClearTimer = 0; state.hullBreakTimer = 0; state.bossGaugeVisible = false;
    state.fishes = []; state.terrainCourse = course; state.hazards = buildTerrainHazards(course); state.targetFishIds = new Set(); state.visitedChunks = new Set(); state.discovered = new Set(); state.researchCounts = new Map(); state.hazardMessageCooldown = 0;
    if (options.terrainPreview) {
      const widths = terrainWidthsAt(course, state.subDepth);
      state.subX = (widths.left + W - widths.right) / 2;
    }
  }

  function startDive() {
    if (state.phase === "result") return;
    state.phase = "dive"; state.paused = false; setMessage("魚を調査して電力をつなぎ、深海へ潜れ", 3); updateButtons();
  }

  function continueRun() {
    state.retryCount += 1; state.bossProgress = 0; state.boss.active = false; state.bossGaugeVisible = false; state.power = Math.max(65, config.initialPower * .65);
    state.invincible = 3; state.hull = MAX_HULL; state.subX = findSafeRetryX(); state.subVx = 0; state.subVDepth = 0; state.subHeading = 0; state.subHeadingTarget = 0; state.targetFishIds = new Set();
    state.fishes = state.fishes.filter((fish) => Math.hypot(fish.x - state.subX, screenY(fish.depth) - SUB_Y) > 210);
    state.phase = "dive"; state.paused = false; state.cleared = false; state.finalScore = 0; state.finalSubtotal = 0;
    setMessage(`CONTINUE　最終スコア倍率 ${(getRetryScoreMultiplier(state.retryCount) * 100).toFixed(0)}%`, 3);
  }

  function ensureChunks() {
    if (state.boss.active) return;
    const center = Math.floor(state.subDepth / CHUNK_DEPTH);
    for (let chunk = Math.max(0, center - 2); chunk <= center + 3; chunk += 1) {
      if (state.visitedChunks.has(chunk)) continue;
      state.visitedChunks.add(chunk); spawnChunk(chunk);
    }
    state.fishes = state.fishes.filter((fish) => Math.abs(fish.depth - state.subDepth) < 2_400);
  }

  function spawnChunk(chunk: number) {
    const baseDepth = chunk * CHUNK_DEPTH;
    const layer = getSeaLayer(baseDepth + CHUNK_DEPTH / 2);
    const chunkHazards = state.hazards.filter((hazard) => Math.abs(hazard.depth - (baseDepth + CHUNK_DEPTH / 2)) <= CHUNK_DEPTH);
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
    const widths = terrainWidthsAt(state.terrainCourse, hazard.hollowDepth ?? hazard.depth);
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
      built.push({ id: state.nextHazardId++, kind: "rock", x: 0, depth, width: leftWidth, height, topWidth: from.left, bottomWidth: to.left, phase: index * .73, dangerous: Boolean(leftRecess), side: -1, hollowDepth: leftRecess?.depth, hollowHeight: leftRecess ? 108 : undefined });
      built.push({ id: state.nextHazardId++, kind: "rock", x: W - rightWidth, depth, width: rightWidth, height, topWidth: from.right, bottomWidth: to.right, phase: index * .61, dangerous: Boolean(rightRecess), side: 1, hollowDepth: rightRecess?.depth, hollowHeight: rightRecess ? 108 : undefined });
    }
    for (const feature of course.features) {
      const widths = terrainWidthsAt(course, feature.depth); const side: -1 | 1 = feature.side === "left" ? -1 : 1;
      if (feature.kind === "vent") {
        built.push({ id: state.nextHazardId++, kind: "vent", x: side === -1 ? widths.left - 16 : W - widths.right + 16, depth: feature.depth, width: 82, height: 175, phase: feature.depth * .013, dangerous: true, side });
      } else {
        const width = 72;
        built.push({ id: state.nextHazardId++, kind: "kelp", x: side === -1 ? widths.left - width * .55 : W - widths.right - width * .45, depth: feature.depth, width, height: 165, phase: feature.depth * .009, dangerous: false, side });
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
    if (!inHollow && Math.abs(depth - state.subDepth) < 180 && Math.abs(x - state.subX) < 220) x = x < state.subX ? corridorLeft : corridorRight;
    const direction = Math.random() < .5 ? -1 : 1;
    state.fishes.push({
      id: state.nextFishId++, speciesId: species.id, x, depth, baseDepth: depth,
      vx: direction * species.speed * (.72 + Math.random() * .55), phase: Math.random() * Math.PI * 2,
      research: 0, completed: false, flash: 0, completionEffect: 0, pattern: FISH_PATTERNS[species.id], activated: false, alertTimer: 0, inHollow, homeX: x,
    });
  }

  function corridorBounds(depth: number): [number, number] {
    const walls = state.hazards.filter((hazard) => hazard.kind === "rock" && Math.abs(depth - hazard.depth) <= hazard.height / 2);
    const leftWall = walls.find((hazard) => hazard.side === -1);
    const rightWall = walls.find((hazard) => hazard.side === 1);
    const widths = terrainWidthsAt(state.terrainCourse, depth);
    return [leftWall ? widths.left + 42 : 75, rightWall ? W - widths.right - 42 : W - 75];
  }

  function update(dt: number) {
    state.messageTimer = Math.max(0, state.messageTimer - dt);
    if (state.phase === "boss-clear") { updateBossClear(dt); return; }
    if (state.phase === "hull-break") { updateHullBreak(dt); return; }
    if (state.paused || state.collectionOpen || state.phase !== "dive") return;
    state.elapsed += dt; state.invincible = Math.max(0, state.invincible - dt); state.hazardMessageCooldown = Math.max(0, state.hazardMessageCooldown - dt);
    state.power = Math.max(0, state.power - config.powerDrain * getPowerDrainMultiplier(state.subDepth) * dt);
    updateSubmarine(dt); ensureChunks(); updateHazards(dt); updateFishes(dt); updateBoss(dt); updateResearch(dt);
    state.maxDepth = Math.max(state.maxDepth, state.subDepth);
    if (crossedBossDepth(state.maxDepth, state.nextBossDepth, state.boss.active)) startBossPass();
    if (state.power <= 0) finish(false, "電力が尽きた");
  }

  function updateSubmarine(dt: number) {
    let dx = Number(keys.has("ArrowRight") || keys.has("KeyD")) - Number(keys.has("ArrowLeft") || keys.has("KeyA"));
    let dy = Number(keys.has("ArrowDown") || keys.has("KeyS")) - Number(keys.has("ArrowUp") || keys.has("KeyW"));
    if (pointer.active) { dx = (pointer.x - state.subX) / 90; dy = (pointer.y - SUB_Y) / 90; }
    const length = Math.hypot(dx, dy);
    if (length > 1) { dx /= length; dy /= length; }
    const currentX = getCurrentVelocity();
    const currentDepth = getCurrentStrength(state.subDepth) ? Math.cos(state.subDepth / 510 + state.elapsed * .31) * getCurrentStrength(state.subDepth) * .12 : 0;
    state.subVx += (dx * 225 + currentX - state.subVx) * Math.min(1, dt * 5);
    state.subVDepth += (dy * 92 + currentDepth - state.subVDepth) * Math.min(1, dt * 5);
    state.subHeadingTarget = getSubmarineHeadingTarget(dx, state.subHeadingTarget);
    state.subHeading += (state.subHeadingTarget - state.subHeading) * Math.min(1, dt * 4.2);
    const [leftBound, rightBound] = horizontalBounds();
    state.subX = clamp(state.subX + state.subVx * dt, leftBound, rightBound);
    state.subDepth = Math.max(0, state.subDepth + state.subVDepth * dt);
  }

  function getCurrentVelocity(depth = state.subDepth) {
    const strength = getCurrentStrength(depth);
    if (!strength) return 0;
    const flow = Math.sin(Math.floor(depth / 420) * 1.71 + state.elapsed * .22);
    return Math.sign(flow || 1) * strength * (.45 + Math.abs(flow) * .55);
  }

  function updateFishes(dt: number) {
    for (const fish of state.fishes) {
      const species = speciesById.get(fish.speciesId)!;
      fish.phase += dt * (species.rare ? 2.2 : .9);
      fish.flash = Math.max(0, fish.flash - dt);
      fish.completionEffect = Math.max(0, fish.completionEffect - dt);
      const currentDrift = getCurrentVelocity(fish.depth) * .28;
      if (fish.completed && fish.pattern === "ambush") {
        fish.activated = false; fish.alertTimer = 0;
        const leaveDirection = fish.x < state.subX ? -1 : 1;
        fish.vx += (leaveDirection * species.speed * 1.45 - fish.vx) * Math.min(1, dt * 3.2);
        fish.baseDepth += clamp(fish.baseDepth - state.subDepth, -1, 1) * species.speed * .18 * dt;
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
        const sy = screenY(fish.depth); const distance = Math.hypot(fish.x - state.subX, sy - SUB_Y);
        if (!fish.activated && distance < 265) {
          fish.alertTimer += dt; fish.flash = .08;
          if (fish.alertTimer >= .65) fish.activated = true;
        } else if (!fish.activated) fish.alertTimer = Math.max(0, fish.alertTimer - dt * .5);
        if (fish.activated) {
          const desiredDirection = state.subX < fish.x ? -1 : 1;
          fish.vx += (desiredDirection * species.speed * 1.18 - fish.vx) * Math.min(1, dt * 2.6);
          fish.baseDepth += clamp(state.subDepth - fish.baseDepth, -75, 75) * dt * .62;
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
      if (canFishCollide(fish.completed, state.invincible) && sy > 76 && sy < H - 35 && Math.hypot(fish.x - state.subX, sy - SUB_Y) < fishRadius(species) + 16) collide(fish.x);
    }
    state.fishes = state.fishes.filter((fish) => !(fish.completed && fish.pattern === "ambush" && (fish.x < -90 || fish.x > W + 90)));
  }

  function updateHazards(dt: number) {
    for (const hazard of state.hazards) {
      const sy = screenY(hazard.depth);
      if (sy < -hazard.height - 50 || sy > H + hazard.height + 50) continue;
      if (hazard.kind === "rock") {
        if (hitsRockWall(hazard, state.subX, SUB_Y, 18) && state.invincible <= 0) {
          collideHull("岩壁", hazard.x + hazard.width / 2);
        }
      } else if (hazard.kind === "kelp") {
        if (circleHitsRect(state.subX, SUB_Y, 16, hazard.x, sy - hazard.height, hazard.width, hazard.height)) {
          state.subVx *= Math.max(0, 1 - dt * 5); state.subVDepth *= Math.max(0, 1 - dt * 4); state.power = Math.max(0, state.power - dt * .7);
          if (state.hazardMessageCooldown <= 0) { setMessage("海藻に絡まった　推進力低下", 1.2); state.hazardMessageCooldown = 1.8; }
        }
      } else if (isVentActive(hazard)) {
        if (circleHitsRect(state.subX, SUB_Y, 17, hazard.x - hazard.width / 2, sy - hazard.height, hazard.width, hazard.height) && state.invincible <= 0) {
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
    state.hull = damageHull(state.hull); state.invincible = 2.2; state.subDepth = Math.max(0, state.subDepth - 7); state.subVDepth = -78;
    state.subVx = state.subX < sourceX ? -155 : 155;
    if (state.hull <= 0) beginHullBreak("船体が大破した");
    else setMessage(`${label}に接触　船体損傷`, 1.7);
  }

  function collideVent(hazard: Hazard) {
    const loss = 18;
    state.power = Math.max(0, state.power - loss); state.invincible = 2.2; state.subDepth = Math.max(0, state.subDepth - 7); state.subVDepth = -78;
    state.subVx = state.subX < hazard.x ? -155 : 155;
    setMessage(`熱水噴出　電力 -${loss}%`, 1.7);
  }

  function circleHitsRect(cx: number, cy: number, radius: number, x: number, y: number, width: number, height: number) {
    const nearestX = clamp(cx, x, x + width); const nearestY = clamp(cy, y, y + height);
    return Math.hypot(cx - nearestX, cy - nearestY) < radius;
  }

  function isVentActive(hazard: Hazard) {
    return (state.elapsed + hazard.phase) % 4.8 < 2.25;
  }

  function collide(sourceX: number, label = "魚") {
    state.hull = damageHull(state.hull); state.invincible = 2.2; state.subVx = sourceX < state.subX ? 180 : -180; state.subVDepth = -80;
    if (state.hull <= 0) beginHullBreak("船体が大破した");
    else setMessage(`${label}と衝突　船体損傷`, 1.6);
  }

  function chooseResearchTargets(): Fish[] {
    return state.fishes.filter((fish) => {
      if (fish.completed) return false;
      const sy = screenY(fish.depth);
      return sy > 76 && sy < H - 35 && Math.hypot(fish.x - state.subX, sy - SUB_Y) <= NORMAL_RESEARCH_RANGE;
    });
  }

  function updateResearch(dt: number) {
    const targets = chooseResearchTargets();
    state.targetFishIds = new Set(targets.map((fish) => fish.id));
    for (const fish of state.fishes) {
      if (!fish.completed && !state.targetFishIds.has(fish.id)) fish.research = Math.max(0, fish.research - dt * .18);
    }
    for (const target of targets) {
      const species = speciesById.get(target.speciesId)!;
      const knownSpeed = state.discovered.has(species.id) ? .55 : 1;
      target.research += dt / (species.research * knownSpeed * config.researchScale);
      if (target.research >= 1) completeResearch(species, target);
    }
    updateBossResearch(dt);
  }

  function completeResearch(species: Species, fish: Fish) {
    const count = state.researchCounts.get(species.id) ?? 0;
    const multiplier = getResearchRewardMultiplier(count);
    const first = count === 0;
    state.researchCounts.set(species.id, count + 1); state.discovered.add(species.id);
    const gainedScore = Math.floor(species.score * multiplier) + (first ? 300 : 0);
    const gainedPower = species.power * multiplier;
    state.earnedScore += gainedScore; state.power = Math.min(100, state.power + gainedPower);
    fish.research = 1; fish.completed = true; fish.flash = .7; fish.completionEffect = 1.6; state.targetFishIds.delete(fish.id);
    setMessage(first ? `図鑑登録　${species.name}  +${gainedScore}` : gainedScore ? `${species.name} 再調査 +${gainedScore}` : `${species.name} 調査済み（報酬なし）`, 1.8);
  }

  function startBossPass() {
    state.targetFishIds.clear();
    const direction: 1 | -1 = Math.floor(state.nextBossDepth / config.bossInterval) % 2 ? 1 : -1;
    const baseDepth = state.nextBossDepth + 120;
    state.boss = {
      active: true, x: direction === 1 ? -340 : W + 340, depth: baseDepth, baseDepth, direction, flash: 0,
      wobbleAmplitude: 55 + Math.random() * 35,
      wobbleFrequency: .62 + Math.random() * .34,
      wobblePhase: Math.random() * Math.PI * 2,
    };
    state.bossGaugeVisible = false;
    state.nextBossDepth += config.bossInterval;
    setMessage("巨大反応接近　胴体・尾の近くでも調査できる", 3);
  }

  function updateBoss(dt: number) {
    if (!state.boss.active) return;
    state.boss.x += state.boss.direction * 102 * dt; state.boss.flash = Math.max(0, state.boss.flash - dt);
    state.boss.depth = getBossWobbleDepth(state.boss.baseDepth, state.elapsed, state.boss.wobbleAmplitude, state.boss.wobbleFrequency, state.boss.wobblePhase);
    const sy = screenY(state.boss.depth);
    if (sy > -170 && sy < H + 170 && isBossBodyColliding(state.subX, SUB_Y, 17, state.boss.x, sy, state.boss.direction) && state.invincible <= 0) {
      collide(state.boss.x, "巨大深海魚");
    }
    if ((state.boss.direction === 1 && state.boss.x > W + 470) || (state.boss.direction === -1 && state.boss.x < -470)) {
      state.boss.active = false; setMessage(`巨大魚を見失った　調査 ${Math.floor(state.bossProgress)}%`, 2);
    }
  }

  function updateBossResearch(dt: number) {
    if (!canResearchBoss()) return;
    state.bossGaugeVisible = true;
    state.bossProgress = Math.min(100, state.bossProgress + dt * 6.5 / config.researchScale); state.boss.flash = .15;
    if (state.bossProgress >= 100) beginBossClear();
  }

  function beginBossClear() {
    if (state.phase !== "dive") return;
    state.discovered.add("leviathan"); state.researchCounts.set("leviathan", 1);
    state.phase = "boss-clear"; state.paused = false; state.bossClearTimer = 0; state.boss.flash = 1;
    state.boss.x = W / 2; state.boss.depth = state.subDepth + 28;
    state.boss.baseDepth = state.boss.depth; state.boss.wobbleAmplitude = 0;
    state.subVx = 0; state.subVDepth = 0; state.targetFishIds.clear();
    setMessage("巨大深海魚の調査完了", 99); updateButtons();
  }

  function beginHullBreak(title: string) {
    if (state.phase !== "dive") return;
    state.phase = "hull-break"; state.paused = false; state.hullBreakTimer = 0; state.hullBreakTitle = title;
    state.invincible = 99; state.subVx = 0; state.subVDepth = 0; state.targetFishIds.clear();
    setMessage("", 0); updateButtons();
  }

  function updateHullBreak(dt: number) {
    state.hullBreakTimer += dt; state.elapsed += dt;
    if (state.hullBreakTimer >= 3) finish(false, state.hullBreakTitle);
  }

  function updateBossClear(dt: number) {
    state.bossClearTimer += dt;
    state.boss.flash = Math.max(0, state.boss.flash - dt);
    if (state.bossClearTimer >= 5.8) finish(true, "巨大深海魚の調査完了");
  }

  function canResearchBoss() {
    if (!state.boss.active) return false;
    return isBossBodyResearchable(state.subX, SUB_Y, state.boss.x, screenY(state.boss.depth), state.boss.direction, W, H);
  }

  function finish(wasCleared: boolean, title: string) {
    if (state.phase === "result") return;
    state.phase = "result"; state.paused = true; state.cleared = wasCleared;
    const score = calculateFinalScore({ earnedScore: state.earnedScore, cleared: state.cleared, remainingPower: state.power, retryCount: state.retryCount });
    state.finalSubtotal = score.subtotal; state.finalScore = score.total;
    setMessage(title, 99); onFinish(title, score.multiplier); updateButtons();
  }

  function findSafeRetryX() {
    const [left, right] = horizontalBounds();
    const candidates = [W / 2, W / 2 - 110, W / 2 + 110, W / 2 - 220, W / 2 + 220].map((x) => clamp(x, left, right));
    return candidates.find((x) => !state.hazards.some((hazard) => {
      const sy = screenY(hazard.depth);
      if (hazard.kind === "rock") return hitsRockWall(hazard, x, SUB_Y, 38);
      if (hazard.kind === "kelp") return circleHitsRect(x, SUB_Y, 38, hazard.x, sy - hazard.height, hazard.width, hazard.height);
      return circleHitsRect(x, SUB_Y, 38, hazard.x - hazard.width / 2, sy - hazard.height, hazard.width, hazard.height);
    })) ?? W / 2;
  }

  function setMessage(text: string, seconds: number) { state.message = text; state.messageTimer = seconds; }

  function screenY(depth: number) { return SUB_Y + depth - state.subDepth; }

  return { reset, startDive, continueRun, update, ensureChunks, setMessage, screenY, getCurrentVelocity, isVentActive, canResearchBoss, dangerSpawnX };
}

export type Simulation = ReturnType<typeof createSimulation>;
