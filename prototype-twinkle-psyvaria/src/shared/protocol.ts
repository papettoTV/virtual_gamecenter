import type { CabinetRole, CabinetState } from "../domain/cabinet";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type GameSnapshot = { [key: string]: JsonValue };
export type GameMotionFrame = { [key: string]: JsonValue };
export type GameEvent = { type: string; [key: string]: JsonValue };

export type ClientMessage =
  | { type: "joinCabinet" }
  | { type: "startSolo" }
  | { type: "stopSolo" }
  | { type: "leaveCabinet" }
  | { type: "gameKeyframe"; seq: number; snapshot: GameSnapshot }
  | { type: "gameEvents"; seq: number; events: GameEvent[] }
  | { type: "gameMotionFrame"; seq: number; frame: GameMotionFrame };

export type ServerMessage =
  | { type: "connected"; clientId: string }
  | { type: "joinedCabinet"; clientId: string; role: CabinetRole }
  | { type: "cabinetState"; state: CabinetState }
  | { type: "viewerKeyframe"; seq: number; snapshot: GameSnapshot }
  | { type: "viewerEvents"; seq: number; events: GameEvent[] }
  | { type: "viewerMotionFrame"; seq: number; frame: GameMotionFrame }
  | { type: "playerLeft" }
  | { type: "error"; message: string };
