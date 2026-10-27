export function SalvageResultCollection() {
  return (
    <button id="salvage-result-collection" className="ranking-result-collection-button" type="button">
      図鑑を見る
    </button>
  );
}

export function SalvageTerrainEditor() {
  return (
    <section className="salvage-terrain-editor" id="salvage-terrain-editor" hidden>
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
    </section>
  );
}

export function SalvageTouchCollection() {
  return (
    <button id="touch-collection" className="touch-button" type="button">図鑑</button>
  );
}

export function SalvageEditorAction() {
  return (
    <button id="open-terrain-editor" className="secondary-button" type="button">岩壁エディタ</button>
  );
}
