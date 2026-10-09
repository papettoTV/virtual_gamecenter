import type { ComponentType } from "react";
import type { GameDefinition, GameId } from "../domain/game";
import { gameHost } from "../game-sdk/game-host";
import { DebugPanel } from "./graze-duel/ui/DebugPanel";
import { MochiIntro, MochiSetIntro, MochiResult, MochiTouchAction, MochiSettings, MochiRetryAction } from "./mochi-beat/ui/MochiGameUI";
import { SalvageResultShare, SalvageResultCollection, SalvageShareMenu, SalvageTerrainEditor, SalvageTouchCollection, SalvageEditorAction } from "./deep-sea-salvage/ui/SalvageGameUI";
import "./dot-wave/style.css";

export { DebugPanel };

export interface GameUIProps {
  game: GameDefinition;
}

export interface GameUIConfig {
  screenClassName: string;
  debugPanelHidden: boolean;
  FrameIntro: ComponentType<GameUIProps>;
  SetIntro: ComponentType<GameUIProps>;
  ResultPresentation: ComponentType<GameUIProps>;
  ResultShareAction: ComponentType<GameUIProps>;
  ResultSummaryAction: ComponentType<GameUIProps>;
  ResultMenu: ComponentType<GameUIProps>;
  AfterFrame: ComponentType<GameUIProps>;
  TouchActions: ComponentType<GameUIProps>;
  Settings: ComponentType<GameUIProps>;
  FooterAction: ComponentType<GameUIProps>;
  RetryAction: ComponentType<GameUIProps>;
}

function EmptySlot() {
  return null;
}

function DefaultRetryAction() {
  return <button id="ranking-retry" className="clear-restart-button ranking-retry-button" type="button" onClick={() => gameHost.requestPlay("retry")}>1クレジットでリトライ</button>;
}

const defaultGameUI: GameUIConfig = {
  screenClassName: "",
  debugPanelHidden: false,
  FrameIntro: EmptySlot,
  SetIntro: EmptySlot,
  ResultPresentation: EmptySlot,
  ResultShareAction: EmptySlot,
  ResultSummaryAction: EmptySlot,
  ResultMenu: EmptySlot,
  AfterFrame: EmptySlot,
  TouchActions: EmptySlot,
  Settings: EmptySlot,
  FooterAction: EmptySlot,
  RetryAction: DefaultRetryAction,
};

const gameUIRegistry: Readonly<Record<GameId, Partial<GameUIConfig>>> = {
  "dot-wave": {},
  "deep-sea-salvage": {
    debugPanelHidden: true,
    ResultShareAction: SalvageResultShare,
    ResultSummaryAction: SalvageResultCollection,
    ResultMenu: SalvageShareMenu,
    AfterFrame: SalvageTerrainEditor,
    TouchActions: SalvageTouchCollection,
    FooterAction: SalvageEditorAction,
  },
  "mochi-beat": {
    screenClassName: "mochi-screen",
    debugPanelHidden: true,
    FrameIntro: MochiIntro,
    SetIntro: MochiSetIntro,
    ResultPresentation: MochiResult,
    TouchActions: MochiTouchAction,
    Settings: MochiSettings,
    RetryAction: MochiRetryAction,
  },
};

export function getGameUI(gameId: GameId): GameUIConfig {
  return { ...defaultGameUI, ...gameUIRegistry[gameId] };
}
