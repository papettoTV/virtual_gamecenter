import { BOSS_BODY_RADIUS_X, BOSS_BODY_RADIUS_Y, BOSS_TAIL, MAX_HULL, getFishSafetyVisual, getSubmarinePitch, getSubmarineLightLevel, getSeaLayer, getRetryScoreMultiplier, NORMAL_RESEARCH_RANGE } from "./core";
import type { Fish, Hazard } from "./live-state";
import type { DeepSeaThreeLayer, ThreeFrame } from "./three-game-layer";
import { SPECIES, speciesById, type Species } from "./species";
import type { State } from "./state";
import type { Simulation } from "./simulation";
import { clamp, fishRadius, formatTime } from "./utils";

export function createRenderer(canvas: HTMLCanvasElement, state: State, queries: Pick<Simulation, "screenY" | "getCurrentVelocity" | "isVentActive" | "canResearchBoss" | "dangerSpawnX">, debugParams: URLSearchParams, isWatching: () => boolean) {
  const ctx = canvas.getContext("2d")!;
  const W = canvas.width;
  const H = canvas.height;
  const SUB_Y = H * .57;
  const { screenY, getCurrentVelocity, isVentActive, canResearchBoss, dangerSpawnX } = queries;
  function isCompactCanvas() { const rect = canvas.getBoundingClientRect(); return rect.height > rect.width * 1.2; }
  const darknessCanvas = document.createElement("canvas");
  darknessCanvas.width = W; darknessCanvas.height = H;
  const darknessCtx = darknessCanvas.getContext("2d")!;
  let threeLayer: DeepSeaThreeLayer | null = null;
  let disposed = false;
  const speciesIcons = new Map<string, HTMLImageElement>(SPECIES.map((species) => {
    const image = new Image(); image.decoding = "async";
    image.src = `/assets/deep-sea-salvage/encyclopedia/${species.id}.png`;
    return [species.id, image];
  }));

  function draw() {
    if (disposed) return;
    drawBackground();
    const renderedInThree = drawThreeGameObjects();
    if (!renderedInThree) {
      for (const hazard of state.hazards) { const sy = screenY(hazard.depth); if (sy > -hazard.height - 50 && sy < H + hazard.height + 50) drawHazard(hazard, sy); }
      for (const fish of state.fishes) { const sy = screenY(fish.depth); if (sy > 62 && sy < H + 50) drawFish(fish, sy); }
      if (state.boss.active) drawBoss();
    } else drawThreeFishLabels();
    drawCurrentSignals(); drawDarkness(); drawHazardSignals(); drawDeepSignals(); drawFishSafetySignals(renderedInThree); drawBossSignal(renderedInThree);
    if (!renderedInThree) drawSubmarine(); else drawThreeSubmarineSignals();
    drawHud();
    if ((state.boss.active && state.bossGaugeVisible) || state.phase === "boss-clear") drawBossResearchGauge();
    if (state.phase === "ready" && debugParams.get("terrainPreview") !== "1") drawStartOverlay();
    if (state.paused && state.phase === "dive" && !state.collectionOpen) drawCollection("pause");
    if (state.phase === "result" && !state.collectionOpen) drawOverlay(state.message, [`SCORE ${state.finalScore.toLocaleString()}`, isWatching() ? "プレイヤーの選択を待っています" : `図鑑 ${state.discovered.size} / 21　最大深度 ${Math.floor(state.maxDepth).toLocaleString()}m`]);
    if (state.phase === "boss-clear") drawBossClearSequence();
    if (state.phase === "hull-break") drawHullBreakSequence();
    if (state.collectionOpen) drawCollection();
  }

  function drawThreeGameObjects() {
    if (!threeLayer) return false;
    const breaking = state.phase === "hull-break";
    const submarineAlpha = breaking ? Math.max(0, 1 - state.hullBreakTimer / 1.35) : state.invincible > 0 && Math.floor(state.invincible * 10) % 2 ? .35 : 1;
    const visibleFishes = state.fishes.flatMap((fish) => {
      const y = screenY(fish.depth); if (y < 55 || y > H + 55) return [];
      const species = speciesById.get(fish.speciesId)!;
      const radius = fishRadius(species); const distance = Math.hypot(fish.x - state.subX, y - SUB_Y);
      const darkness = debugParams.get("terrainPreview") === "1" && state.phase === "ready" ? 0 : clamp(state.subDepth / 3500, 0, 1) * .965;
      const visibility = Math.max(1 - darkness, clamp((210 - distance) / 65, 0, 1));
      const preparingAmbush = fish.pattern === "ambush" && !fish.completed && !fish.activated && fish.alertTimer > 0;
      const safety = getFishSafetyVisual(fish.completed, preparingAmbush ? 0 : distance, radius, state.elapsed);
      return [{
        id: fish.id, speciesId: species.id, x: fish.x, y, radius, direction: fish.vx < 0 ? -1 as const : 1 as const,
        color: species.color, glow: species.glow, known: fish.completed || state.discovered.has(species.id), completed: fish.completed, rare: Boolean(species.rare),
        outlineAlpha: safety.showOutline ? safety.alpha * visibility : 0, outlineWarning: safety.warning,
      }];
    });
    // Keep the complete edited course resident in the Three.js scene. Objects are
    // frustum-culled instead of being destroyed and recreated while scrolling.
    const terrainHazards = state.hazards.map((hazard) => ({
      id: hazard.id, kind: hazard.kind, x: hazard.x + (hazard.kind === "rock" ? hazard.width / 2 : 0),
      y: screenY(hazard.depth), width: hazard.width, height: hazard.height,
      topWidth: hazard.topWidth, bottomWidth: hazard.bottomWidth,
      side: hazard.side, active: hazard.kind !== "vent" || isVentActive(hazard),
    }));
    const frame: ThreeFrame = {
      elapsed: state.elapsed,
      submarine: {
        x: state.subX, y: SUB_Y, heading: state.subHeading, pitch: getSubmarinePitch(state.subVDepth, state.subHeading), alpha: submarineAlpha, hull: state.hull,
        lightLevel: getSubmarineLightLevel(state.subDepth),
        breaking, breakProgress: breaking ? clamp(state.hullBreakTimer / 1.8, 0, 1) : 0,
      },
      fishes: visibleFishes,
      hazards: terrainHazards,
      boss: { active: state.boss.active, x: state.boss.x, y: screenY(state.boss.depth), direction: state.boss.direction, flash: state.boss.flash, revealed: state.phase === "boss-clear" },
    };
    try { ctx.drawImage(threeLayer.render(frame), 0, 0, W, H); }
  catch (error) {
      console.warn("Three.js gameplay render failed; returning to the 2D renderer.", error);
      threeLayer.dispose(); threeLayer = null;
      return false;
    }
    return true;
  }

  function drawThreeFishLabels() {
    ctx.save(); ctx.fillStyle = "rgba(235,249,255,.78)"; ctx.font = "900 22px system-ui"; ctx.textAlign = "center";
    for (const fish of state.fishes) {
      const species = speciesById.get(fish.speciesId)!; const y = screenY(fish.depth);
      if (fish.completed || state.discovered.has(species.id) || y < 65 || y > H) continue;
      ctx.fillText("?", fish.x, y - fishRadius(species) - 12);
    }
    for (const fish of state.fishes) {
      const species = speciesById.get(fish.speciesId)!; const y = screenY(fish.depth); const radius = fishRadius(species);
      if (y < 65 || y > H || (fish.completed || (!state.targetFishIds.has(fish.id) && fish.research <= 0))) continue;
      ctx.fillStyle = "rgba(255,255,255,.24)"; ctx.fillRect(fish.x - 32, y - radius - 22, 64, 5);
      ctx.fillStyle = "#65ffe9"; ctx.fillRect(fish.x - 32, y - radius - 22, 64 * clamp(fish.research, 0, 1), 5);
    }
    ctx.restore();
  }

  function drawThreeSubmarineSignals() {
    if (state.phase !== "ready") {
      ctx.save(); ctx.strokeStyle = "rgba(101,255,233,.24)"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(state.subX, SUB_Y, NORMAL_RESEARCH_RANGE, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
    }
    if (state.phase === "ready" || state.hull >= MAX_HULL) return;
    const bubbleCount = state.hull === 1 ? 5 : 2;
    ctx.save(); ctx.strokeStyle = "rgba(176,241,255,.72)"; ctx.lineWidth = 1;
    for (let i = 0; i < bubbleCount; i += 1) {
      const age = (state.elapsed * (30 + i * 4) + i * 13) % 35;
      ctx.beginPath(); ctx.arc(state.subX - 8 + i * 4, SUB_Y - 10 - age, 1.5 + i % 2, 0, Math.PI * 2); ctx.stroke();
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
        ctx.bezierCurveTo(x + Math.sin(state.elapsed * 1.3 + hazard.phase + i) * 18, sy - hazard.height * .35, x - 18, sy - hazard.height * .68, x + Math.sin(state.elapsed + i) * 12, sy - hazard.height);
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
      const x = ((i * 137 + state.elapsed * velocity * 2) % (W + 120) + W + 120) % (W + 120) - 60;
      const y = 90 + i * 43 % (H - 150); const length = 24 + i % 4 * 11;
      ctx.beginPath(); ctx.moveTo(x - direction * length, y); ctx.lineTo(x, y); ctx.stroke();
    }
    ctx.restore();
  }

  function drawHazardSignals() {
    for (const hazard of state.hazards) {
      if (hazard.kind !== "vent" || !isVentActive(hazard)) continue;
      const sy = screenY(hazard.depth); if (sy < 65 || sy > H + hazard.height) continue;
      ctx.save(); ctx.fillStyle = "#ff9a63"; ctx.shadowColor = "#ff633e"; ctx.shadowBlur = 22;
      for (let i = 0; i < 8; i += 1) {
        const progress = ((state.elapsed * .65 + hazard.phase * .13 + i / 8) % 1);
        const x = hazard.x + Math.sin(progress * 12 + i) * (8 + progress * 18);
        const y = sy - 48 - progress * (hazard.height - 42);
        ctx.globalAlpha = .8 * (1 - progress); ctx.beginPath(); ctx.arc(x, y, 3 + progress * 5, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
    }
  }

  function drawBackground() {
    const { top, bottom, particleAlpha } = oceanPalette(state.subDepth);
    const gradient = ctx.createLinearGradient(0, 0, 0, H); gradient.addColorStop(0, top); gradient.addColorStop(1, bottom);
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, W, H);
    ctx.save(); ctx.globalAlpha = particleAlpha;
    for (let i = 0; i < 55; i += 1) {
      const x = (i * 151 + state.elapsed * (7 + i % 4)) % W;
      const y = 70 + ((i * 89 - state.subDepth * (.12 + i % 3 * .03)) % (H - 70) + (H - 70)) % (H - 70);
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
        const y = surfaceY + row * 7 + Math.sin(x * .055 + state.elapsed * 2.3 + row) * (2.5 - row * .5);
        if (x === -20) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.globalAlpha = .75 - row * .2; ctx.stroke();
    }
    ctx.restore();
  }

  function drawFish(fish: Fish, sy: number) {
    const species = speciesById.get(fish.speciesId)!;
    const known = fish.completed || state.discovered.has(species.id);
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
    if (state.targetFishIds.has(fish.id) || (!fish.completed && fish.research > 0)) {
      ctx.fillStyle = "rgba(255,255,255,.24)"; ctx.fillRect(-32, -radius - 22, 64, 5);
      ctx.fillStyle = "#65ffe9"; ctx.fillRect(-32, -radius - 22, 64 * clamp(fish.research, 0, 1), 5);
    }
    ctx.restore();
  }

  function drawFishSafetySignals(exactThreeOutline = false) {
    const darkness = debugParams.get("terrainPreview") === "1" && state.phase === "ready" ? 0 : clamp(state.subDepth / 3500, 0, 1) * .965;
    for (const fish of state.fishes) {
      const sy = screenY(fish.depth);
      if (sy < 76 || sy > H - 35) continue;
      const species = speciesById.get(fish.speciesId)!; const radius = fishRadius(species);
      const distance = Math.hypot(fish.x - state.subX, sy - SUB_Y);
      const visibility = Math.max(1 - darkness, clamp((210 - distance) / 65, 0, 1));
      if (visibility < .08) continue;
      const preparingAmbush = fish.pattern === "ambush" && !fish.completed && !fish.activated && fish.alertTimer > 0;
      const visual = getFishSafetyVisual(fish.completed, preparingAmbush ? 0 : distance, radius, state.elapsed);
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
    const sy = screenY(state.boss.depth);
    const revealed = state.phase === "boss-clear";
    ctx.save(); ctx.translate(state.boss.x, sy); if (state.boss.direction < 0) ctx.scale(-1, 1);
    ctx.shadowColor = revealed ? "#67dff4" : "#244b77"; ctx.shadowBlur = revealed ? 58 : 40; ctx.fillStyle = revealed ? "#327492" : "#14243d";
    ctx.beginPath(); ctx.ellipse(0, 0, BOSS_BODY_RADIUS_X, BOSS_BODY_RADIUS_Y, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); BOSS_TAIL.forEach(([x, y], index) => { if (index === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); }); ctx.closePath(); ctx.fill();
    if (revealed) {
      ctx.strokeStyle = "rgba(143,255,244,.7)"; ctx.lineWidth = 8; ctx.shadowBlur = 16;
      for (let x = -210; x <= 80; x += 72) { ctx.beginPath(); ctx.arc(x, 2, 52, -.75, .75); ctx.stroke(); }
      ctx.fillStyle = "#204d70"; ctx.beginPath(); ctx.moveTo(-45, -94); ctx.lineTo(35, -178); ctx.lineTo(92, -94); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(-35, 94); ctx.lineTo(50, 164); ctx.lineTo(105, 92); ctx.closePath(); ctx.fill();
    }
    ctx.fillStyle = state.boss.flash > 0 ? "#ffffff" : "#ffce59"; ctx.shadowColor = "#ffce59"; ctx.shadowBlur = 28;
    ctx.beginPath(); ctx.arc(155, -18, 18, 0, Math.PI * 2); ctx.fill(); ctx.restore();
  }

  function drawBossResearchGauge() {
    const x = W / 2 - 210; const y = 75; const width = 420; const scanning = state.phase === "dive" && canResearchBoss();
    ctx.save();
    ctx.fillStyle = "rgba(0,8,18,.94)"; ctx.strokeStyle = scanning ? "#fff09a" : "rgba(128,220,235,.72)"; ctx.lineWidth = 2;
    ctx.fillRect(x - 10, y - 8, width + 20, 42); ctx.strokeRect(x - 10, y - 8, width + 20, 42);
    ctx.fillStyle = "rgba(255,255,255,.2)"; ctx.fillRect(x, y + 13, width, 11);
    ctx.fillStyle = state.phase === "boss-clear" ? "#7cfff0" : "#ffdc62"; ctx.fillRect(x, y + 13, width * state.bossProgress / 100, 11);
    ctx.fillStyle = "#f5ffff"; ctx.font = "900 14px system-ui"; ctx.textAlign = "center";
    ctx.fillText(state.phase === "boss-clear" ? "巨大魚調査 COMPLETE" : `巨大魚調査 ${Math.floor(state.bossProgress)}%${scanning ? "　解析中" : ""}`, W / 2, y + 6);
    ctx.restore();
  }

  function drawBossClearSequence() {
    const reveal = smoothstep(state.bossClearTimer / 1.4);
    const titleAlpha = smoothstep((state.bossClearTimer - .6) / 1);
    const clearAlpha = smoothstep((state.bossClearTimer - 2.1) / 1);
    ctx.save();
    ctx.fillStyle = `rgba(103,255,239,${.08 * reveal})`; ctx.fillRect(0, 64, W, H - 64);
    ctx.textAlign = "center"; ctx.shadowColor = "#62fff0"; ctx.shadowBlur = 28;
    ctx.globalAlpha = titleAlpha; ctx.fillStyle = "#dffffb"; ctx.font = "900 30px system-ui"; ctx.fillText("調査完了", W / 2, H - 112);
    ctx.globalAlpha = clearAlpha; ctx.fillStyle = "#ffe075"; ctx.font = "900 52px system-ui"; ctx.fillText("GAME CLEAR", W / 2, H / 2 - 142);
    ctx.font = "800 18px system-ui"; ctx.fillStyle = "#f3ffff"; ctx.fillText("リヴァイアサンを図鑑に登録しました", W / 2, H / 2 - 108);
    ctx.restore();
  }

  function drawDarkness() {
    if (state.phase === "ready" && debugParams.get("terrainPreview") === "1") return;
    const clearReveal = state.phase === "boss-clear" ? 1 - smoothstep(state.bossClearTimer / 1.4) : 1;
    const darkness = clamp(state.subDepth / 3_500, 0, 1) * .965 * clearReveal;
    if (darkness <= .03) return;
    darknessCtx.clearRect(0, 0, W, H); darknessCtx.globalCompositeOperation = "source-over";
    darknessCtx.fillStyle = `rgba(0,2,8,${darkness})`; darknessCtx.fillRect(0, 64, W, H - 64);
    darknessCtx.globalCompositeOperation = "destination-out";
    const radius = 270 - darkness * 115;
    const ambient = darknessCtx.createRadialGradient(state.subX, SUB_Y, 20, state.subX, SUB_Y, radius);
    ambient.addColorStop(0, "rgba(0,0,0,1)"); ambient.addColorStop(.55, "rgba(0,0,0,.82)"); ambient.addColorStop(1, "rgba(0,0,0,0)");
    darknessCtx.fillStyle = ambient; darknessCtx.beginPath(); darknessCtx.arc(state.subX, SUB_Y, radius, 0, Math.PI * 2); darknessCtx.fill();
    darknessCtx.globalCompositeOperation = "source-over"; ctx.drawImage(darknessCanvas, 0, 0);
  }

  function drawDeepSignals() {
    if (getSeaLayer(state.subDepth) !== 3) return;
    for (const fish of state.fishes) {
      const species = speciesById.get(fish.speciesId)!; const sy = screenY(fish.depth);
      if (sy < 65 || sy > H || Math.hypot(fish.x - state.subX, sy - SUB_Y) < 145) continue;
      ctx.save(); ctx.globalAlpha = fish.completed ? .4 : .35 + Math.sin(state.elapsed * 5 + fish.phase) * .15; ctx.fillStyle = fish.completed ? "#75e8ef" : species.glow; ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = 18;
      ctx.beginPath(); ctx.arc(fish.x + (fish.vx > 0 ? 8 : -8), sy - 2, species.rare ? 4 : 2.5, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    }
  }

  function drawBossSignal(renderedInThree = false) {
    if (!state.boss.active || state.phase === "boss-clear") return;
    const sy = screenY(state.boss.depth);
    if (renderedInThree) {
      const eyeX = state.boss.x + state.boss.direction * 155;
      ctx.save(); ctx.globalAlpha = .92; ctx.fillStyle = "#ffce59"; ctx.shadowColor = "#ffce59"; ctx.shadowBlur = 30;
      ctx.beginPath(); ctx.arc(eyeX, sy - 18, 16, 0, Math.PI * 2); ctx.fill(); ctx.restore();
      return;
    }
    ctx.save(); ctx.translate(state.boss.x, sy); if (state.boss.direction < 0) ctx.scale(-1, 1);
    ctx.globalAlpha = .28; ctx.fillStyle = "#315277"; ctx.shadowColor = "#487fb6"; ctx.shadowBlur = 35;
    ctx.beginPath(); ctx.ellipse(0, 0, BOSS_BODY_RADIUS_X, BOSS_BODY_RADIUS_Y, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); BOSS_TAIL.forEach(([x, y], index) => { if (index === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); }); ctx.closePath(); ctx.fill();
    ctx.globalAlpha = .92; ctx.fillStyle = "#ffce59"; ctx.shadowColor = "#ffce59"; ctx.shadowBlur = 30;
    ctx.beginPath(); ctx.arc(155, -18, 18, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  function drawSubmarine() {
    const yaw = clamp(state.subHeading, 0, Math.PI);
    const side = Math.cos(yaw);
    const sideAmount = Math.abs(side);
    const bowTowardViewer = Math.sin(yaw);
    const bodyRadiusX = 15 + 17 * sideAmount;
    const bodyRadiusY = 14 + 3 * bowTowardViewer;
    const pitch = getSubmarinePitch(state.subVDepth, yaw);
    const breaking = state.phase === "hull-break";
    const shake = breaking ? Math.max(0, 1 - state.hullBreakTimer / 1.1) : 0;
    const submarineAlpha = breaking ? Math.max(0, 1 - state.hullBreakTimer / 1.35) : state.invincible > 0 && Math.floor(state.invincible * 10) % 2 ? .35 : 1;
    ctx.save(); ctx.translate(state.subX + Math.sin(state.hullBreakTimer * 62) * 4 * shake, SUB_Y + Math.cos(state.hullBreakTimer * 49) * 3 * shake); ctx.rotate(pitch);
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
      if (state.hull >= MAX_HULL) return;
      const surfaceFacing = surfaceSide * side;
      if (surfaceFacing <= .02) return;
      ctx.save();
      // The crack lies on each side of the curved hull: it becomes edge-on during
      // the turn, then its counterpart on the other side comes into view.
      ctx.translate(-7 * side, 1);
      ctx.scale(surfaceFacing, 1);
      ctx.globalAlpha *= .45 + surfaceFacing * .55;
      ctx.strokeStyle = state.hull === 1 ? "#ffd0aa" : "#ff9d79"; ctx.lineWidth = .75;
      ctx.shadowColor = state.hull === 1 ? "#ff3a32" : "#ff6a48"; ctx.shadowBlur = state.hull === 1 ? 5 : 3;
      ctx.lineCap = "round"; ctx.lineJoin = "round";
      // First damage: several fine, branching fractures instead of one short line.
      ctx.beginPath();
      ctx.moveTo(-11, 5); ctx.lineTo(-6, 1); ctx.lineTo(-1, -1); ctx.lineTo(2, -7); ctx.lineTo(1, -11);
      ctx.moveTo(-6, 1); ctx.lineTo(-8, -5); ctx.lineTo(-5, -9);
      ctx.moveTo(-1, -1); ctx.lineTo(5, 1); ctx.lineTo(10, -2);
      ctx.moveTo(5, 1); ctx.lineTo(8, 6); ctx.lineTo(13, 8);
      ctx.moveTo(-1, -1); ctx.lineTo(-2, 6); ctx.lineTo(-6, 10);
      if (state.hull === 1) {
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
    if (state.phase !== "ready" && state.hull < MAX_HULL) {
      const bubbleCount = state.hull === 1 ? 5 : 2;
      ctx.save(); ctx.strokeStyle = "rgba(176,241,255,.72)"; ctx.lineWidth = 1;
      for (let i = 0; i < bubbleCount; i += 1) {
        const age = (state.elapsed * (30 + i * 4) + i * 13) % 35;
        ctx.beginPath(); ctx.arc(state.subX - 8 + i * 4, SUB_Y - 10 - age, 1.5 + i % 2, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.restore();
    }
    if (state.phase !== "ready") {
      ctx.strokeStyle = "rgba(101,255,233,.24)"; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(state.subX, SUB_Y, NORMAL_RESEARCH_RANGE, 0, Math.PI * 2); ctx.stroke();
    }
  }

  function drawHullBreakSequence() {
    const t = state.hullBreakTimer;
    const burst = smoothstep(Math.min(1, t / 1.8));
    const flash = Math.max(0, 1 - t / .55);
    ctx.save();
    ctx.fillStyle = `rgba(255,70,55,${flash * .16})`; ctx.fillRect(0, 64, W, H - 98);
    ctx.translate(state.subX, SUB_Y);
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
        ctx.fillStyle = i < state.hull ? "#7aff9b" : "#5a1d29";
        ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = i < state.hull ? 7 : 0;
        ctx.beginPath(); ctx.arc(startX + i * 15, y, 5, 0, Math.PI * 2); ctx.fill();
      }
      ctx.shadowBlur = 0;
    };
    if (isCompactCanvas()) {
      ctx.fillText(`深度 ${Math.floor(state.subDepth).toLocaleString()}m`, 326, 25); ctx.fillText(`POWER ${Math.ceil(state.power)}%`, 514, 25);
      ctx.fillText(`SCORE ${state.earnedScore.toLocaleString()}`, 326, 49); ctx.fillText(`BOSS ${Math.floor(state.bossProgress)}%`, 514, 49);
      ctx.fillStyle = "#63f4d9"; ctx.fillRect(326, 57, 330 * state.power / 100, 5);
      drawHullLamps(704, 24);
    } else {
    ctx.fillText(`深度 ${Math.floor(state.subDepth).toLocaleString()}m`, 22, 25); ctx.fillText(`最高 ${Math.floor(state.maxDepth).toLocaleString()}m`, 22, 49);
    ctx.fillText(`図鑑 ${state.discovered.size}/21`, 200, 25);
    const current = getCurrentVelocity();
    if (current) { ctx.fillStyle = "#8fefff"; ctx.fillText(`潮流 ${current > 0 ? "→" : "←"} ${Math.round(Math.abs(current))}`, 200, 49); ctx.fillStyle = "#e9ffff"; }
    ctx.fillText(`SCORE ${state.earnedScore.toLocaleString()}`, 330, 25); ctx.fillText(`CONTINUE ×${getRetryScoreMultiplier(state.retryCount).toFixed(2)}`, 330, 49);
    ctx.fillText(`BOSS ${Math.floor(state.bossProgress)}%`, 555, 25); ctx.fillText(`TIME ${formatTime(state.elapsed)}`, 555, 49);
    drawHullLamps(730, 24);
    const barX = W - 28; const barY = 82; const barH = H - 132;
    ctx.fillStyle = "rgba(2,10,18,.88)"; ctx.fillRect(barX - 7, barY - 7, 22, barH + 14);
    ctx.fillStyle = state.power > 25 ? "#63f4d9" : "#ff526f"; ctx.fillRect(barX, barY + barH * (1 - state.power / 100), 8, barH * state.power / 100);
    ctx.save(); ctx.translate(barX - 11, H / 2); ctx.rotate(-Math.PI / 2); ctx.fillStyle = "#efffff"; ctx.textAlign = "center"; ctx.font = "900 12px system-ui"; ctx.fillText(`POWER ${Math.ceil(state.power)}%`, 0, 0); ctx.restore();
    }
    ctx.fillStyle = "rgba(1,10,18,.8)"; ctx.fillRect(0, H - 34, W, 34); ctx.fillStyle = state.messageTimer > 0 ? "#ffe48b" : "#8eb7bd"; ctx.textAlign = "center";
    const message = isWatching() && state.phase === "ready" ? "プレイヤーの開始を待っています" : state.messageTimer > 0 ? state.message : "魚を調査して電力を補充";
    ctx.fillText(message, W / 2, H - 12); ctx.textAlign = "left";
  }

  function drawCollection(mode: "collection" | "pause" = "collection") {
    ctx.fillStyle = "rgba(0,5,13,.96)"; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#6effe9"; ctx.font = "900 34px system-ui"; ctx.textAlign = "center"; ctx.fillText(`${mode === "pause" ? "PAUSED　" : ""}今回の調査図鑑　${state.discovered.size} / 21`, W / 2, 48);
    const cols = 7; const cellW = 122; const cellH = 156; const startX = (W - cols * cellW) / 2;
    SPECIES.forEach((species, index) => {
      const col = index % cols; const row = Math.floor(index / cols); const x = startX + col * cellW; const y = 76 + row * cellH; const known = state.discovered.has(species.id);
      ctx.fillStyle = known ? "rgba(30,72,90,.72)" : "rgba(255,255,255,.055)"; ctx.strokeStyle = species.rare && known ? "#ffd65c" : known ? "#5fffea" : "rgba(255,255,255,.16)";
      ctx.lineWidth = species.boss ? 3 : 1; ctx.fillRect(x + 4, y, cellW - 8, cellH - 9); ctx.strokeRect(x + 4, y, cellW - 8, cellH - 9);
      drawSpeciesPortrait(ctx, species, known, x + 10, y + 10, cellW - 20, 84);
      ctx.fillStyle = known ? "#eaffff" : "#76828c"; ctx.font = "800 12px system-ui"; ctx.textAlign = "center"; ctx.fillText(known ? species.name : "？", x + cellW / 2, y + 112);
      if (species.boss || species.rare) {
        ctx.fillStyle = species.boss ? "#ffce59" : "#e9b5ff"; ctx.font = "700 10px system-ui"; ctx.fillText(species.boss ? "BOSS" : "RARE", x + cellW / 2, y + 134);
      }
    });
    const footer = isWatching()
      ? mode === "pause" ? "プレイヤーの再開を待っています" : "プレイヤーが図鑑を表示しています"
      : mode === "pause" ? "P / 一時停止ボタンで再開" : state.returnToResult ? "F / クリックでリザルトへ戻る" : "F / 図鑑ボタンで閉じる";
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
    if (isWatching()) {
      drawOverlay("LIVE", ["プレイヤーの開始を待っています"]);
      return;
    }
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

  return {
    draw, drawOverlay, drawSpeciesPortrait,
    setThreeLayer(layer: DeepSeaThreeLayer) {
      if (disposed) { layer.dispose(); return; }
      if (threeLayer !== layer) threeLayer?.dispose();
      threeLayer = layer;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      threeLayer?.dispose(); threeLayer = null;
      for (const icon of speciesIcons.values()) icon.src = "";
      speciesIcons.clear();
      darknessCanvas.width = 0; darknessCanvas.height = 0;
    },
  };
}
