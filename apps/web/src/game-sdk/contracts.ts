import type { GameDefinition } from "../domain/game";
import type { GameLifetime } from "./lifetime";

export type PlayAction = "start" | "retry";
export interface GameInstance {
  prepareSolo?(): void | Promise<void>;
  play(action: PlayAction): boolean | Promise<boolean>;
  dispose(): void;
}
export interface GameContext {
  game: GameDefinition;
  lifetime: GameLifetime;
}
export interface CanvasGameModule {
  mountGame(context: GameContext): GameInstance;
}
