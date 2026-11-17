import { useEffect, useState, type ReactNode } from "react";
import type { GameDefinition } from "../../domain/game";
import { CABINET_PRESENCE_EVENT, type CabinetPresence } from "../../realtime/cabinet-presence";
import { CabinetReturnLink } from "./CabinetReturnLink";
import { GameHelp } from "./GameHelp";
import { startNewGame } from "./play-navigation";

export function SpectatorGate({ game, url, preview, children }: { game: GameDefinition; url: URL; preview: boolean; children: ReactNode }) {
  if (preview || url.searchParams.get("watch") !== "1") return <>{children}</>;
  return <WatchAvailability game={game} cabinetId={url.pathname.split("/").pop()!}>{children}</WatchAvailability>;
}

function WatchAvailability({ game, cabinetId, children }: { game: GameDefinition; cabinetId: string; children: ReactNode }) {
  const [playerCount, setPlayerCount] = useState<number | null>(null);
  useEffect(() => {
    const update = (event: Event) => {
      const presence = (event as CustomEvent<CabinetPresence>).detail;
      if (presence.cabinetId === cabinetId && presence.gameId === game.id) setPlayerCount(presence.playerCount);
    };
    window.addEventListener(CABINET_PRESENCE_EVENT, update);
    return () => window.removeEventListener(CABINET_PRESENCE_EVENT, update);
  }, [cabinetId, game.id]);
  const unavailable = playerCount === 0;
  return <>
    {unavailable && <div className="spectator-waiting">
      <CabinetReturnLink />
      <section className="spectator-availability" aria-label="プレイの開始待ち・終了">
        <h2>{game.title}</h2>
        <p>プレイは終了したか、まだ始まっていません。プレイが始まると、自動で観戦画面を表示します。</p>
        <div className="showcase-actions cabinet-waiting-actions">
          <button type="button" onClick={() => startNewGame(game.id)}>自分も遊ぶ</button>
        </div>
        <GameHelp game={game} inline />
      </section>
    </div>}
    <div className={unavailable ? "spectator-offline" : undefined}>{children}</div>
  </>;
}
