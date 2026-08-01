import { CabinetSelector } from "../arcade/CabinetDirectory"

export function CabinetScreen() {
  return (
    <section className="cabinet-screen is-hidden" id="cabinet-screen">
      <div className="arcade-card">
        <div className="cabinet-top-actions">
          <button
            id="cabinet-top-back"
            className="secondary-button"
            type="button"
          >
            他のゲームを探す
          </button>
        </div>
        <div className="arcade-heading">
          <div>
            <p className="eyebrow" id="cabinet-id-label">
              Cabinet
            </p>
            <h2>BUZZ BARRIER</h2>
          </div>
          <button
            id="copy-cabinet-url"
            className="cabinet-share-button"
            type="button"
            aria-label="筐体共有URLをコピー"
            title="筐体共有URLをコピー"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="18" cy="5" r="3" />
              <circle cx="6" cy="12" r="3" />
              <circle cx="18" cy="19" r="3" />
              <path d="m8.7 10.7 6.6-4.2M8.7 13.3l6.6 4.2" />
            </svg>
          </button>
        </div>

        <div className="cabinet-legacy-controls" hidden>
          <div className="cabinet-status-copy">
            <strong>筐体状態</strong>
            <span id="cabinet-status-label">空き</span>
            <small id="cabinet-role-label">接続中</small>
          </div>
          <button
            id="start-solo"
            className="cabinet-start-button"
            type="button"
          >
            ゲームスタート
          </button>
          <small
            id="cabinet-copy-status"
            className="cabinet-copy-status"
            aria-live="polite"
          >
            共有アイコンで筐体URLをコピーできます
          </small>
        </div>

        <CabinetSelector />

        <section
          className="cabinet-promo"
          aria-labelledby="cabinet-promo-title"
        >
          <div className="cabinet-promo-heading">
            <strong id="cabinet-promo-title">プレイイメージ</strong>
            <small>バズバリア Gameplay</small>
          </div>
          <video
            autoPlay
            muted
            loop
            playsInline
            preload="metadata"
            poster="/graze-duel-promo-poster.jpg?v=20260801-actual"
          >
            <source src="/graze-duel-promo.mp4?v=20260801-actual" type="video/mp4" />
            お使いのブラウザでは動画を再生できません。
          </video>
        </section>

        <section className="cabinet-help-grid" aria-label="遊び方">
          <div>
            <strong>操作</strong>
            <span>移動: 矢印キー / WASD</span>
            <span>低速移動: Shift</span>
            <span>ボス攻撃: 無敵シールドを当てる</span>
            <span>一時停止: Space</span>
          </div>
          <div>
            <strong>ゲームのコツ</strong>
            <span>
              弾をかするとゲームが増え、ゲージが溜まるとレベルが上がり一定時間無敵になります。
            </span>
            <span>無敵中も、弾をかすってゲージを溜めることができます。</span>
            <span>無敵シールドをボスに当てて、ラスボス撃破を目指します。</span>
          </div>
        </section>
        <div className="screen-actions">
          <button
            id="back-to-arcade"
            className="secondary-button"
            type="button"
          >
            他のゲームを探す
          </button>
        </div>
      </div>
    </section>
  )
}
