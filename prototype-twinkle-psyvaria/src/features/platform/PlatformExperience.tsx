import { notifications } from "../notifications/notifications";
import { copySharedText } from "../notifications/share";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  acceptPolicies,
  capturePlayCredit,
  claimWelcomeCredit,
  createGoogleRegistrationUrl,
  createDeveloperLoginUrl,
  createCreditCheckout,
  fetchCreditPurchaseStatus,
  fetchPlatformBootstrap,
  PlatformApiError,
  releasePlayCredit,
  reservePlayCredit,
  logoutUser,
  updatePlayerName,
  type PlatformBootstrap,
  type WalletSummary,
} from "./platform-client";
import { resolveGameDefinition } from "../../domain/game";
import { BRAND } from "../../domain/brand";
import {
  createTrackedWatchUrl,
  recordPlayStartedFromWatch,
  recordShareCreated,
} from "../engagement/engagement-client";

type PolicyKind = "terms" | "privacy";
type PendingPlayAction =
  | { type: "button"; button: HTMLButtonElement }
  | { type: "restartKey" };
type PurchaseUnit = 1 | 3 | 5 | 10;
type ConsentPurpose = "registration" | "purchase";

const PLAY_BUTTON_IDS = new Set(["start-solo", "ranking-retry"]);

export function PlatformExperience({ standaloneCredits = false }: { standaloneCredits?: boolean } = {}) {
  const promoCaptureMode = import.meta.env.DEV
    && new URLSearchParams(window.location.search).get("promoCapture") === "1";
  const [platform, setPlatform] = useState<PlatformBootstrap | null>(null);

  const [policy, setPolicy] = useState<PolicyKind | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingPlayAction | null>(null);
  const [playDialog, setPlayDialog] = useState<"confirm" | "insufficient" | null>(null);
  const [purchaseDialog, setPurchaseDialog] = useState<"select" | "processing" | "complete" | null>(null);
  const [purchaseUnit, setPurchaseUnit] = useState<PurchaseUnit>(1);
  const [purchasedCredits, setPurchasedCredits] = useState(0);
  const [purchaseError, setPurchaseError] = useState("");
  const [busy, setBusy] = useState(false);
  const [purchaseCheck, setPurchaseCheck] = useState(0);
  const [profileOpen, setProfileOpen] = useState(false);
  const [accountDialogOpen, setAccountDialogOpen] = useState(false);
  const [consentPurpose, setConsentPurpose] = useState<ConsentPurpose | null>(null);
  const [welcomeDialogOpen, setWelcomeDialogOpen] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const bypassGate = useRef(false);
  const profileRef = useRef<HTMLDivElement>(null);

  const loadPlatform = useCallback(async () => {
    notifications.dismiss("platform-load");
    try {
      setPlatform(await fetchPlatformBootstrap());
    } catch {
      notifications.show({ id: "platform-load", type: "error", message: "プレイヤー情報を読み込めませんでした。", action: { label: "再読み込み", run: loadPlatform } });
    }
  }, []);

  useEffect(() => {
    void loadPlatform();
  }, [loadPlatform]);

  useEffect(() => {
    const url = new URL(window.location.href);
    const result = url.searchParams.get("account");
    if (!result) return;
    if (result === "registered") {
      notifications.show({ id: "platform-account", type: "success", message: "ユーザー登録が完了し、5クレジットを追加しました。" });
      void loadPlatform();
      window.dispatchEvent(new Event("restore-ranking-registration"));
    } else {
      notifications.show({ id: "platform", type: url.searchParams.get("reason") === "cancelled" ? "info" : "error", message: accountErrorMessage(url.searchParams.get("reason")) });
    }
    url.searchParams.delete("account");
    url.searchParams.delete("reason");
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
  }, [loadPlatform]);

  useEffect(() => {
    if (!platform?.playerName) return;
    const rankingName = document.querySelector<HTMLInputElement>("#ranking-name");
    const rankingNameDisplay = document.querySelector<HTMLElement>("#ranking-name-display");
    const registrationHint = document.querySelector<HTMLElement>("#ranking-user-registration");
    if (rankingName) {
      rankingName.value = platform.playerName;
      rankingName.dispatchEvent(new Event("input", { bubbles: true }));
    }
    if (rankingNameDisplay) rankingNameDisplay.textContent = platform.playerName;
    if (registrationHint) registrationHint.hidden = platform.accountRegistered;
  }, [platform?.accountRegistered, platform?.playerName]);

  useEffect(() => {
    const openRegistration = () => {
      if (!platform?.consent.accepted) {
        setConsentPurpose("registration");
      } else {
        setAccountDialogOpen(true);
      }
    };
    window.addEventListener("request-user-registration", openRegistration);
    return () => window.removeEventListener("request-user-registration", openRegistration);
  }, [platform?.consent.accepted]);

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

  useEffect(() => {
    const refreshWallet = () => void loadPlatform();
    window.addEventListener("platform-wallet-changed", refreshWallet);
    return () => window.removeEventListener("platform-wallet-changed", refreshWallet);
  }, [loadPlatform]);

  useEffect(() => {
    if (!standaloneCredits) return;
    const topUp = () => {
      setPendingAction(null);
      if (platform && !platform.welcomeCreditGranted) setWelcomeDialogOpen(true);
      else setPurchaseDialog("select");
    };
    window.addEventListener("request-credit-topup", topUp);
    return () => window.removeEventListener("request-credit-topup", topUp);
  }, [standaloneCredits, platform]);

  useEffect(() => {
    if (!profileOpen) return;

    const closeProfile = (event: MouseEvent) => {
      if (!profileRef.current?.contains(event.target as Node)) {
        setProfileOpen(false);
      }
    };
    const closeProfileWithEscape = (event: KeyboardEvent) => {
      if (event.code === "Escape") setProfileOpen(false);
    };

    document.addEventListener("click", closeProfile);
    window.addEventListener("keydown", closeProfileWithEscape);
    return () => {
      document.removeEventListener("click", closeProfile);
      window.removeEventListener("keydown", closeProfileWithEscape);
    };
  }, [profileOpen]);

  const requestPlay = useCallback((action: PendingPlayAction) => {
    if (!platform) return;
    setPendingAction(action);
    if (!platform.welcomeCreditGranted) {
      setWelcomeDialogOpen(true);
      return;
    }
    setPlayDialog(
      platform.wallet.availableTotal >= getCurrentGame().creditCost
        ? "confirm"
        : "insufficient",
    );
  }, [platform]);

  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      if (bypassGate.current) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const button = target.closest<HTMLButtonElement>("button");
      if (!button || !PLAY_BUTTON_IDS.has(button.id) || button.disabled) return;
      if (button.id === "start-solo" && button.textContent?.includes("観戦")) return;

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      requestPlay({ type: "button", button });
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (bypassGate.current || event.code !== "KeyR") return;
      const gameScreen = document.querySelector("#game-screen");
      if (!gameScreen || gameScreen.classList.contains("is-hidden")) return;
      if (document.body.classList.contains("is-spectator")) return;

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      requestPlay({ type: "restartKey" });
    };

    document.addEventListener("click", handleClick, true);
    window.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("click", handleClick, true);
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [requestPlay]);

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
      } else if (completedPurpose === "purchase") {
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
    if (standaloneCredits) { setPurchaseDialog("select"); return; }
    setPlayDialog((platform?.wallet.availableTotal ?? 0) >= getCurrentGame().creditCost
      ? "confirm"
      : "insufficient");
  };

  const requestUserRegistration = () => {
    setProfileOpen(false);
    if (!platform?.consent.accepted) {
      setConsentPurpose("registration");
      return;
    }
    setAccountDialogOpen(true);
  };

  const handlePlayConfirm = async () => {
    if (!platform || !pendingAction) return;
    setBusy(true);
    notifications.dismiss("platform");
    let reservationId: string | null = null;
    try {
      const reservation = await reservePlayCredit(getCabinetId(), getCurrentGame().id);
      reservationId = reservation.reservationId;
      updateWallet(reservation.wallet);
      replayPlayAction(pendingAction);

      await new Promise((resolve) => window.setTimeout(resolve, 50));
      const gameScreen = document.querySelector("#game-screen");
      if (!gameScreen || gameScreen.classList.contains("is-hidden")) {
        const released = await releasePlayCredit(reservation.reservationId);
        updateWallet(released.wallet);
        notifications.show({ id: "platform", type: "info", message: "ゲームを開始できなかったため、クレジットを返却しました。" });
        return;
      }

      const captured = await capturePlayCredit(reservation.reservationId);
      updateWallet(captured.wallet);
      recordPlayStartedFromWatch(getCurrentGame().id, getCabinetId());
      notifications.show({ id: "platform", type: "success", message: "1クレジットを使用しました。" });
      setPlayDialog(null);
      setPendingAction(null);
    } catch (error) {
      if (reservationId) {
        try {
          const released = await releasePlayCredit(reservationId);
          updateWallet(released.wallet);
        } catch {
          notifications.show({ id: "platform", type: "error", message: "クレジット状態を確認できません。画面を再読み込みしてください。" });
        }
      }
      if (error instanceof PlatformApiError && error.code === "insufficient_credit") {
        if (error.wallet) updateWallet(error.wallet);
        setPlayDialog("insufficient");
      } else {
        notifications.show({ id: "platform", type: "error", message: "ゲーム開始処理に失敗しました。もう一度お試しください。" });
      }
    } finally {
      setBusy(false);
    }
  };

  const shareCabinetUrl = async () => {
    const baseShareUrl = await resolveCabinetShareUrl();
    const trackedShare = createTrackedWatchUrl(baseShareUrl);
    try {
      if (navigator.share) {
        try {
          await navigator.share({
            title: getCurrentGame().title,
            text: "いま行われているライブプレイを一緒に観戦できます。",
            url: trackedShare.url,
          });
          recordShareCreated(getCurrentGame().id, getCabinetId(), trackedShare.shareId);
          return;
        } catch (error) {
          if (error instanceof DOMException && error.name === "AbortError") return;
        }
      }
      await copySharedText(trackedShare.url, "platform-share");
      recordShareCreated(getCurrentGame().id, getCabinetId(), trackedShare.shareId);

    } catch {}
  };

  useEffect(() => {
    const shareCabinet = () => void shareCabinetUrl();
    window.addEventListener("request-cabinet-share", shareCabinet);
    return () => window.removeEventListener("request-cabinet-share", shareCabinet);
  });

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

  const updateWallet = (wallet: WalletSummary) => {
    setPlatform((current) => current ? { ...current, wallet } : current);
  };

  const replayPlayAction = (action: PendingPlayAction) => {
    bypassGate.current = true;
    if (action.type === "button") {
      if (action.button.id === "start-solo") {
        window.dispatchEvent(new CustomEvent("platform-play-approved", {
          detail: { gameId: getCurrentGame().id },
        }));
      }
      action.button.click();
    } else {
      window.dispatchEvent(new KeyboardEvent("keydown", {
        key: "r",
        code: "KeyR",
        bubbles: true,
      }));
    }
    bypassGate.current = false;
  };

  const wallet = platform?.wallet;

  const savePlayerName = async () => {
    const playerName = nameDraft.trim();
    if (!playerName || playerName.length > 24) {
      notifications.show({ id: "platform-name", type: "error", message: "名前は1〜24文字で入力してください。" });
      return;
    }
    setBusy(true);
    try {
      const { identity } = await updatePlayerName(playerName);
      setPlatform((current) => current ? { ...current, ...identity } : current);
      setEditingName(false);
      notifications.show({ id: "platform-name", type: "success", message: "名前を変更しました。" });
    } catch {
      notifications.show({ id: "platform-name", type: "error", message: "名前を変更できませんでした。" });
    } finally {
      setBusy(false);
    }
  };

  const handleLogout = async () => {
    setBusy(true);
    try {
      const guestPlatform = await logoutUser();
      setPlatform(guestPlatform);
      setProfileOpen(false);
      setEditingName(false);
      notifications.show({ id: "platform-logout", type: "success", message: "ログアウトしました。" });
      window.history.pushState({}, "", "/");
      window.dispatchEvent(new PopStateEvent("popstate"));
    } catch {
      notifications.show({ id: "platform-logout", type: "error", message: "ログアウトできませんでした。" });
    } finally {
      setBusy(false);
    }
  };

  if (promoCaptureMode) return null;

  return (
    <>
      <div className="platform-profile" ref={profileRef}>
        <button
          className="platform-profile-button"
          type="button"
          aria-label="プロフィールを表示"
          aria-expanded={profileOpen}
          aria-controls="platform-profile-menu"
          onClick={() => setProfileOpen((open) => !open)}
        >
          <span className="platform-profile-icon" aria-hidden="true">
            <span />
          </span>
          {wallet && <span className="platform-credit-badge">{wallet.availableTotal}</span>}
        </button>

        {profileOpen && (
          <section id="platform-profile-menu" className="platform-profile-menu" aria-label="プレイヤー情報">
            <p className="eyebrow">Player Profile</p>
            <div className="platform-profile-summary">
              <span className="platform-profile-avatar" aria-label="プロフィールアイコン">
                {platform?.avatarUrl
                  ? <img src={platform.avatarUrl} alt="" referrerPolicy="no-referrer" />
                  : <span />}
              </span>
              <div>
                {!platform?.accountRegistered && (
                  <span className="platform-account-state">ゲスト</span>
                )}
                {platform?.accountRegistered ? (
                  editingName ? (
                    <div className="platform-name-editor">
                      <input
                        aria-label="ユーザー名"
                        maxLength={24}
                        value={nameDraft}
                        onChange={(event) => setNameDraft(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") void savePlayerName();
                          if (event.key === "Escape") setEditingName(false);
                        }}
                        autoFocus
                      />
                      <button type="button" disabled={busy} onClick={() => void savePlayerName()}>保存</button>
                    </div>
                  ) : (
                    <button
                      className="platform-profile-name platform-profile-name-button"
                      type="button"
                      title="名前を変更"
                      onClick={() => {
                        setNameDraft(platform.playerName);
                        setEditingName(true);
                      }}
                    >
                      {platform.playerName}
                    </button>
                  )
                ) : (
                  <strong className="platform-profile-name">
                    {platform?.playerName ?? "読み込み中"}
                  </strong>
                )}
                <span className="platform-player-id">
                  {platform ? `ID ${platform.playerId.slice(0, 8)}` : "読み込み中"}
                </span>
                {!platform?.accountRegistered && (
                  <button
                    className="platform-account-register-button"
                    type="button"
                    onClick={requestUserRegistration}
                  >
                    ユーザー登録で名前を変更
                  </button>
                )}
              </div>
            </div>
            <div className="platform-wallet">
              <span>利用可能クレジット</span>
              <strong>{wallet ? wallet.availableTotal : "—"}</strong>
              {wallet && (
                <small>
                  無料 {wallet.availableFree} / 購入 {wallet.availablePurchased}
                </small>
              )}
            </div>
            {standaloneCredits && <button type="button" onClick={() => window.dispatchEvent(new Event("request-credit-topup"))}>クレジットを追加</button>}
            {platform?.accountRegistered && (
              <button
                className="platform-logout-button"
                type="button"
                disabled={busy}
                onClick={() => void handleLogout()}
              >
                {busy ? "ログアウト中…" : "ログアウト"}
              </button>
            )}
          </section>
        )}
      </div>



      {accountDialogOpen && (
        <div className="platform-overlay platform-overlay-front" role="dialog" aria-modal="true" aria-labelledby="account-register-title">
          <div className="platform-dialog platform-account-dialog">
            <button
              className="platform-dialog-close"
              type="button"
              aria-label="ユーザー登録を閉じる"
              onClick={() => setAccountDialogOpen(false)}
            >
              × 閉じる
            </button>
            <p className="eyebrow">User Registration</p>
            <h2 id="account-register-title">ユーザー登録</h2>
            <p>Googleアカウントで登録します。登録後はこの画面へ戻ります。</p>
            <ul className="platform-account-benefits">
              <li>現在のクレジットとプレイ情報を引き継ぐ</li>
              <li>登録特典として5クレジットを追加</li>
              <li>ほかの端末でも同じクレジットを利用</li>
              <li>Googleの名前とアイコンをプロフィールに設定</li>
            </ul>
            <button
              className="platform-google-button"
              type="button"
              onClick={() => {
                window.dispatchEvent(new Event("prepare-user-registration"));
                const returnTo = `${window.location.pathname}${window.location.search}${window.location.hash}`;
                window.location.assign(createGoogleRegistrationUrl(returnTo));
              }}
            >
              <span aria-hidden="true">G</span>
              Googleで登録
            </button>
            {platform?.developerLoginAvailable && (
              <button
                className="platform-developer-login-button"
                type="button"
                onClick={() => {
                  window.dispatchEvent(new Event("prepare-user-registration"));
                  const returnTo = `${window.location.pathname}${window.location.search}${window.location.hash}`;
                  window.location.assign(createDeveloperLoginUrl(returnTo));
                }}
              >
                開発者ユーザーでログイン
              </button>
            )}
          </div>
        </div>
      )}

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
                ゲーム開始には1クレジット必要です。クレジットを購入しますか？
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
              <button className="platform-cancel-button" type="button" onClick={() => {
                if (playDialog === "insufficient") {
                  window.sessionStorage.removeItem("vgc_pending_play_action");
                }
                setPlayDialog(null);
                setPendingAction(null);
              }}>
                {playDialog === "confirm" ? "キャンセル" : "いいえ"}
              </button>
              {playDialog === "confirm" && (
                <button className="platform-primary-button play-credit-start-button" type="button" disabled={busy} onClick={() => void handlePlayConfirm()}>
                  {busy ? "準備中…" : "1クレジットで開始"}
                </button>
              )}
              {playDialog === "insufficient" && (
                <button className="platform-primary-button" type="button" onClick={() => {
                  setPlayDialog(null);
                  setPurchaseDialog("select");
                }}>
                  はい
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {purchaseDialog === "select" && (
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

      {policy && (
        <PolicyDialog kind={policy} onClose={() => setPolicy(null)} />
      )}

      <footer className="platform-footer">
        <strong>{BRAND.name} · {BRAND.category}</strong>
        <button type="button" onClick={() => setPolicy("terms")}>利用規約</button>
        <button type="button" onClick={() => setPolicy("privacy")}>プライバシーポリシー</button>
        <span>お問い合わせ（準備中）</span>
        <span>特定商取引法に基づく表記は有料化前に公開予定</span>
      </footer>
    </>
  );
}

function accountErrorMessage(reason: string | null): string {
  if (reason === "cancelled") return "ユーザー登録をキャンセルしました。";
  if (reason === "session_expired") return "セッションの有効期限が切れました。もう一度お試しください。";
  if (reason === "not_configured") return "Googleユーザー登録の設定が完了していません。";
  if (reason === "developer_auth_unavailable") return "開発者ログインはローカル開発環境でのみ利用できます。";
  if (reason === "policy_consent_required") return "ユーザー登録の前に利用規約への同意が必要です。";
  return "ユーザー登録を完了できませんでした。もう一度お試しください。";
}

function PolicyDialog({
  kind,
  onClose,
}: {
  kind: PolicyKind;
  onClose: () => void;
}) {
  const isTerms = kind === "terms";
  return (
    <div className="platform-overlay platform-overlay-front" role="dialog" aria-modal="true">
      <article className="platform-dialog policy-dialog">
        <button className="platform-dialog-close" type="button" aria-label="閉じる" onClick={onClose}>
          × 閉じる
        </button>
        <h2>{isTerms ? "利用規約（プロトタイプ版）" : "プライバシーポリシー（プロトタイプ版）"}</h2>
        <iframe
          className="policy-document-frame"
          title={isTerms ? "利用規約全文" : "プライバシーポリシー全文"}
          src={isTerms ? "/legal/terms.html" : "/legal/privacy.html"}
        />
      </article>
    </div>
  );
}

function getCabinetId(): string {
  const match = window.location.pathname.match(/^\/cabinets\/([a-zA-Z0-9-]+)/);
  return match?.[1] ?? "local-cabinet";
}

function getPurchaseCurrency(): "jpy" | "usd" {
  return navigator.language.toLowerCase().startsWith("ja") ? "jpy" : "usd";
}

function getCurrentGame() {
  return resolveGameDefinition(new URL(window.location.href).searchParams.get("game"));
}

function formatPurchasePrice(unit: PurchaseUnit): string {
  return getPurchaseCurrency() === "jpy" ? `${unit * 100}円` : `$${unit}`;
}

async function resolveCabinetShareUrl(): Promise<string> {
  let shareOrigin = window.location.origin;
  if (["localhost", "127.0.0.1"].includes(window.location.hostname)) {
    try {
      const response = await fetch("/api/local-address");
      if (response.ok) {
        const localAddress = await response.json() as { address: string; port: number };
        shareOrigin = `http://${localAddress.address}:${localAddress.port}`;
      }
    } catch {
      shareOrigin = window.location.origin;
    }
  }
  const shareUrl = new URL(`${shareOrigin}${window.location.pathname}`);
  shareUrl.searchParams.set("game", getCurrentGame().id);
  shareUrl.searchParams.set("watch", "1");
  return shareUrl.toString();
}

function storePendingPlayAction(action: PendingPlayAction | null) {
  if (!action) return;
  const value = action.type === "restartKey" ? "restartKey" : action.button.id;
  window.sessionStorage.setItem("vgc_pending_play_action", value);
}

function restoreStoredPlayAction(
  setAction: (action: PendingPlayAction | null) => void,
): boolean {
  const stored = window.sessionStorage.getItem("vgc_pending_play_action");
  if (!stored) return false;
  if (stored === "restartKey") {
    setAction({ type: "restartKey" });
    return true;
  }
  const button = document.getElementById(stored);
  if (!(button instanceof HTMLButtonElement)) return false;
  setAction({ type: "button", button });
  return true;
}

function cleanPurchaseParams(url: URL) {
  url.searchParams.delete("purchase");
  url.searchParams.delete("session_id");
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}`);
}
