/** Presentation only: callers retain authorization and duplicate-submit guards. */
export function PlayCreditConfirmation({ busy, balance, autoFocus = false, onCancel, onConfirm, onShare }: {
  busy: boolean; balance?: number; autoFocus?: boolean; onCancel: () => void; onConfirm: () => void; onShare: () => void;
}) {
  return <div className="platform-overlay" role="dialog" aria-modal="true" aria-labelledby="play-credit-title"
    onKeyDown={event => { event.stopPropagation(); if (event.repeat && ["Space", "Enter"].includes(event.code)) event.preventDefault(); if (event.code === "Escape") { event.preventDefault(); onCancel(); } }}
    onKeyUp={event => event.stopPropagation()}>
    <div className="platform-dialog platform-dialog-small">
      <div className="play-credit-header"><p className="eyebrow">1 Credit</p>
        <button className="cabinet-share-button platform-share-icon-button" type="button" aria-label="観戦用画面を共有" title="観戦用画面を共有" disabled={busy}
          onClick={event => { event.currentTarget.focus(); onShare(); }}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><path d="m8.7 10.7 6.6-4.2M8.7 13.3l6.6 4.2" /></svg>
        </button>
      </div>
      <h2 id="play-credit-title">ゲームを開始しますか？</h2>
      <p>開始時に1クレジットを使用します。{balance !== undefined && <>現在の利用可能残高は<strong> {balance}枚</strong>です。</>}</p>
      <div className="platform-dialog-actions play-credit-actions is-confirm">
        <button autoFocus={autoFocus} className="platform-cancel-button" type="button" disabled={busy} onClick={onCancel}>キャンセル</button>
        <button className="platform-primary-button play-credit-start-button" type="button" disabled={busy} onClick={onConfirm}>{busy ? "準備中…" : "1クレジットで開始"}</button>
      </div>
    </div>
  </div>;
}
