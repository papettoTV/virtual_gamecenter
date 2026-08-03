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
          <div
            className="game-select-card is-selectable"
            id="select-game"
            role="button"
            tabIndex={0}
            aria-label="BUZZ BARRIERを選択"
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                event.currentTarget.click();
              }
            }}
          >
            <div className="game-card-thumb" aria-hidden="true">
              <img src="/assets/buzz-barrier-icon.png" alt="" />
            </div>
            <div className="game-card-body">
              <strong>BUZZ BARRIER</strong>
              <small>バズバリア</small>
              <span>弾幕かすり・無敵体当たり・ボス撃破型シューティング</span>
            </div>
            <div className="game-card-actions">
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
