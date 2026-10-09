
export interface WelcomeCreditDialogProps {
  welcomeDialogOpen: boolean;
  busy: boolean;
  skipWelcomeCredit: () => void;
  handleWelcomeCredit: () => Promise<void>;
}

export function WelcomeCreditDialog({ welcomeDialogOpen, busy, skipWelcomeCredit, handleWelcomeCredit }: WelcomeCreditDialogProps) {
  return (
    <>
      {welcomeDialogOpen && (
        <div className="platform-overlay" role="dialog" aria-modal="true" aria-labelledby="welcome-credit-title">
          <div className="platform-dialog platform-dialog-small">
            <p className="eyebrow">Welcome Credit</p>
            <h2 id="welcome-credit-title">無料5クレジット</h2>
            <p>初回プレイ特典として、無料5クレジットを受け取れます。</p>
            <small className="platform-dialog-note">この端末では初回のみ受け取れます。</small>
            <div className="platform-dialog-actions">
              <button type="button" disabled={busy} onClick={skipWelcomeCredit}>受け取らない</button>
              <button className="platform-primary-button welcome-credit-accept-button" type="button" disabled={busy} onClick={() => void handleWelcomeCredit()}>
                {busy ? "受取中…" : "受け取る"}
              </button>
            </div>
          </div>
        </div>
      )}

    </>
  );
}
