import type { Dispatch, SetStateAction } from "react";
import type { RefObject } from "react";
import type { PlatformBootstrap } from "./platform-client";

export interface PlatformProfileProps {
  platform: PlatformBootstrap | null;
  profileOpen: boolean;
  profileRef: RefObject<HTMLDivElement | null>;
  setProfileOpen: Dispatch<SetStateAction<boolean>>;
  editingName: boolean;
  setEditingName: Dispatch<SetStateAction<boolean>>;
  nameDraft: string;
  setNameDraft: Dispatch<SetStateAction<string>>;
  busy: boolean;
  savePlayerName: () => Promise<void>;
  handleLogout: () => Promise<void>;
  requestUserRegistration: () => void;
  standaloneCredits: boolean;
  refreshCredits?: () => void;
}

export function PlatformProfile({ platform, profileOpen, profileRef, setProfileOpen, editingName, setEditingName, nameDraft, setNameDraft, busy, savePlayerName, handleLogout, requestUserRegistration, standaloneCredits, refreshCredits }: PlatformProfileProps) {
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
          onClick={() => {
            if (!profileOpen) refreshCredits?.();
            setProfileOpen((open) => !open);
          }}
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
                  無料 {wallet.availableFree}{wallet.availablePurchased > 0 || platform?.creditPolicy?.purchasesEnabled ? ` / 購入 ${wallet.availablePurchased}` : ""}
                </small>
              )}
            </div>
            {platform?.creditPolicy && !platform.creditPolicy.purchasesEnabled && <div className="platform-beta-credits">
              <strong>無料ベータ</strong>
              <p>毎日、残高が3枚未満なら3枚まで無料で補充します（日本時間・1日1回）。</p>
              <small>{platform.creditPolicy.refilledToday ? "本日の補充は利用済みです。" : "残高が3枚未満になったら、プレイ開始前や再訪問時に補充します。"}</small>
              <small>次の日の開始：{new Date(platform.creditPolicy.nextRefillAt).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}</small>
            </div>}
            {standaloneCredits && platform?.creditPolicy?.purchasesEnabled && <button type="button" onClick={() => window.dispatchEvent(new Event("request-credit-topup"))}>クレジットを追加</button>}
            {platform && <div className="platform-data-actions">
              <button type="button" disabled={busy} onClick={() => {
                setProfileOpen(false);
                window.dispatchEvent(new CustomEvent("request-data-deletion", { detail: "public" }));
              }}>ランキング・共有結果を削除</button>
              <button type="button" disabled={busy} onClick={() => {
                setProfileOpen(false);
                window.dispatchEvent(new CustomEvent("request-data-deletion", { detail: "all" }));
              }}>{platform.accountRegistered ? "退会・データ削除" : "ゲストデータを削除"}</button>
              <button type="button" onClick={() => {
                setProfileOpen(false);
                window.dispatchEvent(new Event("request-deletion-status"));
              }}>削除受付状況</button>
            </div>}
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



    </>
  );
}
