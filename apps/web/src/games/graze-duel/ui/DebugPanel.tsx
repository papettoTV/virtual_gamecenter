export interface DebugPanelProps {
  hidden?: boolean;
}

export function DebugPanel({ hidden = false }: DebugPanelProps) {
  return (
    <details className={`debug-panel${hidden ? " is-hidden" : ""}`} id="debug-panel">
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
  );
}
