import { CabinetSelector } from "../arcade/CabinetDirectory"
import type { GameDefinition } from "../../domain/game"

export function CabinetScreen({ game }: { game: GameDefinition }) {
  return (
    <section className="cabinet-screen is-hidden" id="cabinet-screen">
      <div className="arcade-card">
        <div className="arcade-heading">
          <div>
            <p className="eyebrow" id="cabinet-id-label">
              Cabinet
            </p>
            <h2>{game.title}</h2>
          </div>
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

        <div id="cabinet-selector-title" className="sr-only">筐体選択</div>
        <CabinetSelector game={game} />

        <section
          className="cabinet-promo"
          aria-labelledby="cabinet-promo-title"
        >
          <div className="cabinet-promo-heading">
            <strong id="cabinet-promo-title">プレイイメージ</strong>
            <small>{game.localizedTitle} Gameplay</small>
          </div>
          {game.promoVideoUrl ? (
            <video autoPlay muted loop playsInline preload="metadata" poster={game.promoPosterUrl}>
              <source src={game.promoVideoUrl} type="video/mp4" />
              お使いのブラウザでは動画を再生できません。
            </video>
          ) : (
            <img className="cabinet-promo-still" src={game.promoPosterUrl} alt={`${game.localizedTitle} プレイイメージ`} />
          )}
        </section>

        <section className="cabinet-help-grid" aria-label="遊び方">
          {game.id === "deep-sea-salvage" ? <>
            <div>
              <strong>操作</strong>
              <span>移動: 矢印キー / WASD</span>
              <span>調査: 魚に近づくと自動</span>
              <span>ポーズ: P　図鑑: F</span>
            </div>
            <div>
              <strong>ゲームのコツ</strong>
              <span>魚を調査して電力を補充しながら、より深い海を目指します。</span>
              <span>深海では発光や水流の変化を見て、高速魚を避けましょう。</span>
              <span>何度も現れる巨大魚を追跡し、調査を完了するとクリアです。</span>
            </div>
          </> : <>
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
          </>}
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
