export function CabinetScreen() {
  return (
    <section className="cabinet-screen is-hidden" id="cabinet-screen">
      <div className="arcade-card">
        <nav className="breadcrumb" aria-label="現在位置">
          <button id="cabinet-breadcrumb-arcade" type="button">ゲームセンター</button>
          <span>ゲーム一覧</span>
          <span>Graze Duel</span>
        </nav>
        <div className="arcade-heading">
          <div>
            <p className="eyebrow" id="cabinet-id-label">Cabinet</p>
            <h2>Graze Duel</h2>
            <p id="cabinet-description">筐体へ接続しています。</p>
          </div>
        </div>

        <div className="cabinet-status">
          <strong>筐体状態</strong>
          <span id="cabinet-status-label">空き</span>
          <small id="cabinet-role-label">接続中</small>
          <button id="spectator-watch" className="cabinet-watch-button" type="button">観戦する</button>
        </div>
        <div className="cabinet-share">
          <label htmlFor="cabinet-url"><strong>筐体共有URL</strong></label>
          <div>
            <input id="cabinet-url" type="text" readOnly />
            <button id="copy-cabinet-url" type="button">URLをコピー</button>
          </div>
          <small id="cabinet-copy-status">このURLを開くと同じ筐体を観戦できます。</small>
        </div>
        <section className="cabinet-help-grid" aria-label="遊び方">
          <div>
            <strong>操作</strong>
            <span>移動: 矢印キー / WASD</span>
            <span>低速移動: Shift</span>
            <span>一時停止: Space</span>
            <span>リスタート: R</span>
          </div>
          <div>
            <strong>ゲームのコツ</strong>
            <span>弾をかするとレベルが上がり、ゲージが溜まると自動攻撃します。</span>
            <span>無敵の膜をボスに当てて、ラスボス撃破を目指します。</span>
          </div>
        </section>
        <div className="screen-actions">
          <button id="start-solo" type="button">ゲームスタート</button>
          <button id="back-to-arcade" className="secondary-button" type="button">ゲームセンターに戻る</button>
        </div>
      </div>
    </section>
  );
}
