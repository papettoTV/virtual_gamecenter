import type { GameDefinition } from "../../domain/game";
import "./game-help.css";

export function GameHelp({ game }: { game: GameDefinition }) {
  return <details className="game-help">
    <summary>遊び方</summary>
    <div className="game-help-content">
      <div className="game-help-desktop">{game.instructions?.desktop.map(line => <p key={line}>{line}</p>)}</div>
      <div className="game-help-mobile">{game.instructions?.mobile.map(line => <p key={line}>{line}</p>)}</div>
      {(game.instructions?.tips ?? [game.description]).map(line => <p key={line}>{line}</p>)}
    </div>
  </details>;
}
