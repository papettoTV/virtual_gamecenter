import { useSyncExternalStore } from "react";
import { BUZZ_BARRIER } from "../../../domain/game";
import { liveSharing, shareLive, type LiveShareContext } from "../../../features/sharing/share-service";
import { navigate } from "../../../shared/navigation";
import { getPausePresentation } from "../rendering/pause-presentation";
import "./pause-overlay.css";

export function BuzzPausePanel({ context, compact, actionsOnly = false }: { context: LiveShareContext | null; compact: boolean; actionsOnly?: boolean }) {
  const visible = context?.gameId === BUZZ_BARRIER.id && context.phase === "paused";
  const spectator = context?.role === "spectator";
  const presentation = getPausePresentation({ cabinetRole: context?.role, compact, waitingForStart: false });
  if (actionsOnly) return visible ? <div className="buzz-pause-actions" onKeyDown={event => event.stopPropagation()} onKeyUp={event => event.stopPropagation()}>
        <button className="buzz-pause-leave" type="button" onClick={() => navigate("/")}>{spectator ? "ほかのゲームを見る" : "別のゲームをする"}</button>
        {!spectator && <button type="button" onClick={() => void shareLive(context!)}>観戦URLをシェア</button>}
      </div> : null;
  return <div id="buzz-pause-overlay" className="buzz-pause-overlay" hidden={!visible} role="region" aria-label="一時停止">
    {visible && <div className="buzz-pause-content">
      <h2>PAUSED</h2>
      <p className="buzz-pause-hint">{presentation.action}</p>
      {presentation.instructions.length > 0 && <ul className="buzz-pause-instructions">
        {presentation.instructions.map(instruction => <li key={instruction}>{instruction}</li>)}
      </ul>}
    </div>}
  </div>;
}

export function BuzzPauseOverlay({ compact, actionsOnly = false }: { compact: boolean; actionsOnly?: boolean }) {
  const context = useSyncExternalStore(liveSharing.subscribe, liveSharing.getSnapshot, () => null);
  return <BuzzPausePanel context={context} compact={compact} actionsOnly={actionsOnly} />;
}
