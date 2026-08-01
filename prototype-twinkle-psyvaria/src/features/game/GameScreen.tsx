export function GameScreen() {
  return (
    <section className="game-screen is-hidden" id="game-screen">
      <div className="spectator-banner is-hidden" id="spectator-banner">
        <div>
          <strong id="spectator-view-label">観戦中</strong>
          <span id="spectator-status-text">プレイヤーのゲーム状態をリアルタイム表示しています。</span>
        </div>
        <button className="spectator-switch-button is-hidden" id="spectator-switch-player" type="button">
          プレイヤーBを見る
        </button>
        <button id="challenge-request" type="button">1クレジットで対戦申込</button>
      </div>
      <div className="versus-status is-hidden" id="versus-status" role="status">
        対戦者が待っています。ゲーム停止時に確認できます。
      </div>
      <div className="game-nav">
        <button id="game-back-to-arcade" className="secondary-button" type="button">筐体画面に戻る</button>
        <span>ゲームセンター &gt; ゲーム一覧 &gt; BUZZ BARRIER &gt; 共有筐体</span>
      </div>
      <details className="debug-panel" id="debug-panel">
        <summary>デバッグ設定</summary>
        <div className="debug-panel-body">
          <label htmlFor="bullet-density"><strong>デバッグ: 敵弾量</strong></label>
          <input id="bullet-density" type="range" min="1" max="10" step="1" defaultValue="2" />
          <span><b id="bullet-density-value">2</b> / 10</span>
          <label className="debug-toggle">
            <input id="player-hitbox-toggle" type="checkbox" defaultChecked />
            <span>自機の当たり判定あり</span>
          </label>
          <label className="debug-toggle">
            <input id="debug-ranking-preview-toggle" type="checkbox" />
            <span>ゲーム開始3秒後にランキング登録を表示</span>
          </label>
          <div className="debug-stepper" aria-label="レベルごとの必要ゲージ増加量">
            <strong>デバッグ: ゲージ増加難度</strong>
            <button id="gauge-growth-down" type="button">−</button>
            <b id="gauge-growth-value">30</b>
            <button id="gauge-growth-up" type="button">＋</button>
            <span>レベルごとに必要ゲージ +<b id="gauge-growth-label">30</b></span>
          </div>
        </div>
      </details>

      <div className="game-frame">
        <canvas id="game" width="960" height="640" aria-label="BUZZ BARRIER game canvas" />
        <div className="versus-overlay is-hidden" id="versus-overlay" role="dialog" aria-modal="true">
          <p className="eyebrow" id="versus-eyebrow">Versus</p>
          <h2 id="versus-title">対戦</h2>
          <p id="versus-message" />
          <strong className="versus-countdown is-hidden" id="versus-countdown" />
          <div className="versus-actions">
            <button id="versus-secondary" type="button">いいえ</button>
            <button id="versus-danger" className="is-hidden" type="button">拒否する</button>
            <button id="versus-primary" className="platform-primary-button" type="button">はい</button>
          </div>
        </div>
        <div className="ranking-submit ranking-overlay" id="ranking-submit-panel">
          <h2 id="ranking-submit-heading">ランキング登録</h2>
          <p id="ranking-result">クリアするとタイムを登録できます。</p>
          <div className="ranking-form">
            <input id="ranking-name" maxLength={24} placeholder="名前" autoComplete="nickname" />
            <button id="ranking-submit" type="button" disabled>登録</button>
          </div>
          <ol className="ranking-submit-list" id="ranking-submit-list" />
          <button id="clear-restart" className="clear-restart-button" type="button">リスタート</button>
        </div>
      </div>

      <div className="spectator-game-actions">
        <button id="spectator-game-back" className="secondary-button" type="button">筐体画面に戻る</button>
      </div>

      <div className="touch-controls" aria-label="スマホ操作">
        <div className="touch-actions">
          <button id="touch-restart" className="touch-button" type="button">リスタート</button>
          <button id="touch-pause" className="touch-button" type="button">一時停止</button>
        </div>
      </div>

      <section className="ranking-panel">
        <div className="ranking-list">
          <h2>スコアランキング</h2>
          <ol id="ranking-list" />
          <button id="ranking-refresh" type="button">更新</button>
        </div>
      </section>
    </section>
  );
}
