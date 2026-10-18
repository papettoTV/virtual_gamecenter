import type { GameDefinition } from "../../domain/game";
import "./game-help.css";

export function GameHelp({ game }: { game: GameDefinition }) {
  const dialog = useRef<HTMLDialogElement>(null);
  return <div className="game-help">
    <button type="button" className="game-help-trigger" aria-haspopup="dialog" onClick={() => dialog.current?.showModal()}>遊び方</button>
    <dialog ref={dialog} className="game-help-modal" aria-label={`${game.title}の遊び方`} onClick={event => {
      if (event.target === event.currentTarget) dialog.current?.close();
    }}>
      <div className="game-help-panel">
        <header className="game-help-heading">
          <h2>{game.title}の遊び方</h2>
          <button type="button" onClick={() => dialog.current?.close()} aria-label="遊び方を閉じる">✕ 閉じる</button>
        </header>
        <div className="game-help-content">
          <div className="game-help-desktop">{game.instructions?.desktop.map(line => <p key={line}>{line}</p>)}</div>
          <div className="game-help-mobile">{game.instructions?.mobile.map(line => <p key={line}>{line}</p>)}</div>
          {(game.instructions?.tips ?? [game.description]).map(line => <p key={line}>{line}</p>)}
        </div>
      </div>
    </dialog>
  </div>;
}
import { useRef } from "react";
