import type { Dispatch, SetStateAction } from "react";
import type { PurchaseDialog, PurchaseUnit } from "./platform-types";
import { formatPurchasePrice } from "./purchase-utils";

export interface CreditPurchaseDialogsProps {
  purchasesEnabled?: boolean;
  purchaseDialog: PurchaseDialog;
  setPurchaseDialog: Dispatch<SetStateAction<PurchaseDialog>>;
  purchaseUnit: PurchaseUnit;
  setPurchaseUnit: Dispatch<SetStateAction<PurchaseUnit>>;
  purchasedCredits: number;
  purchaseError: string;
  setPurchaseError: Dispatch<SetStateAction<string>>;
  setPurchaseCheck: Dispatch<SetStateAction<number>>;
  busy: boolean;
  setPlayDialog: Dispatch<SetStateAction<"confirm" | "insufficient" | null>>;
  handlePurchase: () => Promise<void>;
  closePurchaseComplete: () => void;
  requestUserRegistration: () => void;
}

export function CreditPurchaseDialogs({ purchaseDialog, setPurchaseDialog, purchaseUnit, setPurchaseUnit, purchasedCredits, purchaseError, setPurchaseError, setPurchaseCheck, busy, setPlayDialog, handlePurchase, closePurchaseComplete, requestUserRegistration, purchasesEnabled = false }: CreditPurchaseDialogsProps) {
  return (
    <>
      {purchasesEnabled && purchaseDialog === "select" && (
        <div className="platform-overlay platform-overlay-front" role="dialog" aria-modal="true" aria-labelledby="purchase-title">
          <div className="platform-dialog">
            <p className="eyebrow">Credit Shop</p>
            <h2 id="purchase-title">クレジットを購入</h2>
            <p>5クレジットを1単位として、購入する単位数を選んでください。</p>
            <div className="credit-package-grid" role="radiogroup" aria-label="購入単位">
              {([1, 3, 5, 10] as PurchaseUnit[]).map((unit) => {
                const credits = unit === 10 ? 60 : unit * 5;
                const selected = purchaseUnit === unit;
                return (
                  <button
                    key={unit}
                    className={selected ? "credit-package is-selected" : "credit-package"}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => setPurchaseUnit(unit)}
                  >
                    <span>{unit}単位</span>
                    <strong>{credits}クレジット</strong>
                    <small>{formatPurchasePrice(unit)}</small>
                    {unit === 10 && <em>10クレジット ボーナス</em>}
                  </button>
                );
              })}
            </div>
            <div className="platform-dialog-actions">
              <button type="button" disabled={busy} onClick={() => {
                setPurchaseDialog(null);
                setPlayDialog("insufficient");
              }}>
                戻る
              </button>
              <button className="platform-primary-button" type="button" disabled={busy} onClick={() => void handlePurchase()}>
                {busy ? "Stripeへ接続中…" : `${formatPurchasePrice(purchaseUnit)}で購入`}
              </button>
            </div>
          </div>
        </div>
      )}

      {purchaseDialog === "processing" && (
        <div className="platform-overlay platform-overlay-front" role="dialog" aria-modal="true" aria-labelledby="purchase-processing-title">
          <div className="platform-dialog platform-dialog-small">
            <p className="eyebrow">Payment Confirmation</p>
            <h2 id="purchase-processing-title">決済を確認しています</h2>
            <p>Stripeからの決済完了通知を確認後、クレジットを付与します。</p>
            {purchaseError && <>
              <p className="platform-inline-error" role="alert">{purchaseError}</p>
              <div className="platform-dialog-actions">
                <button type="button" onClick={() => { setPurchaseDialog(null); setPurchaseError(""); }}>閉じる</button>
                <button type="button" onClick={() => setPurchaseCheck(value => value + 1)}>再確認</button>
              </div>
            </>}
          </div>
        </div>
      )}

      {purchaseDialog === "complete" && (
        <div className="platform-overlay platform-overlay-front" role="dialog" aria-modal="true" aria-labelledby="purchase-complete-title">
          <div className="platform-dialog">
            <p className="eyebrow">Payment Complete</p>
            <h2 id="purchase-complete-title">購入が完了しました</h2>
            <p><strong>{purchasedCredits}クレジット</strong>を付与しました。</p>
            <div className="account-link-panel">
              <strong>ほかの端末でもクレジットを利用できます</strong>
              <p>ユーザー登録すると、別のブラウザ・PC・スマートフォンでも購入クレジットを共有できます。</p>
              <button type="button" onClick={requestUserRegistration}>
                ユーザー登録へ
              </button>
            </div>
            <button className="platform-primary-button" type="button" onClick={closePurchaseComplete}>
              クレジット投入画面に戻る
            </button>
          </div>
        </div>
      )}

    </>
  );
}
