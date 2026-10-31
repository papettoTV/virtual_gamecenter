import { liveSharing, type LiveShareContext } from "../sharing/share-service";

export function needsLeaveConfirmation(context: LiveShareContext | null) {
  return context?.role === "player" && context.phase !== "finished"
    && !(context.gameId === "dot-wave" && context.phase === "ready");
}

export function installLeaveGameConfirmation() {
  const confirmLeave = (event: MouseEvent) => {
    if (!(event.target instanceof Element)
      || !event.target.closest("#game-back-to-arcade, #ranking-another-game")) return;
    if (!needsLeaveConfirmation(liveSharing.getSnapshot())) return;
    if (window.confirm("ほかのゲームを探しに行きますか？\n今のプレイはここで終了します。使用済みのクレジットはそのまま消費されます。")) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  document.addEventListener("click", confirmLeave, true);
  return () => document.removeEventListener("click", confirmLeave, true);
}
