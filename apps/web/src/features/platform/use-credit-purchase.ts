import { useEffect, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { createCreditCheckout, fetchCreditPurchaseStatus, PlatformApiError, type WalletSummary } from "./platform-client";
import type { PendingPlayAction, PurchaseDialog, PurchaseUnit } from "./platform-types";
import { cleanPurchaseParams, getPurchaseCurrency, restoreStoredPlayAction, storePendingPlayAction } from "./purchase-utils";
import { notifications } from "../notifications/notifications";

interface CreditPurchaseOptions {
  pendingAction: PendingPlayAction | null;
  setPendingAction: Dispatch<SetStateAction<PendingPlayAction | null>>;
  setPlayDialog: Dispatch<SetStateAction<"confirm" | "insufficient" | null>>;
  setBusy: Dispatch<SetStateAction<boolean>>;
  updateWallet: (wallet: WalletSummary) => void;
}

export function useCreditPurchase({ pendingAction, setPendingAction, setPlayDialog, setBusy, updateWallet }: CreditPurchaseOptions) {
  const [purchaseDialog, setPurchaseDialog] = useState<PurchaseDialog>(null);
  const [purchaseUnit, setPurchaseUnit] = useState<PurchaseUnit>(1);
  const [purchasedCredits, setPurchasedCredits] = useState(0);
  const [purchaseError, setPurchaseError] = useState("");
  const [purchaseCheck, setPurchaseCheck] = useState(0);

  useEffect(() => {
    const url = new URL(window.location.href);
    const purchaseResult = url.searchParams.get("purchase");
    const checkoutSessionId = url.searchParams.get("session_id");
    if (purchaseResult === "cancelled") {
      cleanPurchaseParams(url);
      restoreStoredPlayAction(setPendingAction);
      setPlayDialog("insufficient");
      return;
    }
    if (purchaseResult !== "success" || !checkoutSessionId) return;

    setPurchaseDialog("processing");
    setPurchaseError("");
    let cancelled = false;
    let pollTimer = 0;
    let attempts = 0;
    const pollPurchase = async () => {
      attempts += 1;
      try {
        const result = await fetchCreditPurchaseStatus(checkoutSessionId);
        if (cancelled) return;
        updateWallet(result.wallet);
        if (result.status === "paid") {
          setPurchasedCredits(result.creditAmount);
          setPurchaseDialog("complete");
          cleanPurchaseParams(url);
          return;
        }
      } catch {
      }
      if (attempts < 15 && !cancelled) {
        pollTimer = window.setTimeout(() => void pollPurchase(), 1000);
      } else if (!cancelled) {
        setPurchaseError("決済状況を確認できません。プロフィールの残高を再読み込みしてください。");
      }
    };
    void pollPurchase();
    return () => {
      cancelled = true;
      window.clearTimeout(pollTimer);
    };
  }, [purchaseCheck]);

  const handlePurchase = async () => {
    setBusy(true);
    notifications.dismiss("purchase-checkout");
    try {
      storePendingPlayAction(pendingAction);
      const currency = getPurchaseCurrency();
      const checkout = await createCreditCheckout(
        purchaseUnit,
        currency,
        `${window.location.pathname}${window.location.search}`,
      );
      window.location.assign(checkout.checkoutUrl);
    } catch (error) {
      const errorCode = error instanceof PlatformApiError ? error.code : "";
      notifications.show({ id: "purchase-checkout", type: "error", message: errorCode === "stripe_not_configured"
        ? "Stripeのテスト用設定が完了していません。"
        : errorCode === "stripe_test_key_required"
          ? "ローカル開発ではStripeのテスト用Secret Keyを使用してください。"
          : "購入画面を開けませんでした。もう一度お試しください。" });
      setBusy(false);
    }
  };

  const closePurchaseComplete = () => {
    setPurchaseDialog(null);
    setPurchasedCredits(0);
    const restored = restoreStoredPlayAction(setPendingAction);
    window.sessionStorage.removeItem("vgc_pending_play_action");
    setPlayDialog(restored ? "confirm" : null);
  };

  return {
    purchaseDialog, setPurchaseDialog, purchaseUnit, setPurchaseUnit,
    purchasedCredits, purchaseError, setPurchaseError, setPurchaseCheck,
    handlePurchase, closePurchaseComplete,
  };
}
