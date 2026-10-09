import type { Dispatch, SetStateAction } from "react";
import { createGoogleRegistrationUrl, createDeveloperLoginUrl, type PlatformBootstrap } from "./platform-client";

export interface AccountRegistrationDialogProps {
  accountDialogOpen: boolean;
  setAccountDialogOpen: Dispatch<SetStateAction<boolean>>;
  platform: PlatformBootstrap | null;
}

export function AccountRegistrationDialog({ accountDialogOpen, setAccountDialogOpen, platform }: AccountRegistrationDialogProps) {
  return (
    <>
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

    </>
  );
}
