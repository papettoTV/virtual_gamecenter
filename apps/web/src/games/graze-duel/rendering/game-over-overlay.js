export function drawGameOverOverlay(context, frame, WIDTH, HEIGHT) {
  const showingGameOverEffect = !frame.clearGame && !frame.lastRankingResult;
  const spectator = frame.cabinetRole === "spectator";
  const winner = frame.clearGame
    ? `ALL CLEAR  TIME ${Math.floor(frame.elapsedRound)}s`
    : spectator || showingGameOverEffect ? "GAME OVER" : `SCORE ${frame.players[0].score}`;
  context.fillStyle = "rgba(0,0,0,0.68)";
  context.fillRect(0, 0, WIDTH, HEIGHT);
  context.fillStyle = "#f4f7ff";
  context.textAlign = "center";
  context.font = "800 58px system-ui";
  context.fillText(winner, WIDTH / 2, HEIGHT / 2 + (frame.clearGame ? -118 : -28));
  if (showingGameOverEffect && !spectator) {
    context.font = "700 22px system-ui";
    context.fillStyle = "#69f7ff";
    context.fillText(`SCORE ${frame.players[0].score}`, WIDTH / 2, HEIGHT / 2 + 18);
  }
  if (spectator) {
    context.fillStyle = "#69f7ff";
    context.font = "600 20px system-ui";
    context.fillText("プレイヤーが続けるか辞めるか選ぶのを待っています", WIDTH / 2, HEIGHT / 2 + (frame.clearGame ? -72 : 18));
  } else if (!frame.clearGame && !showingGameOverEffect) {
    context.font = "500 20px system-ui";
    context.fillText("Rキーで1クレジットリトライ", WIDTH / 2, HEIGHT / 2 + 18);
  }
  context.textAlign = "left";
}
