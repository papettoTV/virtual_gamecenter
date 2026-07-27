import { useCallback, useEffect, useRef, useState } from "react";
import {
  acceptPolicies,
  capturePlayCredit,
  fetchPlatformBootstrap,
  PlatformApiError,
  releasePlayCredit,
  reservePlayCredit,
  type PlatformBootstrap,
  type WalletSummary,
} from "./platform-client";

type PolicyKind = "terms" | "privacy";
type PendingPlayAction =
  | { type: "button"; button: HTMLButtonElement }
  | { type: "restartKey" };

const PLAY_BUTTON_IDS = new Set(["start-solo", "touch-restart", "clear-restart"]);

export function PlatformExperience() {
  const [platform, setPlatform] = useState<PlatformBootstrap | null>(null);
  const [loadingError, setLoadingError] = useState("");
  const [policy, setPolicy] = useState<PolicyKind | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingPlayAction | null>(null);
  const [playDialog, setPlayDialog] = useState<"confirm" | "insufficient" | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [profileOpen, setProfileOpen] = useState(false);
  const bypassGate = useRef(false);
  const profileRef = useRef<HTMLDivElement>(null);

  const loadPlatform = useCallback(async () => {
    setLoadingError("");
    try {
      setPlatform(await fetchPlatformBootstrap());
    } catch {
      setLoadingError("プレイヤー情報を読み込めませんでした。");
    }
  }, []);

  useEffect(() => {
    void loadPlatform();
  }, [loadPlatform]);

  useEffect(() => {
    if (notice !== "1クレジットを使用しました。") return;
    const closeTimer = window.setTimeout(() => setNotice(""), 5000);
    return () => window.clearTimeout(closeTimer);
  }, [notice]);

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
    if (!platform?.consent.accepted) return;
    setPendingAction(action);
    setPlayDialog(
      platform.wallet.availableTotal >= platform.creditCost
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
    setNotice("");
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
      setNotice(`無料クレジット${result.wallet.freeBalance}枚を受け取りました。`);
    } catch {
      setLoadingError("同意情報を保存できませんでした。");
    } finally {
      setBusy(false);
    }
  };

  const handlePlayConfirm = async () => {
    if (!platform || !pendingAction) return;
    setBusy(true);
    setNotice("");
    let reservationId: string | null = null;
    try {
      const reservation = await reservePlayCredit(getCabinetId());
      reservationId = reservation.reservationId;
      updateWallet(reservation.wallet);
      replayPlayAction(pendingAction);

      await new Promise((resolve) => window.setTimeout(resolve, 50));
      const gameScreen = document.querySelector("#game-screen");
      if (!gameScreen || gameScreen.classList.contains("is-hidden")) {
        const released = await releasePlayCredit(reservation.reservationId);
        updateWallet(released.wallet);
        setNotice("ゲームを開始できなかったため、クレジットを返却しました。");
        return;
      }

      const captured = await capturePlayCredit(reservation.reservationId);
      updateWallet(captured.wallet);
      setNotice("1クレジットを使用しました。");
      setPlayDialog(null);
      setPendingAction(null);
    } catch (error) {
      if (reservationId) {
        try {
          const released = await releasePlayCredit(reservationId);
          updateWallet(released.wallet);
        } catch {
          setNotice("クレジット状態を確認できません。画面を再読み込みしてください。");
        }
      }
      if (error instanceof PlatformApiError && error.code === "insufficient_credit") {
        if (error.wallet) updateWallet(error.wallet);
        setPlayDialog("insufficient");
      } else {
        setNotice("ゲーム開始処理に失敗しました。もう一度お試しください。");
      }
    } finally {
      setBusy(false);
    }
  };

  const updateWallet = (wallet: WalletSummary) => {
    setPlatform((current) => current ? { ...current, wallet } : current);
  };

  const replayPlayAction = (action: PendingPlayAction) => {
    bypassGate.current = true;
    if (action.type === "button") {
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

  const consentRequired = Boolean(platform && !platform.consent.accepted);
  const wallet = platform?.wallet;

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
              <span className="platform-profile-avatar" aria-label="ゲスト用プロフィールアイコン">
                <span />
              </span>
              <div>
                <span className="platform-account-state">ゲスト</span>
                <strong className="platform-profile-name">ゲストプレイヤー</strong>
                <span className="platform-player-id">
                  {platform ? `ID ${platform.playerId.slice(0, 8)}` : "読み込み中"}
                </span>
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
          </section>
        )}
      </div>

      {loadingError && (
        <div className="platform-error" role="alert">
          <span>{loadingError}</span>
          <button type="button" onClick={() => void loadPlatform()}>再読み込み</button>
        </div>
      )}

      {notice && (
        <div className="platform-notice" role="status">
          {notice}
          <button type="button" aria-label="閉じる" onClick={() => setNotice("")}>×</button>
        </div>
      )}

      {consentRequired && (
        <div className="platform-overlay" role="dialog" aria-modal="true" aria-labelledby="consent-title">
          <div className="platform-dialog">
            <p className="eyebrow">Welcome Credit</p>
            <h2 id="consent-title">ゲームセンターを利用する</h2>
            <p>
              利用規約とプライバシーポリシーを確認して同意すると、無料クレジット5枚を受け取れます。
            </p>
            <div className="policy-links">
              <button type="button" onClick={() => setPolicy("terms")}>利用規約を確認</button>
              <button type="button" onClick={() => setPolicy("privacy")}>プライバシーポリシーを確認</button>
            </div>
            <button className="platform-primary-button" type="button" disabled={busy} onClick={() => void handleConsent()}>
              {busy ? "保存中…" : "同意して無料クレジットを受け取る"}
            </button>
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
                ゲーム開始には1クレジット必要です。追加購入は現在準備中です。
              </p>
            )}
            <div className="platform-dialog-actions">
              <button type="button" onClick={() => {
                setPlayDialog(null);
                setPendingAction(null);
              }}>
                キャンセル
              </button>
              {playDialog === "confirm" && (
                <button className="platform-primary-button" type="button" disabled={busy} onClick={() => void handlePlayConfirm()}>
                  {busy ? "準備中…" : "1クレジットで開始"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {policy && (
        <PolicyDialog kind={policy} onClose={() => setPolicy(null)} />
      )}

      <footer className="platform-footer">
        <button type="button" onClick={() => setPolicy("terms")}>利用規約</button>
        <button type="button" onClick={() => setPolicy("privacy")}>プライバシーポリシー</button>
        <span>お問い合わせ（準備中）</span>
        <span>特定商取引法に基づく表記は有料化前に公開予定</span>
      </footer>
    </>
  );
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
        <h2>{isTerms ? "利用規約（プロトタイプ版）" : "プライバシーポリシー（プロトタイプ版）"}</h2>
        {isTerms ? (
          <>
            <p>本サービスはオンラインゲームセンターの試作サービスです。</p>
            <h3>利用条件</h3>
            <p>不正アクセス、迷惑行為、ゲームや通信の改変、他の利用者への嫌がらせを禁止します。</p>
            <h3>無料クレジット</h3>
            <p>無料クレジットは換金・譲渡できず、試作期間中に内容を変更または終了する場合があります。</p>
            <h3>サービス変更</h3>
            <p>メンテナンスや開発上の都合により、予告なく機能を変更または停止する場合があります。</p>
          </>
        ) : (
          <>
            <p>サービス提供のため、匿名プレイヤーID、Cookie、アクセスログ、プレイ履歴を取得します。</p>
            <h3>利用目的</h3>
            <p>セッション維持、無料クレジット管理、ゲーム提供、不正利用防止、障害調査に使用します。</p>
            <h3>保存と委託</h3>
            <p>データはCloudflareのサービス上で処理・保存される場合があります。</p>
            <h3>問い合わせ</h3>
            <p>データの確認・削除に関する問い合わせ窓口は、有料化前に正式な運営者情報とともに公開します。</p>
          </>
        )}
        <button className="platform-primary-button" type="button" onClick={onClose}>閉じる</button>
      </article>
    </div>
  );
}

function getCabinetId(): string {
  const match = window.location.pathname.match(/^\/cabinets\/([a-zA-Z0-9-]+)/);
  return match?.[1] ?? "local-cabinet";
}
