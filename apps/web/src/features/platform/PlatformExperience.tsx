import { usePlatformAccount } from "./use-platform-account";
import { useCreditPurchase } from "./use-credit-purchase";
import { PlatformProfile } from "./PlatformProfile";
import { AccountRegistrationDialog } from "./AccountRegistrationDialog";
import { ConsentDialog } from "./ConsentDialog";
import { WelcomeCreditDialog } from "./WelcomeCreditDialog";
import { CreditPurchaseDialogs } from "./CreditPurchaseDialogs";
import type { PlayAction } from "../../game-sdk/contracts";
import { gameHost } from "../../game-sdk/game-host";
import { executePlay } from "./play-service";
import { notifications } from "../notifications/notifications";
import { liveSharing, shareLive } from "../sharing/share-service";
import { useCallback, useEffect, useRef, useState } from "react";
import { DataDeletionDialog } from "./DataDeletionDialog";
import {
  acceptPolicies,
  claimWelcomeCredit,
  fetchPlatformBootstrap,
  PlatformApiError,
  type PlatformBootstrap,
  type WalletSummary,
} from "./platform-client";
import { resolveGameDefinition } from "../../domain/game";
import {
  recordPlayStartedFromWatch,
} from "../engagement/engagement-client";

export function PlatformExperience({ standaloneCredits = false }: { standaloneCredits?: boolean } = {}) {
  const promoCaptureMode = import.meta.env.DEV
    && new URLSearchParams(window.location.search).get("promoCapture") === "1";
  const [platform, setPlatform] = useState<PlatformBootstrap | null>(null);
  const purchasesEnabled = platform?.creditPolicy?.purchasesEnabled === true;

  const [pendingAction, setPendingAction] = useState<PlayAction | null>(null);
  const [playDialog, setPlayDialog] = useState<"confirm" | "insufficient" | null>(null);
  const [busy, setBusy] = useState(false);
  const [welcomeDialogOpen, setWelcomeDialogOpen] = useState(false);
  const declinedCreditRequest = useRef<(() => void) | null>(null);
  const confirmingPlay = useRef(false);
  const playRequested = useRef(false);

  const loadPlatform = useCallback(async () => {
    notifications.dismiss("platform-load");
    try {
      const updated = await fetchPlatformBootstrap();
      setPlatform(updated);
      if (updated.creditPolicy?.refilledAmount) notifications.show({ id: "daily-credit", type: "success", message: `本日の無料クレジットを${updated.creditPolicy.refilledAmount}枚補充しました。` });
    } catch {
      notifications.show({ id: "platform-load", type: "error", message: "プレイヤー情報を読み込めませんでした。", action: { label: "再読み込み", run: loadPlatform } });
    }
  }, []);

  const {
    profileOpen, setProfileOpen, profileRef,
    accountDialogOpen, setAccountDialogOpen,
    consentPurpose, setConsentPurpose,
    editingName, setEditingName, nameDraft, setNameDraft,
    requestUserRegistration, savePlayerName, handleLogout,
  } = usePlatformAccount({ platform, setPlatform, setBusy, loadPlatform });

  const updateWallet = (wallet: WalletSummary) => {
    setPlatform((current) => current ? { ...current, wallet } : current);
  };

  const {
    purchaseDialog, setPurchaseDialog, purchaseUnit, setPurchaseUnit,
    purchasedCredits, purchaseError, setPurchaseError, setPurchaseCheck,
    handlePurchase, closePurchaseComplete,
  } = useCreditPurchase({ pendingAction, setPendingAction, setPlayDialog, setBusy, updateWallet, purchasesEnabled });

  useEffect(() => {
    void loadPlatform();
  }, [loadPlatform]);

  useEffect(() => {
    const refreshWallet = () => void loadPlatform();
    window.addEventListener("platform-wallet-changed", refreshWallet);
    return () => window.removeEventListener("platform-wallet-changed", refreshWallet);
  }, [loadPlatform]);

  useEffect(() => {
    if (!standaloneCredits) return;
    const topUp = (event: Event) => {
      const request = (event as CustomEvent<{ onDecline?: () => void }>).detail;
      declinedCreditRequest.current = request?.onDecline ?? null;
      setPendingAction(null);
      setPlayDialog(null);
      setPurchaseDialog(null);
      if (platform && !platform.welcomeCreditGranted) setWelcomeDialogOpen(true);
      else if (declinedCreditRequest.current) {
        const notify = declinedCreditRequest.current;
        declinedCreditRequest.current = null;
        notify();
      } else if (purchasesEnabled) setPurchaseDialog("select");
      else setPlayDialog("insufficient");
    };
    window.addEventListener("request-credit-topup", topUp);
    return () => window.removeEventListener("request-credit-topup", topUp);
  }, [standaloneCredits, platform, purchasesEnabled]);

  const requestPlay = useCallback((action: PlayAction) => {
    if (!platform || pendingAction || busy || confirmingPlay.current || playRequested.current) return;
    playRequested.current = true;
    setPendingAction(action);
    if (!platform.welcomeCreditGranted) {
      setWelcomeDialogOpen(true);
      return;
    }
    if (platform.wallet.availableTotal >= getCurrentGame().creditCost) {
      setPlayDialog("confirm");
      return;
    }
    setBusy(true);
    void fetchPlatformBootstrap().then(updated => {
      setPlatform(updated);
      if (updated.creditPolicy?.refilledAmount) notifications.show({ id: "daily-credit", type: "success", message: `本日の無料クレジットを${updated.creditPolicy.refilledAmount}枚補充しました。` });
      setPlayDialog(updated.wallet.availableTotal >= getCurrentGame().creditCost ? "confirm" : "insufficient");
    }).catch(() => {
      playRequested.current = false;
      setPendingAction(null);
      notifications.show({ id: "platform-credit", type: "error", message: "クレジットを確認できませんでした。もう一度お試しください。" });
    }).finally(() => setBusy(false));
  }, [platform, pendingAction, busy]);

  useEffect(() => gameHost.subscribe(requestPlay), [requestPlay]);

  useEffect(() => {
    if (standaloneCredits || !window.location.pathname.startsWith("/cabinets/")) return;
    const url = new URL(window.location.href);
    if (url.searchParams.get("watch") === "1") return;
    if (url.searchParams.has("start")) {
      url.searchParams.delete("start");
      window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    }
    void gameHost.selectSolo().catch(() => {
      notifications.show({ id: "platform", type: "error", message: "ゲームの準備に失敗しました。再読み込みしてください。" });
    });
  }, [standaloneCredits]);

  const cancelPlay = useCallback(() => {
    if (confirmingPlay.current || busy) return;
    window.sessionStorage.removeItem("vgc_pending_play_action");
    setPlayDialog(null);
    setPendingAction(null);
    playRequested.current = false;
  }, [busy]);

  useEffect(() => {
    if (!playDialog && !welcomeDialogOpen && !purchaseDialog) return;
    const blockGameInput = (event: KeyboardEvent) => {
      if (event.code === "Escape" && playDialog) {
        event.preventDefault(); cancelPlay();
      }
      // Keep native button activation, but never forward a dialog key to a game.
      event.stopPropagation();
    };
    window.addEventListener("keydown", blockGameInput, true);
    return () => window.removeEventListener("keydown", blockGameInput, true);
  }, [playDialog, welcomeDialogOpen, purchaseDialog, cancelPlay]);

  const handleConsent = async () => {
    if (!platform) return;
    setBusy(true);
    notifications.dismiss("platform");
    try {
      const result = await acceptPolicies(
        platform.consent.termsVersion,
        platform.consent.privacyVersion,
      );
      setPlatform({
        ...platform,
        consent: result.consent,
        wallet: result.wallet,
      });
      notifications.dismiss("platform-consent");
      const completedPurpose = consentPurpose;
      setConsentPurpose(null);
      if (completedPurpose === "registration") {
        setAccountDialogOpen(true);
      } else if (completedPurpose === "purchase" && purchasesEnabled) {
        setPurchaseDialog("select");
      }
    } catch {
      notifications.show({ id: "platform-consent", type: "error", message: "同意情報を保存できませんでした。", action: { label: "再試行", run: handleConsent } });
    } finally {
      setBusy(false);
    }
  };

  const handleWelcomeCredit = async () => {
    if (!platform) return;
    setBusy(true);
    try {
      const result = await claimWelcomeCredit();
      setPlatform({ ...platform, welcomeCreditGranted: true, wallet: result.wallet });
      setWelcomeDialogOpen(false);
      declinedCreditRequest.current = null;
      notifications.show({ id: "platform-welcome", type: "success", message: "無料5クレジットを受け取りました。" });
      setPlayDialog(standaloneCredits ? null : "confirm");
      if (standaloneCredits) window.dispatchEvent(new Event("platform-wallet-changed"));
    } catch {
      notifications.show({ id: "platform-welcome", type: "error", message: "無料クレジットを受け取れませんでした。" });
    } finally {
      setBusy(false);
    }
  };

  const skipWelcomeCredit = () => {
    setWelcomeDialogOpen(false);
    if (standaloneCredits) {
      const notify = declinedCreditRequest.current;
      declinedCreditRequest.current = null;
      if (notify) notify(); else if (purchasesEnabled) setPurchaseDialog("select");
      else setPlayDialog("insufficient");
      return;
    }
    setPlayDialog((platform?.wallet.availableTotal ?? 0) >= getCurrentGame().creditCost
      ? "confirm"
      : "insufficient");
  };

  const handlePlayConfirm = async () => {
    if (!platform || !pendingAction || confirmingPlay.current) return;
    confirmingPlay.current = true;
    setBusy(true);
    notifications.dismiss("platform");
    const gameId = getCurrentGame().id;
    const cabinetId = getCabinetId();
    try {
      const started = await executePlay({
        gameId,
        cabinetId,
        action: pendingAction,
        start: (action, reservationId) => gameHost.play(action, reservationId),
        walletChanged: updateWallet,
      });
      if (!started) {
        notifications.show({ id: "platform", type: "info", message: "ゲームを開始できなかったため、クレジットを返却しました。" });
        return;
      }
      recordPlayStartedFromWatch(gameId, cabinetId);
      notifications.show({ id: "platform", type: "success", message: "1クレジットを使用しました。" });
      setPlayDialog(null);
      setPendingAction(null);
      playRequested.current = false;
    } catch (error) {
      if (error instanceof PlatformApiError && error.code === "insufficient_credit") {
        if (error.wallet) updateWallet(error.wallet);
        setPlayDialog("insufficient");
      } else if (error instanceof Error && error.message === "game_start_confirmation_pending") {
        notifications.show({ id: "platform", type: "error", message: "開始確認がタイムアウトしました。クレジットは使用済みです。再読み込み前にゲーム画面を確認してください。" });
      } else {
        notifications.show({ id: "platform", type: "error", message: "ゲーム開始処理に失敗しました。もう一度お試しください。" });
      }
    } finally {
      confirmingPlay.current = false;
      setBusy(false);
    }
  };

  const shareCabinetUrl = async () => {
    const context = liveSharing.getSnapshot();
    await shareLive(context ?? { gameId: getCurrentGame().id, cabinetId: getCabinetId(), role: "player", phase: "ready" });
  };

  useEffect(() => {
    const shareCabinet = () => void shareCabinetUrl();
    window.addEventListener("request-cabinet-share", shareCabinet);
    return () => window.removeEventListener("request-cabinet-share", shareCabinet);
  });

  const wallet = platform?.wallet;

  if (promoCaptureMode) return null;

  return (
    <>
      <PlatformProfile
        refreshCredits={() => void loadPlatform()}
        platform={platform}
        profileOpen={profileOpen}
        profileRef={profileRef}
        setProfileOpen={setProfileOpen}
        editingName={editingName}
        setEditingName={setEditingName}
        nameDraft={nameDraft}
        setNameDraft={setNameDraft}
        busy={busy}
        savePlayerName={savePlayerName}
        handleLogout={handleLogout}
        requestUserRegistration={requestUserRegistration}
        standaloneCredits={standaloneCredits}
      />

      <DataDeletionDialog />

      <AccountRegistrationDialog
        accountDialogOpen={accountDialogOpen}
        setAccountDialogOpen={setAccountDialogOpen}
        platform={platform}
      />

      <ConsentDialog
        consentPurpose={consentPurpose}
        setConsentPurpose={setConsentPurpose}
        busy={busy}
        handleConsent={handleConsent}
      />

      <WelcomeCreditDialog
        welcomeDialogOpen={welcomeDialogOpen}
        busy={busy}
        skipWelcomeCredit={skipWelcomeCredit}
        handleWelcomeCredit={handleWelcomeCredit}
      />

      {playDialog && (
        <div className="platform-overlay" role="dialog" aria-modal="true" aria-labelledby="play-credit-title">
          <div className="platform-dialog platform-dialog-small">
            <p className="eyebrow">1 Credit</p>
            <h2 id="play-credit-title">
              {playDialog === "confirm" ? "ゲームを開始しますか？" : "クレジットが不足しています"}
            </h2>
            {playDialog === "confirm" ? (
              <p>
                開始時に1クレジットを使用します。現在の利用可能残高は
                <strong> {wallet?.availableTotal ?? 0}枚</strong>です。
              </p>
            ) : (
              <p>
                {purchasesEnabled ? "ゲーム開始には1クレジット必要です。クレジットを購入しますか？" : "無料ベータ期間中は購入できません。毎日、残高が3枚未満なら3枚まで補充します（日本時間・1日1回）。本日の補充が利用済みなら、翌日またお越しください。"}
              </p>
            )}
            <div className={`platform-dialog-actions play-credit-actions${playDialog === "confirm" ? " is-confirm" : ""}`}>
              {playDialog === "confirm" && (
                <button
                  className="cabinet-share-button platform-share-icon-button"
                  type="button"
                  aria-label="観戦用画面を共有"
                  title="観戦用画面を共有"
                  onClick={() => void shareCabinetUrl()}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <circle cx="18" cy="5" r="3" />
                    <circle cx="6" cy="12" r="3" />
                    <circle cx="18" cy="19" r="3" />
                    <path d="m8.7 10.7 6.6-4.2M8.7 13.3l6.6 4.2" />
                  </svg>
                </button>
              )}
              <button className="platform-cancel-button" type="button" disabled={busy} onClick={cancelPlay}>
                {playDialog === "confirm" ? "キャンセル" : purchasesEnabled ? "いいえ" : "閉じる"}
              </button>
              {playDialog === "confirm" && (
                <button className="platform-primary-button play-credit-start-button" type="button" disabled={busy} onClick={() => void handlePlayConfirm()}>
                  {busy ? "準備中…" : "1クレジットで開始"}
                </button>
              )}
              {playDialog === "insufficient" && purchasesEnabled && (
                <button className="platform-primary-button" type="button" onClick={() => {
                  setPlayDialog(null);
                  setPurchaseDialog("select");
                }}>
                  はい
                </button>
              )}
              {playDialog === "insufficient" && !purchasesEnabled && !platform?.accountRegistered && (
                <button className="platform-primary-button" type="button" onClick={() => {
                  setPlayDialog(null);
                  requestUserRegistration();
                }}>
                  ユーザー登録で5枚を受け取る
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      <CreditPurchaseDialogs
        purchasesEnabled={purchasesEnabled}
        purchaseDialog={purchaseDialog}
        setPurchaseDialog={setPurchaseDialog}
        purchaseUnit={purchaseUnit}
        setPurchaseUnit={setPurchaseUnit}
        purchasedCredits={purchasedCredits}
        purchaseError={purchaseError}
        setPurchaseError={setPurchaseError}
        setPurchaseCheck={setPurchaseCheck}
        busy={busy}
        setPlayDialog={setPlayDialog}
        handlePurchase={handlePurchase}
        closePurchaseComplete={closePurchaseComplete}
        requestUserRegistration={requestUserRegistration}
      />

    </>
  );
}

function getCabinetId(): string {
  const match = window.location.pathname.match(/^\/cabinets\/([a-zA-Z0-9-]+)/);
  return match?.[1] ?? "local-cabinet";
}

function getCurrentGame() {
  return resolveGameDefinition(new URL(window.location.href).searchParams.get("game"));
}
