import { useRef } from "react";
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
        <table className="game-help-table" aria-label="ゲームの目的と操作方法">
          <tbody>
            <tr><th scope="row">目的</th><td>{game.instructions?.objective ?? game.description}</td></tr>
            <tr><th scope="row">操作</th><td>
              <div className="game-help-desktop">{game.instructions?.desktop.map(line => <p key={line}>{line}</p>)}</div>
              <div className="game-help-mobile">{game.instructions?.mobile.map(line => <p key={line}>{line}</p>)}</div>
            </td></tr>
            <tr><th scope="row">遊び方</th><td>{game.instructions?.action ?? "準備中"}</td></tr>
            <tr><th scope="row">終了条件</th><td>{game.instructions?.ending ?? "準備中"}</td></tr>
            <tr><th scope="row">コツ</th><td>{game.instructions?.tips.map(line => <p key={line}>{line}</p>)}</td></tr>
          </tbody>
        </table>
      </div>
    </dialog>
  </div>;
}
