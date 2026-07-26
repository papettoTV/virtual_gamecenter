export function ArcadeScreen() {
  return (
    <section className="arcade-screen" id="arcade-screen">
      <div className="arcade-card">
        <nav className="breadcrumb" aria-label="現在位置">
          <span>ゲームセンター</span>
        </nav>

        <section className="game-list" aria-label="ゲーム一覧">
          <div className="section-heading">
            <div>
              <h2>ゲーム一覧</h2>
              <p>遊ぶゲームを選ぶと、新しい筐体URLを発行します。URLを共有すると他の人が観戦できます。</p>
            </div>
          </div>
          <div className="game-select-card">
            <div className="game-card-thumb" aria-hidden="true">GD</div>
            <div className="game-card-body">
              <strong>Graze Duel</strong>
              <span>弾幕かすり・無敵体当たり・ボス撃破型シューティング</span>
              <small id="cabinet-summary">新しい筐体を作成 / Free Play</small>
            </div>
            <button id="select-game" type="button">筐体を作成</button>
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
