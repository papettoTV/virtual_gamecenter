import { useEffect, useRef, useState } from "react";
import { navigate } from "../../shared/navigation";
import { liveSharing } from "../sharing/share-service";
import "./leave-game.css";

/** Intercept directory actions before existing navigation/teardown handlers. */
export function LeaveGameConfirmation({ active }: { active?: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const leaving = useRef(false);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const leave = (event: MouseEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest('#cabinet-top-back, #game-back-to-arcade, .mobile-play-leave, .buzz-pause-leave, .dot-wave header a[href="/"]')) return;
      const context = liveSharing.getSnapshot();
      const playing = active ?? (context?.role === "player" && ["playing", "paused"].includes(context.phase));
      if (!playing) return;
      event.preventDefault(); event.stopImmediatePropagation();
      setOpen(true);
    };
    window.addEventListener("click", leave, true);
    return () => window.removeEventListener("click", leave, true);
  }, [active]);
  useEffect(() => { if (open) dialog.current?.showModal(); }, [open]);
  return <dialog ref={dialog} className={`leave-game-dialog${open ? " platform-overlay" : ""}`} aria-labelledby="leave-game-title"
    onCancel={() => setOpen(false)} onKeyDown={event => event.stopPropagation()} onKeyUp={event => event.stopPropagation()}>
    <div className="platform-dialog platform-dialog-small">
      <h2 id="leave-game-title">別のゲームを選びますか？</h2>
      <p>今のプレイは終了し、使用したクレジットは戻りません。</p>
      <div className="platform-dialog-actions">
        <button autoFocus type="button" onClick={() => { dialog.current?.close(); setOpen(false); }}>キャンセル</button>
        <button type="button" onClick={() => { if (leaving.current) return; leaving.current = true; dialog.current?.close(); setOpen(false); navigate("/"); }}>別のゲームをする</button>
      </div>
    </div>
  </dialog>;
}
