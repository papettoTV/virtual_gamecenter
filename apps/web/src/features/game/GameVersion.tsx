import type { GameDefinition } from "../../domain/game";
import "./game-version.css";

export function GameVersion({ game }: { game: GameDefinition }) {
  return <small className="game-version" aria-label={`${game.title} バージョン ${game.currentVersion}`}>v{game.currentVersion}</small>;
}
