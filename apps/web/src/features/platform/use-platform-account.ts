import { useEffect, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { logoutUser, updatePlayerName, type PlatformBootstrap } from "./platform-client";
import type { ConsentPurpose } from "./platform-types";
import { notifications } from "../notifications/notifications";

interface PlatformAccountOptions {
  platform: PlatformBootstrap | null;
  setPlatform: Dispatch<SetStateAction<PlatformBootstrap | null>>;
  setBusy: Dispatch<SetStateAction<boolean>>;
  loadPlatform: () => Promise<void>;
}

export function usePlatformAccount({ platform, setPlatform, setBusy, loadPlatform }: PlatformAccountOptions) {
  const [profileOpen, setProfileOpen] = useState(false);
  const [accountDialogOpen, setAccountDialogOpen] = useState(false);
  const [consentPurpose, setConsentPurpose] = useState<ConsentPurpose | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const profileRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const url = new URL(window.location.href);
    const result = url.searchParams.get("account");
    if (!result) return;
    if (["registered", "registered_without_bonus", "logged_in"].includes(result)) {
      const message = result === "logged_in" ? "ログインしました。"
        : result === "registered_without_bonus" ? "ユーザー登録が完了しました。"
        : "ユーザー登録が完了し、5クレジットを追加しました。";
      notifications.show({ id: "platform-account", type: "success", message });
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

  const requestUserRegistration = () => {
    setProfileOpen(false);
    if (!platform?.consent.accepted) {
      setConsentPurpose("registration");
      return;
    }
    setAccountDialogOpen(true);
  };

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
      window.dispatchEvent(new Event("platform-profile-changed"));
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

  return {
    profileOpen, setProfileOpen, profileRef,
    accountDialogOpen, setAccountDialogOpen,
    consentPurpose, setConsentPurpose,
    editingName, setEditingName, nameDraft, setNameDraft,
    requestUserRegistration, savePlayerName, handleLogout,
  };
}

function accountErrorMessage(reason: string | null): string {
  if (reason === "cancelled") return "ユーザー登録をキャンセルしました。";
  if (reason === "session_expired") return "セッションの有効期限が切れました。もう一度お試しください。";
  if (reason === "not_configured") return "Googleユーザー登録の設定が完了していません。";
  if (reason === "developer_auth_unavailable") return "開発者ログインはローカル開発環境でのみ利用できます。";
  if (reason === "policy_consent_required") return "ユーザー登録の前に利用規約への同意が必要です。";
  return "ユーザー登録を完了できませんでした。もう一度お試しください。";
}
