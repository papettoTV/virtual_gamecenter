import { GameLifetime } from "../../game-sdk/lifetime";

export function createInputController({ lifetime, canvas, keyboardTarget, getState, togglePause, requestRetry, movePlayer }) {
  const scope = new GameLifetime();
  const releaseLifetime = lifetime.own(() => scope.dispose());
  scope.own(releaseLifetime);
  const keys = new Set();
  const touchMove = { active: false, startX: 0, startY: 0, x: 0, y: 0 };
  let pointerId = null;

  scope.listen(keyboardTarget, "keydown", (event) => {
    const state = getState();
    if (state.spectator && !state.versusParticipant) return;
    if (event.code === "Space") {
      event.preventDefault();
      if (state.screen === "game" && !state.gameOver) togglePause();
      return;
    }
    keys.add(event.code);
    if (event.code === "KeyR" && state.screen === "game" && !state.versusParticipant && !event.repeat) requestRetry();
  });
  scope.listen(keyboardTarget, "keyup", (event) => keys.delete(event.code));
  scope.listen(canvas, "pointerdown", (event) => {
    const state = getState();
    if (state.compact && (!state.spectator || state.versusParticipant)) {
      event.preventDefault();
      canvas.setPointerCapture(event.pointerId);
      pointerId = event.pointerId;
      touchMove.active = true;
      touchMove.startX = event.clientX;
      touchMove.startY = event.clientY;
      updateTouchMove(event);
    }
  });
  scope.listen(canvas, "pointermove", (event) => {
    if (touchMove.active) {
      event.preventDefault();
      updateTouchMove(event);
    }
  });
  scope.listen(canvas, "pointerup", resetTouchMove);
  scope.listen(canvas, "pointercancel", resetTouchMove);
  scope.own(() => {
    if (pointerId !== null && canvas.hasPointerCapture(pointerId)) canvas.releasePointerCapture(pointerId);
    keys.clear();
    resetTouchMove();
  });

  function updateTouchMove(event) {
    const maxDistance = 72;
    const rawX = event.clientX - touchMove.startX;
    const rawY = event.clientY - touchMove.startY;
    const distance = Math.hypot(rawX, rawY);
    const limitedDistance = Math.min(distance, maxDistance);
    const angle = Math.atan2(rawY, rawX);
    touchMove.x = Math.cos(angle) * limitedDistance / maxDistance;
    touchMove.y = Math.sin(angle) * limitedDistance / maxDistance;
  }

  function resetTouchMove() {
    touchMove.active = false;
    touchMove.startX = 0;
    touchMove.startY = 0;
    touchMove.x = 0;
    touchMove.y = 0;
  }

  return {
    touchMove,
    resetTouchMove,
    updateHuman(player, delta) {
      if (scope.disposed) return;
      let moveX = 0;
      let moveY = 0;
      if (keys.has("ArrowLeft") || keys.has("KeyA")) moveX -= 1;
      if (keys.has("ArrowRight") || keys.has("KeyD")) moveX += 1;
      if (keys.has("ArrowUp") || keys.has("KeyW")) moveY -= 1;
      if (keys.has("ArrowDown") || keys.has("KeyS")) moveY += 1;
      if (touchMove.active) {
        moveX += touchMove.x;
        moveY += touchMove.y;
      }
      movePlayer(player, moveX, moveY, keys.has("ShiftLeft") || keys.has("ShiftRight"), delta);
    },
    dispose() { scope.dispose(); },
  };
}
