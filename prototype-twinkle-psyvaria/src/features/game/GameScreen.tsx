import type { GameDefinition } from "../../domain/game";

export function GameScreen({ game }: { game: GameDefinition }) {
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
        <button
          className="cabinet-share-button game-share-button"
          type="button"
          aria-label="観戦用画面を共有"
          title="観戦用画面を共有"
          onClick={() => window.dispatchEvent(new Event("request-cabinet-share"))}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="18" cy="5" r="3" />
            <circle cx="6" cy="12" r="3" />
            <circle cx="18" cy="19" r="3" />
            <path d="m8.7 10.7 6.6-4.2M8.7 13.3l6.6 4.2" />
          </svg>
        </button>
        <canvas id="game" width="960" height="640" aria-label={`${game.title} game canvas`} />
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
          <p id="ranking-result">ゲーム終了時にスコアを登録できます。</p>
          <div className="ranking-form">
            <input id="ranking-name" type="hidden" />
            <div className="ranking-name-summary">
              <span>登録名</span>
              <strong id="ranking-name-display">読み込み中</strong>
            </div>
            <button id="ranking-submit" type="button" disabled>登録</button>
          </div>
          <div className="ranking-user-registration" id="ranking-user-registration" hidden>
            <p>ユーザー登録すると、ランキング名を自由に設定できます。</p>
            <button
              id="ranking-user-register"
              type="button"
              onClick={() => window.dispatchEvent(new Event("request-user-registration"))}
            >
              ユーザー登録
            </button>
          </div>
          <div className="ranking-submit-list">
            <RankingTable bodyId="ranking-submit-list" label="登録後のスコアランキング" />
          </div>
          <div className="ranking-next-actions">
            <button id="ranking-another-game" className="clear-restart-button" type="button">別のゲームをする</button>
            <button id="ranking-retry" className="clear-restart-button ranking-retry-button" type="button">
              1クレジットでリトライ
            </button>
          </div>
        </div>
      </div>

      <div className="spectator-game-actions">
        <button id="spectator-game-back" className="secondary-button" type="button">筐体画面に戻る</button>
      </div>

      <div className="touch-controls" aria-label="スマホ操作">
        <div className="touch-actions">
          <button id="touch-pause" className="touch-button" type="button">一時停止</button>
        </div>
      </div>

      <section className="ranking-panel">
        <div className="ranking-list">
          <h2>スコアランキング</h2>
          <RankingTable bodyId="ranking-list" label="スコアランキング" />
        </div>
      </section>

      <div className="game-footer-actions">
        <button id="game-back-to-arcade" className="secondary-button" type="button">別のゲームをする</button>
      </div>
    </section>
  );
}

function RankingTable({ bodyId, label }: { bodyId: string; label: string }) {
  return (
    <div className="ranking-table-scroll">
      <table className="ranking-table" aria-label={label}>
        <thead>
          <tr>
            <th scope="col">順位</th>
            <th scope="col">ユーザー名</th>
            <th scope="col">スコア</th>
            <th scope="col">日時</th>
          </tr>
        </thead>
        <tbody id={bodyId} />
      </table>
    </div>
  );
}
