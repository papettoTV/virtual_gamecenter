import type { GameDefinition } from "../../domain/game";
import "../../games/mochi-beat/style.css";

export function GameScreen({ game }: { game: GameDefinition }) {
  const isSalvage = game.id === "deep-sea-salvage";
  const isRhythm = game.id === "mochi-beat";
  const isRhythmPreview = isRhythm && import.meta.env.DEV && new URLSearchParams(window.location.search).get("rhythmPreview") === "1";
  return (
    <section className={`game-screen is-hidden${isRhythm ? " mochi-screen" : ""}`} id="game-screen">
      <div className="spectator-banner is-hidden" id="spectator-banner">
        <div>
          <strong id="spectator-view-label">観戦中</strong>
          <span id="spectator-status-text">プレイヤーのゲーム状態をリアルタイム表示しています。</span>
        </div>
        <div className="spectator-crowd" id="spectator-crowd" aria-live="polite">
          <span className="spectator-crowd-pulse" aria-hidden="true" />
          <strong id="spectator-count">観戦者 1人</strong>
        </div>
        <button
          className="spectator-share-button"
          type="button"
          onClick={() => window.dispatchEvent(new Event("request-cabinet-share"))}
        >
          このライブを共有
        </button>
        <button className="spectator-switch-button is-hidden" id="spectator-switch-player" type="button">
          プレイヤーBを見る
        </button>
        <button id="challenge-request" type="button">1クレジットで対戦申込</button>
      </div>
      <div className="versus-status is-hidden" id="versus-status" role="status">
        対戦者が待っています。ゲーム停止時に確認できます。
      </div>
      <details className={`debug-panel${isSalvage || isRhythm ? " is-hidden" : ""}`} id="debug-panel">
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
        <div className="player-crowd-pulse is-hidden" id="player-crowd-pulse" aria-hidden="true" />
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
        {isRhythm && <div className="mochi-intro" id="mochi-intro">
          <span className="mochi-kicker">LISTEN. REPEAT. MOCHI!</span>
          <h2>もちつきビート</h2>
          <p>お手本を聞いて、同じリズムでもちつき！</p>
          <div className="mochi-instructions">
            <span><b>01</b> 左のうさぎの音を4拍聞く</span>
            <span><b>02</b> 次の4拍で、同じリズムを返す</span>
            <span><b>03</b> 休符はお休み。連打せずにトン！</span>
          </div>
          <button id="mochi-start" type="button">音を出してスタート</button>
          <small>スペースキー / 画面タップ · 約1分 · 3ステージ</small>
          <p id="mochi-audio-error" role="status" />
        </div>}
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
          {isSalvage && <button id="salvage-share-result" className="ranking-result-share-button" type="button">
            結果をシェア
          </button>}
          <div className="ranking-result-summary">
            <p id="ranking-result">ゲーム終了時にスコアを登録できます。</p>
            {isSalvage && <button id="salvage-result-collection" className="ranking-result-collection-button" type="button">
              図鑑
            </button>}
          </div>
          {isSalvage && <div id="salvage-share-menu" className="salvage-share-menu" hidden>
            <p>投稿先を選んでください。端末の共有では結果画像も一緒に送れます。</p>
            <button id="salvage-share-native" type="button">端末の共有メニュー</button>
            <button id="salvage-share-x" type="button">Xで共有</button>
            <button id="salvage-share-line" type="button">LINEで共有</button>
            <button id="salvage-share-bluesky" type="button">Blueskyで共有</button>
            <button id="salvage-share-save" type="button">シェア用画像を保存</button>
            <button id="salvage-share-copy" type="button">文章をコピー</button>
          </div>}
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
            <button id={isRhythmPreview ? "mochi-preview-retry" : "ranking-retry"} className="clear-restart-button ranking-retry-button" type="button">
              {isRhythmPreview ? "もう一度プレビュー" : "1クレジットでリトライ"}
            </button>
          </div>
        </div>
      </div>

      {isSalvage && <section className="salvage-terrain-editor" id="salvage-terrain-editor" hidden>
        <header>
          <div>
            <p className="eyebrow">DEEP SEA SALVAGE / DEVELOPMENT TOOL</p>
            <h2>海底岩壁エディタ</h2>
            <p>深度0〜12,000mの左右岩壁と、海藻・熱水噴出口の位置を編集できます。</p>
          </div>
          <button id="terrain-editor-play" type="button">保存してゲームで確認</button>
        </header>
        <div className="terrain-editor-toolbar" role="toolbar" aria-label="地形編集ツール">
          <button className="is-active" data-terrain-tool="wall" type="button">岩壁を描く</button>
          <button data-terrain-tool="kelp" type="button">海藻を配置</button>
          <button data-terrain-tool="vent" type="button">熱水噴出口を配置</button>
          <button data-terrain-tool="erase" type="button">設備を削除</button>
          <button id="terrain-editor-undo" type="button">元に戻す</button>
          <button id="terrain-editor-reset" type="button">初期地形へ戻す</button>
        </div>
        <div className="terrain-editor-toolbar">
          <label><input id="terrain-editor-overview" type="checkbox" /> 全体図（縦方向を圧縮）</label>
          <label>確認する深度 (m) <input id="terrain-editor-preview-depth" type="number" min="0" max="12000" step="100" defaultValue="0" /></label>
          <button id="terrain-editor-jump" type="button">この深度へ移動</button>
          <button id="terrain-editor-preview" type="button">保存して指定深度を確認</button>
          <span id="terrain-editor-scale">ゲームと同じ縦横比。スクロールして深い場所を編集できます。</span>
        </div>
        <div className="terrain-editor-workspace">
          <div className="terrain-editor-scroll">
            <canvas id="terrain-editor-canvas" width="960" height="12000" aria-label="海底岩壁編集キャンバス" />
          </div>
          <aside>
            <strong>操作方法</strong>
            <p>岩壁: 輪郭をつかんでドラッグ。中央を越えて張り出せます（通路は最低120px）。</p>
            <p>海藻・熱水噴出口: 岩壁付近をクリック。既存の印をドラッグすると移動</p>
            <p>削除: 消したい設備をクリック</p>
            <label htmlFor="terrain-editor-json">コースJSON</label>
            <textarea id="terrain-editor-json" rows={12} spellCheck={false} />
            <button id="terrain-editor-export" type="button">JSONを表示</button>
            <button id="terrain-editor-import" type="button">JSONを読み込む</button>
            <p id="terrain-editor-status" role="status" />
          </aside>
        </div>
      </section>}

      <div className="spectator-game-actions">
        <button id="spectator-game-back" className="secondary-button" type="button">筐体画面に戻る</button>
      </div>

      <div className="touch-controls" aria-label="スマホ操作">
        <div className="touch-actions">
          {isRhythm && <button id="mochi-tap" className="touch-button mochi-tap" type="button" disabled>トン！ <small>SPACE / TAP</small></button>}
          {isSalvage && <button id="touch-collection" className="touch-button" type="button">図鑑</button>}
          <button id="touch-pause" className="touch-button" type="button">一時停止</button>
        </div>
      </div>
      {isRhythm && <div className="mochi-settings">
        <span id="mochi-status" role="status" aria-live="polite">お手本のあと、同じリズムを返そう。</span>
        <label>音量 <input id="mochi-volume" type="range" min="0" max="100" defaultValue="65" /></label>
        <label>タイミング調整 <input id="mochi-offset" type="range" min="-200" max="200" step="10" defaultValue="0" /> <output id="mochi-offset-value">0 ms</output></label>
        <small>音が遅れて聞こえるときは＋へ調整（開始前のみ）。Pで一時停止。</small>
      </div>}

      <section className="ranking-panel">
        <div className="ranking-list">
          <h2>スコアランキング</h2>
          <RankingTable bodyId="ranking-list" label="スコアランキング" />
        </div>
      </section>

      <div className="game-footer-actions">
        {isSalvage && <button id="open-terrain-editor" className="secondary-button" type="button">岩壁エディタ</button>}
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
