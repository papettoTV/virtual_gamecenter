import type { Dispatch, SetStateAction } from "react";
import type { ConsentPurpose } from "./platform-types";

export interface ConsentDialogProps {
  consentPurpose: ConsentPurpose | null;
  setConsentPurpose: Dispatch<SetStateAction<ConsentPurpose | null>>;
  busy: boolean;
  handleConsent: () => Promise<void>;
}

export function ConsentDialog({ consentPurpose, setConsentPurpose, busy, handleConsent }: ConsentDialogProps) {
  return (
    <>
      {consentPurpose && (
        <div className="platform-overlay" role="dialog" aria-modal="true" aria-labelledby="consent-title">
          <div className="platform-dialog platform-consent-dialog">
            <button
              className="platform-dialog-close"
              type="button"
              aria-label="規約確認を閉じる"
              disabled={busy}
              onClick={() => setConsentPurpose(null)}
            >
              × 閉じる
            </button>
            <p className="eyebrow">Terms & Privacy</p>
            <h2 id="consent-title">サービスを利用する前に</h2>
            <p>
              利用規約への同意と、プライバシーポリシーの確認が必要です。
            </p>
            <div className="policy-frame-list">
              <section>
                <h3>利用規約</h3>
                <iframe title="利用規約全文" src="/legal/terms.html" />
              </section>
              <section>
                <h3>プライバシーポリシー</h3>
                <iframe title="プライバシーポリシー全文" src="/legal/privacy.html" />
              </section>
            </div>
            <button className="platform-primary-button" type="button" disabled={busy} onClick={() => void handleConsent()}>
              {busy ? "保存中…" : "同意して続ける"}
            </button>
          </div>
        </div>
      )}

    </>
  );
}
