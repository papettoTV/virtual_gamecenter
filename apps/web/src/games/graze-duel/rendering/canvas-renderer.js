import { createCyberCanyonBackground } from "./cyber-canyon-background";
import { drawPlayerShip } from "./player-ship";
import { createBossAircraftSprites } from "./boss-aircraft";

export function createCanvasRenderer(options) {
  let { context, getAttackCost, randomRange, createLightningBolt } = options;
  const {
    WIDTH,
    HEIGHT,
    FIELD_TOP,
    FIELD_BOTTOM,
    FIELD_WIDTH,
    FIELD_HEIGHT,
    LEFT_X,
    RIGHT_X,
    BOSS_PHASES,
    MAX_LIVES,
    BULLET_GLOW_DISABLE_THRESHOLD,
    BULLET_GLOW_REDUCE_THRESHOLD,
    INVINCIBLE_WARNING_TIME,
    INVINCIBLE_RING_INNER_RADIUS,
    INVINCIBLE_RING_INNER_SCALE,
    HIT_MARKER_RADIUS,
  } = options.settings;
  const canyonBackground = createCyberCanyonBackground(FIELD_WIDTH, FIELD_HEIGHT);
  const bossAircraft = createBossAircraftSprites();
  let frame = null;

  return {
    render(nextFrame) {
      if (!context) return;
      frame = nextFrame;
      try {
        draw();
      } finally {
        frame = null;
      }
    },
    dispose() {
      canyonBackground.dispose();
      bossAircraft.dispose();
      context = null;
      frame = null;
      getAttackCost = null;
      randomRange = null;
      createLightningBolt = null;
    },
  };

  function draw() {
    context.clearRect(0, 0, WIDTH, HEIGHT);
    drawBackground();
    if (frame.compact) {
      drawCompactGame();
    } else {
      drawField(frame.players[0]);
      drawField(frame.players[1]);
      drawCenterInfo();
      drawBoss();
      if (frame.versusParticipant || frame.versusSpectator) drawOpponentBoss();
      drawBossSpawnHint();

      for (const player of frame.players) {
        drawBullets(player);
        if (!frame.sceneRendered) drawPlayer(player);
        drawPlayerHud(player);
      }
    }

    if (!frame.compact && !frame.sceneRendered) drawParticles();
    drawHitDebug();
    if (frame.paused) drawPaused();
    if (frame.gameOver) drawGameOver();
  }

  function drawCompactGame() {
    const playerIndex = frame.versusSpectator ? frame.spectatorPlayerIndex : 0;
    const selectedPlayer = frame.players[playerIndex];
    const otherPlayer = frame.players[playerIndex === 0 ? 1 : 0];
    withCompactWorldTransform(selectedPlayer, () => {
      drawField(selectedPlayer);
      if (playerIndex === 0) drawBoss();
      else drawOpponentBoss();
      drawBullets(selectedPlayer);
      if (!frame.sceneRendered) {
        drawPlayer(selectedPlayer);
        drawParticles();
      }
    });

    drawPlayerHud(selectedPlayer);
    drawOpponentInfoHud(otherPlayer);
    if (playerIndex === 0) drawBossSpawnHint();
    drawCenterInfo();
  }

  function withCompactWorldTransform(player, drawCallback) {
    context.save();
    const visibleSourceWidth = HEIGHT * (frame.clientWidth / Math.max(1, frame.clientHeight));
    const horizontalScale = visibleSourceWidth / FIELD_WIDTH;
    const verticalScale = (HEIGHT - 92) / FIELD_HEIGHT;
    const scale = clamp(Math.min(horizontalScale, verticalScale), 0.82, 1.05);
    const focusX = player.fieldX + FIELD_WIDTH / 2;
    const focusY = FIELD_TOP + FIELD_HEIGHT / 2;
    context.translate(WIDTH / 2, HEIGHT / 2 + 24);
    context.scale(scale, scale);
    context.translate(-focusX, -focusY);
    drawCallback();
    context.restore();
  }

  function drawBoss() {
    drawAircraftBoss(frame.boss, LEFT_X);
  }

  function drawOpponentBoss() {
    drawAircraftBoss(frame.opponentBoss, RIGHT_X);
  }

  function drawAircraftBoss(targetBoss, fieldX) {
    if (!targetBoss.active || targetBoss.hp <= 0) return;
    if (!frame.sceneRendered) {
      context.save();
      roundRect(fieldX, FIELD_TOP, FIELD_WIDTH, FIELD_HEIGHT, 18);
      context.clip();
      bossAircraft.draw(context, targetBoss);
      context.restore();
    }
    drawBossGauge(targetBoss, fieldX + FIELD_WIDTH / 2);
  }

  function drawBossGauge(targetBoss, labelX) {
    if (targetBoss.encounterState !== "active") return;
    const phase = BOSS_PHASES[targetBoss.phaseIndex] ?? BOSS_PHASES[0];
    const barWidth = 260;
    const barX = labelX - barWidth / 2;
    const hpRatio = clamp(targetBoss.hp / Math.max(1, targetBoss.maxHp), 0, 1);
    context.fillStyle = "rgba(0,0,0,0.46)";
    roundRect(barX, FIELD_TOP + 16, barWidth, 12, 8);
    context.fill();
    context.fillStyle = hpRatio > 0.35 ? "#ffd166" : "#ff4e8a";
    roundRect(barX, FIELD_TOP + 16, barWidth * hpRatio, 12, 8);
    context.fill();
    context.fillStyle = "#f4f7ff";
    context.font = "800 12px system-ui";
    context.textAlign = "center";
    context.fillText(phase.name, labelX, FIELD_TOP + 10);
    context.textAlign = "left";
  }

  function drawBossSpawnHint() {
    if (frame.bossEncounterInProgress || frame.clearGame || frame.boss.phaseIndex >= BOSS_PHASES.length) return;
    const nextPhase = BOSS_PHASES[frame.boss.phaseIndex];
    const compact = frame.compact;
    const labelX = compact ? WIDTH / 2 : LEFT_X + FIELD_WIDTH / 2;
    const labelWidth = compact ? 220 : 248;
    const label = compact
      ? `${nextPhase.name} AT LV ${frame.boss.nextSpawnLevel}`
      : `${nextPhase.name} APPEARS AT LV ${frame.boss.nextSpawnLevel}`;
    context.save();
    context.fillStyle = "rgba(0,0,0,0.38)";
    roundRect(labelX - labelWidth / 2, FIELD_TOP + 14, labelWidth, 26, 10);
    context.fill();
    context.fillStyle = "rgba(255,255,255,0.78)";
    context.font = "800 12px system-ui";
    context.textAlign = "center";
    context.fillText(label, labelX, FIELD_TOP + 32);
    context.restore();
  }

  function drawBackground() {
    const gradient = context.createLinearGradient(0, 0, 0, HEIGHT);
    gradient.addColorStop(0, "#040b16");
    gradient.addColorStop(1, "#071322");
    context.fillStyle = gradient;
    context.fillRect(0, 0, WIDTH, HEIGHT);

    if (frame.bossEncounterInProgress) {
      const dangerPulse = 0.08 + (Math.sin(frame.elapsedRound * 3.4) + 1) * 0.025;
      const dangerX = frame.compact ? WIDTH / 2 : frame.boss.x;
      const dangerGradient = context.createRadialGradient(dangerX, frame.boss.y, 20, dangerX, frame.boss.y, 440);
      dangerGradient.addColorStop(0, `rgba(110, 0, 30, ${dangerPulse + 0.08})`);
      dangerGradient.addColorStop(0.5, `rgba(55, 0, 20, ${dangerPulse})`);
      dangerGradient.addColorStop(1, "rgba(0, 0, 0, 0)");
      context.fillStyle = dangerGradient;
      context.fillRect(0, 0, WIDTH, HEIGHT);
    }

  }

  function drawField(player) {
    context.save();
    context.fillStyle = "rgba(0, 5, 15, 0.16)";
    context.strokeStyle = player.attackFlash > 0 ? player.color : "rgba(255,255,255,0.18)";
    context.lineWidth = player.attackFlash > 0 ? 4 : 2;
    roundRect(player.fieldX, FIELD_TOP, FIELD_WIDTH, FIELD_HEIGHT, 18);
    context.fill();
    context.stroke();
    context.clip();
    canyonBackground.draw(context, player.fieldX, FIELD_TOP, frame.elapsedRound);
    context.restore();
  }

  function drawBullets(player) {
    if (frame.sceneRendered) return;
    context.save();
    roundRect(player.fieldX, FIELD_TOP, FIELD_WIDTH, FIELD_HEIGHT, 18);
    context.clip();
    const playerIndex = frame.players.indexOf(player);
    const benchmarkBullets = frame.renderStressBulletsByPlayer[playerIndex] ?? [];
    const glowBlur = getBulletGlowBlur(player.bullets.length + benchmarkBullets.length);
    for (const bullets of [player.bullets, benchmarkBullets]) {
      for (const bullet of bullets) {
        context.save();
        if (bullet.type !== "base" && glowBlur > 0) {
          context.shadowBlur = glowBlur;
          context.shadowColor = bullet.color;
        }
        context.fillStyle = bullet.color;
        context.beginPath();
        drawBulletShape(bullet);
        context.restore();
      }
    }
    context.restore();
  }

  function getBulletGlowBlur(bulletCount) {
    if (bulletCount >= BULLET_GLOW_DISABLE_THRESHOLD) return 0;
    if (bulletCount >= BULLET_GLOW_REDUCE_THRESHOLD) return 4;
    return 10;
  }

  function drawBulletShape(bullet) {
    const shape = bullet.shape ?? "circle";
    if (shape === "diamond") {
      context.moveTo(bullet.x, bullet.y - bullet.radius * 1.25);
      context.lineTo(bullet.x + bullet.radius, bullet.y);
      context.lineTo(bullet.x, bullet.y + bullet.radius * 1.25);
      context.lineTo(bullet.x - bullet.radius, bullet.y);
      context.closePath();
      context.fill();
      return;
    }
    if (shape === "triangle") {
      context.moveTo(bullet.x, bullet.y - bullet.radius * 1.25);
      context.lineTo(bullet.x + bullet.radius * 1.1, bullet.y + bullet.radius);
      context.lineTo(bullet.x - bullet.radius * 1.1, bullet.y + bullet.radius);
      context.closePath();
      context.fill();
      return;
    }
    if (shape === "square") {
      context.rect(bullet.x - bullet.radius, bullet.y - bullet.radius, bullet.radius * 2, bullet.radius * 2);
      context.fill();
      return;
    }
    if (shape === "star") {
      for (let index = 0; index < 8; index += 1) {
        const angle = -Math.PI / 2 + (Math.PI * 2 * index) / 8;
        const radius = index % 2 === 0 ? bullet.radius * 1.35 : bullet.radius * 0.55;
        const x = bullet.x + Math.cos(angle) * radius;
        const y = bullet.y + Math.sin(angle) * radius;
        if (index === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      }
      context.closePath();
      context.fill();
      return;
    }
    if (shape === "pill") {
      context.ellipse(bullet.x, bullet.y, bullet.radius * 0.75, bullet.radius * 1.45, 0, 0, Math.PI * 2);
      context.fill();
      return;
    }
    if (shape === "line") {
      context.ellipse(bullet.x, bullet.y, bullet.radius * 0.45, bullet.radius * 1.8, bullet.rotation ?? 0, 0, Math.PI * 2);
      context.fill();
      return;
    }
    if (shape === "spinner") {
      const rotation = Math.floor(bullet.age * 24) * 0.35;
      context.ellipse(bullet.x, bullet.y, bullet.radius * 0.65, bullet.radius * 1.35, rotation, 0, Math.PI * 2);
      context.fill();
      return;
    }
    const radius = shape === "smallCircle" ? bullet.radius * 0.82 : bullet.radius;
    context.arc(bullet.x, bullet.y, radius, 0, Math.PI * 2);
    context.fill();
  }

  function drawPlayer(player) {
    context.save();
    const isLevelInvincible = player.levelUpInvincible > 0;
    const isHitInvincible = player.invincible > 0 && !isLevelInvincible;
    const invincibleBlink = Math.floor(frame.elapsedRound * 18) % 2 === 0;
    context.globalAlpha = isHitInvincible && invincibleBlink ? 0.45 : 1;
    if (isLevelInvincible) {
      context.save();
      const invincibleRatio = player.barrierRatio;
      const pulse = 0.55 + Math.sin(frame.elapsedRound * 18) * 0.22;
      const isWarning = player.levelUpInvincible <= INVINCIBLE_WARNING_TIME;
      const warningBlink = isWarning && Math.floor(frame.elapsedRound * 18) % 2 === 0;
      const warningAlpha = warningBlink ? 0.28 : 1;
      context.globalAlpha *= warningAlpha;
      const barrierRadius = INVINCIBLE_RING_INNER_RADIUS + invincibleRatio * INVINCIBLE_RING_INNER_SCALE + pulse * 5;
      const barrierGradient = context.createRadialGradient(player.x, player.y, 0, player.x, player.y, barrierRadius);
      barrierGradient.addColorStop(0, "rgba(105, 247, 255, 0.46)");
      barrierGradient.addColorStop(0.48, "rgba(105, 247, 255, 0.28)");
      barrierGradient.addColorStop(1, "rgba(105, 247, 255, 0.12)");
      context.fillStyle = barrierGradient;
      context.beginPath();
      context.arc(player.x, player.y, barrierRadius, 0, Math.PI * 2);
      context.fill();
      context.restore();
    }
    if (player.levelUpFlash > 0) {
      drawLevelUpLightning(player);
    }
    drawPixelPlayerShip(player);

    context.shadowBlur = 0;
    const isWarning = isLevelInvincible && player.levelUpInvincible <= INVINCIBLE_WARNING_TIME;
    const markerAlpha = isWarning && invincibleBlink ? 0.25 : 1;
    context.globalAlpha *= markerAlpha;
    context.fillStyle = isLevelInvincible
      ? "#d9fdff"
      : isHitInvincible
        ? "#ffd166"
        : "#ff3355";
    context.strokeStyle = "rgba(255,255,255,0.72)";
    context.lineWidth = 1;
    if (isLevelInvincible || isHitInvincible) {
      context.shadowBlur = isLevelInvincible ? 16 : 10;
      context.shadowColor = isLevelInvincible ? "#69f7ff" : "#ffd166";
    }
    context.beginPath();
    context.arc(player.x, player.y, HIT_MARKER_RADIUS, 0, Math.PI * 2);
    context.fill();
    context.stroke();
    context.restore();
  }

  function drawPixelPlayerShip(player) {
    const bankAmount = Math.abs(player.tilt);
    const bankScale = 1 - bankAmount * 0.48;
    const bankOffset = player.tilt * 4;

    context.save();
    context.translate(player.x + bankOffset, player.y);
    context.scale(bankScale, 1);
    drawPlayerShip(context, player.color);
    context.restore();
  }

  function drawLevelUpLightning(player) {
    context.save();
    const progress = player.levelUpFlash / 0.42;
    const alpha = Math.min(1, progress * 1.4);
    const boltCount = 10;

    context.globalAlpha = alpha;
    context.fillStyle = `rgba(255, 255, 255, ${0.18 * alpha})`;
    context.shadowBlur = 44;
    context.shadowColor = player.color;
    context.beginPath();
    context.arc(player.x, player.y, 34 + (1 - progress) * 34, 0, Math.PI * 2);
    context.fill();

    for (let boltIndex = 0; boltIndex < boltCount; boltIndex += 1) {
      const angle = frame.elapsedRound * 12 + (Math.PI * 2 * boltIndex) / boltCount + randomRange(-0.24, 0.24);
      const radius = randomRange(42, 86);
      const bolt = createLightningBolt(player.x, player.y, radius, angle, 16);

      context.strokeStyle = boltIndex % 2 === 0 ? "#ffffff" : player.color;
      context.lineWidth = boltIndex % 2 === 0 ? 4 : 2.4;
      context.shadowBlur = 24;
      context.shadowColor = player.color;
      context.beginPath();
      context.moveTo(bolt[0].x, bolt[0].y);
      for (const point of bolt.slice(1)) context.lineTo(point.x, point.y);
      context.stroke();
    }

    context.strokeStyle = "#ffffff";
    context.lineWidth = 5;
    context.globalAlpha = alpha * 0.7;
    context.beginPath();
    context.arc(player.x, player.y, 72 - progress * 22, 0, Math.PI * 2);
    context.stroke();
    context.restore();
  }

  function drawPlayerHud(player) {
    if (frame.compact && !player.cpu) {
      drawCompactPlayerHud(player);
      return;
    }

    const panelX = frame.compact && !player.cpu ? 44 : player.fieldX;
    const panelY = 18;
    context.fillStyle = "rgba(0,0,0,0.3)";
    roundRect(panelX, panelY, FIELD_WIDTH, 44, 12);
    context.fill();

    context.fillStyle = player.color;
    context.font = "700 16px system-ui";
    context.fillText(player.label, panelX + 16, panelY + 28);

    context.fillStyle = "#f4f7ff";
    context.font = "600 14px system-ui";
    context.fillText(`SCORE ${player.score}`, panelX + 78, panelY + 28);
    context.fillText(`LV ${player.level}`, panelX + 190, panelY + 28);
    context.fillText(`x${player.multiplier.toFixed(1)} / ${player.combo}`, panelX + 250, panelY + 28);
    context.fillText(formatLives(player), panelX + 316, panelY + 28);

    const gaugeWidth = FIELD_WIDTH - 32;
    const attackCost = getAttackCost(player);
    const gaugeRatio = Math.min(1, player.gauge / attackCost);
    context.fillStyle = "rgba(255,255,255,0.14)";
    roundRect(panelX + 16, panelY + 34, gaugeWidth, 5, 5);
    context.fill();
    context.fillStyle = player.gauge >= attackCost ? player.color : "rgba(255,255,255,0.55)";
    roundRect(panelX + 16, panelY + 34, gaugeWidth * gaugeRatio, 5, 5);
    context.fill();

    if (player.gauge >= attackCost) {
      context.fillStyle = player.color;
      context.font = "800 12px system-ui";
      context.fillText("AUTO ATTACK", panelX + 16, panelY + 58);
    } else {
      context.fillStyle = "rgba(255,255,255,0.68)";
      context.font = "700 12px system-ui";
      context.fillText(`GAUGE ${Math.floor(player.gauge)} / ${attackCost}`, panelX + 16, panelY + 58);
    }
  }

  function drawCompactPlayerHud(player) {
    const visibleLeft = WIDTH / 2 - FIELD_WIDTH / 2;
    const panelY = 18;
    const leftPanelWidth = 150;
    const rightPanelX = WIDTH / 2 + 62;
    const rightPanelWidth = 134;

    context.save();
    context.fillStyle = "rgba(0,0,0,0.42)";
    roundRect(visibleLeft, panelY, leftPanelWidth, 58, 12);
    context.fill();
    roundRect(rightPanelX, panelY, rightPanelWidth, 58, 12);
    context.fill();

    context.fillStyle = player.color;
    context.font = "800 13px system-ui";
    context.fillText(player.label, visibleLeft + 12, panelY + 22);

    context.fillStyle = "#f4f7ff";
    context.font = "700 12px system-ui";
    context.fillText(`SCORE ${player.score}`, visibleLeft + 12, panelY + 42);

    const attackCost = getAttackCost(player);
    const gaugeRatio = Math.min(1, player.gauge / attackCost);
    context.fillStyle = "rgba(255,255,255,0.14)";
    roundRect(visibleLeft + 12, panelY + 48, leftPanelWidth - 24, 5, 5);
    context.fill();
    context.fillStyle = player.gauge >= attackCost ? player.color : "rgba(255,255,255,0.55)";
    roundRect(visibleLeft + 12, panelY + 48, (leftPanelWidth - 24) * gaugeRatio, 5, 5);
    context.fill();

    context.fillStyle = "#f4f7ff";
    context.font = "700 12px system-ui";
    context.fillText(`LV ${player.level}`, rightPanelX + 12, panelY + 22);
    context.fillText(formatLives(player), rightPanelX + 66, panelY + 22);

    context.fillStyle = "rgba(255,255,255,0.72)";
    context.font = "700 11px system-ui";
    context.fillText(`x${player.multiplier.toFixed(1)} / ${player.combo}`, rightPanelX + 12, panelY + 43);
    context.restore();
  }

  function formatLives(player) {
    if (player.cpu) return "♥∞";
    const filled = "♥".repeat(Math.max(0, player.lives));
    const empty = "♡".repeat(Math.max(0, MAX_LIVES - player.lives));
    return filled + empty;
  }

  function drawOpponentInfoHud(opponent) {
    const panelX = WIDTH - 244;
    const panelY = 18;
    const panelWidth = 200;
    const attackCost = getAttackCost(opponent);
    const gaugeRatio = Math.min(1, opponent.gauge / attackCost);

    context.save();
    context.fillStyle = "rgba(0,0,0,0.48)";
    roundRect(panelX, panelY, panelWidth, 72, 14);
    context.fill();

    context.fillStyle = opponent.color;
    context.font = "800 13px system-ui";
    context.fillText(`OPPONENT  LV ${opponent.level}`, panelX + 12, panelY + 22);

    context.fillStyle = "rgba(255,255,255,0.16)";
    roundRect(panelX + 12, panelY + 34, panelWidth - 24, 7, 7);
    context.fill();
    context.fillStyle = opponent.color;
    roundRect(panelX + 12, panelY + 34, (panelWidth - 24) * gaugeRatio, 7, 7);
    context.fill();

    context.fillStyle = "rgba(255,255,255,0.72)";
    context.font = "700 12px system-ui";
    context.fillText(`COMBO ${opponent.combo} / GAUGE ${Math.floor(opponent.gauge)} / ${attackCost}`, panelX + 12, panelY + 60);
    context.restore();
  }

  function drawCenterInfo() {
    context.fillStyle = "rgba(0,0,0,0.34)";
    roundRect(WIDTH / 2 - 48, 24, 96, 50, 16);
    context.fill();
    context.fillStyle = "#f4f7ff";
    context.font = "800 24px system-ui";
    context.textAlign = "center";
    context.fillText(`${Math.floor(frame.elapsedRound)}s`, WIDTH / 2, 56);
    context.textAlign = "left";
  }

  function drawParticles() {
    for (const particle of frame.particles) {
      context.save();
      context.globalAlpha = Math.max(0, particle.life * 2);
      context.fillStyle = particle.color;
      context.beginPath();
      context.arc(particle.x, particle.y, particle.size ?? 3, 0, Math.PI * 2);
      context.fill();
      context.restore();
    }
  }

  function drawGameOver() {
    const showingGameOverEffect = !frame.clearGame && !frame.lastRankingResult;
    const winner = showingGameOverEffect ? "GAME OVER" : getWinner();
    context.fillStyle = "rgba(0,0,0,0.68)";
    context.fillRect(0, 0, WIDTH, HEIGHT);
    context.fillStyle = "#f4f7ff";
    context.textAlign = "center";
    context.font = "800 58px system-ui";
    context.fillText(winner, WIDTH / 2, HEIGHT / 2 + (frame.clearGame ? -118 : -28));
    if (showingGameOverEffect) {
      context.font = "700 22px system-ui";
      context.fillStyle = "#69f7ff";
      context.fillText(`SCORE ${frame.players[0].score}`, WIDTH / 2, HEIGHT / 2 + 18);
    }
    if (frame.cabinetRole === "spectator") {
      context.font = "600 20px system-ui";
      context.fillText("プレイヤーが続けるか辞めるか選ぶのを待っています", WIDTH / 2, HEIGHT / 2 + (frame.clearGame ? -72 : 18));
    } else if (!frame.clearGame && !showingGameOverEffect) {
      context.font = "500 20px system-ui";
      context.fillText("Rキーで1クレジットリトライ", WIDTH / 2, HEIGHT / 2 + 18);
    }
    context.textAlign = "left";
  }

  function drawHitDebug() {
    if (!frame.lastHitDebug) return;
    context.save();
    context.fillStyle = "rgba(0,0,0,0.62)";
    roundRect(WIDTH / 2 - 205, HEIGHT - 76, 410, 46, 12);
    context.fill();
    context.fillStyle = "#ffd166";
    context.font = "700 13px system-ui";
    context.textAlign = "center";
    context.fillText(
      `HIT DEBUG  inv:${frame.lastHitDebug.invincible}s  lvInv:${frame.lastHitDebug.levelUpInvincible}s  hitInv:${frame.lastHitDebug.hitInvincible}`,
      WIDTH / 2,
      HEIGHT - 48,
    );
    context.restore();
  }

  function drawPaused() {
    const compact = frame.compact;
    const title = frame.waitingForStart ? "READY" : "PAUSED";
    const action = compact
      ? frame.waitingForStart ? "画面下の「ゲーム開始」でスタート" : "画面下の「再開」ボタンでゲーム再開"
      : frame.waitingForStart ? "Spaceでゲーム開始" : "Spaceで再開";
    const instructionX = WIDTH / 2 - (compact ? 165 : 195);
    const instructions = compact
      ? [
        "移動: ゲーム画面をスライド",
        "ボス攻撃: 無敵シールドを当てる",
      ]
      : [
        "移動: 矢印キー / WASD",
        "低速移動: Shift",
        "ボス攻撃: 無敵シールドを当てる",
      ];

    context.fillStyle = "rgba(0,0,0,0.7)";
    context.fillRect(0, 0, WIDTH, HEIGHT);
    context.fillStyle = "#f4f7ff";
    context.textAlign = "center";
    context.font = `800 ${compact ? 52 : 64}px system-ui`;
    context.fillText(title, WIDTH / 2, HEIGHT / 2 - 126);
    context.fillStyle = "#69f7ff";
    context.font = `800 ${compact ? 22 : 24}px system-ui`;
    context.fillText(action, WIDTH / 2, HEIGHT / 2 - 76);
    context.fillStyle = "#f4f7ff";
    context.font = `600 ${compact ? 15 : 17}px system-ui`;
    context.textAlign = "left";
    instructions.forEach((instruction, index) => {
      context.fillText(instruction, instructionX, HEIGHT / 2 - 18 + index * 31);
    });
    context.textAlign = "left";
  }

  function getWinner() {
    if (frame.clearGame) return `ALL CLEAR  TIME ${Math.floor(frame.elapsedRound)}s`;
    if (frame.players[0].lives <= 0) return `SCORE ${frame.players[0].score}`;
    return `SCORE ${frame.players[0].score}`;
  }

  function roundRect(x, y, width, height, radius) {
    context.beginPath();
    context.moveTo(x + radius, y);
    context.arcTo(x + width, y, x + width, y + height, radius);
    context.arcTo(x + width, y + height, x, y + height, radius);
    context.arcTo(x, y + height, x, y, radius);
    context.arcTo(x, y, x + width, y, radius);
    context.closePath();
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }
}
