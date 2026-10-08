import { CabinetDirectory } from "./CabinetDirectory";
import { getActiveGames } from "../../domain/game";

export function ArcadeScreen({ onSelectGame }: { onSelectGame: (gameId: string) => void }) {
  const games = getActiveGames();
  return (
    <section className="arcade-screen" id="arcade-screen">
      <div className="arcade-card">
        <section className="game-list" aria-label="ゲーム一覧">
          <div className="section-heading">
            <div>
              <p>プレイ中の筐体を観戦するか、新しい筐体に入ってゲームを始められます。</p>
            </div>
          </div>
          {games.map((game) => (
            <div
              className="game-select-card is-selectable"
              key={game.id}
            >
              <button
                className="game-card-select-overlay"
                type="button"
                aria-label={`${game.title}を選択`}
                onClick={() => void onSelectGame(game.id)}
              />
              <div className="game-card-thumb" aria-hidden="true">
                <img src={game.iconUrl} alt="" />
              </div>
              <div className="game-card-body">
                <strong>{game.title}</strong>
                <small>{game.localizedTitle}</small>
                <span>{game.description}</span>
              </div>
              <div className="game-card-actions">
                <CabinetDirectory gameId={game.id} />
              </div>
            </div>
          ))}
          <div className="game-select-card is-disabled">
            <div className="game-card-thumb" aria-hidden="true">?</div>
            <div className="game-card-body">
              <strong>Coming Soon</strong>
              <span>今後、別ゲームやレトロゲームを追加予定</span>
              <small>準備中</small>
            </div>
            <button type="button" disabled>準備中</button>
          </div>
        </section>
      </div>
    </section>
  );
}
