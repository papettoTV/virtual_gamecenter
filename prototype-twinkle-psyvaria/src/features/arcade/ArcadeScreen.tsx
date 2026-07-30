import { CabinetDirectory } from "./CabinetDirectory";

export function ArcadeScreen() {
  return (
    <section className="arcade-screen" id="arcade-screen">
      <div className="arcade-card">
        <section className="game-list" aria-label="ゲーム一覧">
          <div className="section-heading">
            <div>
              <p>プレイ中の筐体を観戦するか、新しい筐体に入ってゲームを始められます。</p>
            </div>
          </div>
          <div className="game-select-card">
            <div className="game-card-thumb" aria-hidden="true">GD</div>
            <div className="game-card-body">
              <strong>Graze Duel</strong>
              <span>弾幕かすり・無敵体当たり・ボス撃破型シューティング</span>
            </div>
            <div className="game-card-actions">
              <button id="select-game" type="button">筐体を選択</button>
              <CabinetDirectory />
            </div>
          </div>
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
