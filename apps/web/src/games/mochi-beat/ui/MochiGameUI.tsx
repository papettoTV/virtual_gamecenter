export function MochiIntro() {
  return (
    <div className="mochi-intro" id="mochi-intro">
      <span className="mochi-kicker">LISTEN. REPEAT. MOCHI!</span>
      <h2>もちつきビート</h2>
      <p>左のうさぎとあなたが、4拍ずつ交代でもちをつきます。</p>
      <div className="mochi-instructions">
        <div className="mochi-turn-example" aria-label="お手本4拍、あなた4拍、お手本4拍、あなた4拍の順で繰り返します">
          <span>お手本 <b>4拍</b></span><i aria-hidden="true">→</i><span>あなた <b>4拍</b></span><i aria-hidden="true">→</i><span>くり返す</span>
        </div>
        <span><b>01 聞く</b> はじめは左のうさぎの番。押さずに「トン」の音と間を覚えよう。</span>
        <span><b>02 まねする</b> 「あなたの番！」が出たら、次の4拍で同じリズムをタップ。</span>
        <span><b>03 交代する</b> 4拍たつと、またお手本の番。音のない拍は押さずにお休み！</span>
      </div>
      <p className="mochi-set-overview">3ステージで1セット。108 → 126 → 144 BPMと速くなる3セットに挑戦！<br />セットの間で休憩できます。3セット完走でゲームクリア。</p>
      <button id="mochi-start" type="button">音を出してスタート</button>
      <small>スペースキー / 画面タップ · 約2分半 · 3ステージ × 3セット</small>
      <p id="mochi-audio-error" role="status" />
    </div>
  );
}

export function MochiSetIntro() {
  return (
    <div className="mochi-intro" id="mochi-set-intro" hidden>
      <span className="mochi-kicker">NEXT SET</span>
      <h2 id="mochi-next-title">次のセットへ</h2>
      <p id="mochi-next-summary" />
      <p id="mochi-next-tempo" className="mochi-next-tempo" />
      <p>同じ3ステージに、もう一度挑戦！<br />お手本4拍 → あなた4拍の交代は同じです。</p>
      <button id="mochi-next-set" type="button">スペース / タップで開始</button>
      <small>準備ができるまで、ゆっくり休憩できます。</small>
      <p id="mochi-next-error" role="status" />
    </div>
  );
}

export function MochiResult() {
  return (
    <figure className="mochi-result-dish">
      <canvas id="mochi-result-art" width="440" height="160" role="img" aria-label="完成したもち" />
      <figcaption><strong id="mochi-finish-title" /><span id="mochi-finish-description" /></figcaption>
    </figure>
  );
}

export function MochiTouchAction() {
  return (
    <button id="mochi-tap" className="touch-button mochi-tap" type="button" disabled>トン！ <small>SPACE / TAP</small></button>
  );
}

export function MochiSettings() {
  return (
    <div className="mochi-settings">
      <span id="mochi-status" role="status" aria-live="polite">お手本のあと、同じリズムを返そう。</span>
      <label>音量 <input id="mochi-volume" type="range" min="0" max="100" defaultValue="65" /></label>
      <label>タイミング調整 <input id="mochi-offset" type="range" min="-200" max="200" step="10" defaultValue="0" /> <output id="mochi-offset-value">0 ms</output></label>
      <small>音が遅れて聞こえるときは＋へ調整（開始前のみ）。Pで一時停止。</small>
    </div>
  );
}

export function MochiRetryAction() {
  const isRhythmPreview = import.meta.env.DEV && new URLSearchParams(window.location.search).get("rhythmPreview") === "1";
  return (
    <button id={isRhythmPreview ? "mochi-preview-retry" : "ranking-retry"} className="clear-restart-button ranking-retry-button" type="button">
      {isRhythmPreview ? "もう一度プレビュー" : "1クレジットでリトライ"}
    </button>
  );
}
