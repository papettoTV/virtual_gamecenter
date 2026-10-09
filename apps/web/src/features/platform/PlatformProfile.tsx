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
}

export function PlatformProfile({ platform, profileOpen, profileRef, setProfileOpen, editingName, setEditingName, nameDraft, setNameDraft, busy, savePlayerName, handleLogout, requestUserRegistration, standaloneCredits }: PlatformProfileProps) {
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



    </>
  );
}
