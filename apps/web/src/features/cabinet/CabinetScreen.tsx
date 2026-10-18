import type { GameDefinition } from "../../domain/game";
import { gameHost } from "../../game-sdk/game-host";
import { navigate } from "../../shared/navigation";
import { GameHelp } from "./GameHelp";
import { startNewGame } from "./play-navigation";

export function CabinetScreen({ game }: { game: GameDefinition }) {
  const watch = new URLSearchParams(location.search).get("watch") === "1";
  return <section className="cabinet-screen is-hidden" id="cabinet-screen">
    <div className="arcade-card">
      <p className="eyebrow" id="cabinet-id-label">{game.localizedTitle}</p>
      <h2>{game.title}</h2>
      <p>{watch ? "プレイは終了したか、まだ始まっていません。" : "ゲーム開始の確認をしています。"}</p>
      <div className="cabinet-legacy-controls" hidden>
        <span id="cabinet-status-label" /><span id="cabinet-role-label" />
        <button id="start-solo" type="button" onClick={() => gameHost.requestPlay("start")}>ゲームスタート</button>
        <small id="cabinet-copy-status" />
      </div>
      <div className="cabinet-waiting-actions">
        {watch && <button type="button" onClick={() => startNewGame(game.id)}>自分も遊ぶ</button>}
        <button id="back-to-arcade" type="button" onClickCapture={event => { event.stopPropagation(); navigate("/"); }}>ほかのゲームを見る</button>
      </div>
      <GameHelp game={game} />
    </div>
  </section>;
}
