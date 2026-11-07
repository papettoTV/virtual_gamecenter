import { GameLifetime } from "../../game-sdk/lifetime";

export function createInputController({ lifetime, canvas, keyboardTarget, getState, togglePause, requestRetry, movePlayer }) {
  const scope = new GameLifetime();
  const releaseLifetime = lifetime.own(() => scope.dispose());
  scope.own(releaseLifetime);
  const keys = new Set();
  const touchMove = { active: false, startX: 0, startY: 0, x: 0, y: 0 };
  let pointerId = null;
  let activeTouchId = null;
  const directTouch = "ontouchstart" in canvas;

  scope.listen(keyboardTarget, "keydown", (event) => {
    if (event.repeat || (document.querySelector(".platform-overlay") || document.querySelector(".share-overlay"))) return;
    if (event.target?.closest?.("input, textarea, select, button, [role=dialog]")) return;
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
    if (directTouch && event.pointerType === "touch") return;
    if (!touchMove.active && canStartTouch()) {
      event.preventDefault();
      canvas.setPointerCapture(event.pointerId);
      pointerId = event.pointerId;
      startTouchMove(event);
    }
  });
  scope.listen(canvas, "pointermove", (event) => {
    if (touchMove.active && activeTouchId === null && (event.pointerId === undefined || event.pointerId === pointerId)) {
      event.preventDefault();
      updateTouchMove(event);
    }
  });
  const finishPointer = (event) => {
    if (pointerId !== null && (event.pointerId === undefined || event.pointerId === pointerId)) resetTouchMove();
  };
  scope.listen(canvas, "pointerup", finishPointer);
  scope.listen(canvas, "pointercancel", finishPointer);
  scope.listen(canvas, "lostpointercapture", finishPointer);
  if (directTouch) {
    scope.listen(canvas, "touchstart", (event) => {
      if (touchMove.active || !canStartTouch()) return;
      const touch = event.changedTouches[0];
      if (!touch) return;
      event.preventDefault();
      activeTouchId = touch.identifier;
      startTouchMove(touch);
    }, { passive: false });
    scope.listen(canvas, "touchmove", (event) => {
      if (activeTouchId === null) return;
      const touch = Array.from(event.changedTouches).find(candidate => candidate.identifier === activeTouchId);
      if (!touch) return;
      event.preventDefault();
      updateTouchMove(touch);
    }, { passive: false });
    const finishTouch = (event) => {
      if (activeTouchId !== null && Array.from(event.changedTouches).some(touch => touch.identifier === activeTouchId)) resetTouchMove();
    };
    scope.listen(canvas, "touchend", finishTouch);
    scope.listen(canvas, "touchcancel", finishTouch);
  }
  scope.own(() => {
    keys.clear();
    resetTouchMove();
  });

  function canStartTouch() {
    const state = getState();
    if (state.waitingForStart || document.querySelector(".platform-overlay, .share-overlay")) return false;
    const fullscreen = canvas.closest?.('[data-mobile-play="true"]');
    return (state.compact || fullscreen) && (!state.spectator || state.versusParticipant);
  }

  function startTouchMove(position) {
    touchMove.active = true;
    touchMove.startX = position.clientX;
    touchMove.startY = position.clientY;
    updateTouchMove(position);
  }

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
    const capturedPointer = pointerId;
    pointerId = null;
    activeTouchId = null;
    if (capturedPointer !== null && canvas.hasPointerCapture(capturedPointer)) canvas.releasePointerCapture(capturedPointer);
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
