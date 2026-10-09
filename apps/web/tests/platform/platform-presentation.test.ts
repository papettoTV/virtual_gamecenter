import { createElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PlatformProfile, type PlatformProfileProps } from "../../src/features/platform/PlatformProfile";
import { AccountRegistrationDialog } from "../../src/features/platform/AccountRegistrationDialog";
import { ConsentDialog } from "../../src/features/platform/ConsentDialog";
import { WelcomeCreditDialog } from "../../src/features/platform/WelcomeCreditDialog";
import { CreditPurchaseDialogs, type CreditPurchaseDialogsProps } from "../../src/features/platform/CreditPurchaseDialogs";
import { PlatformPolicies } from "../../src/features/platform/PlatformPolicies";
import type { PlatformBootstrap } from "../../src/features/platform/platform-client";

const platform: PlatformBootstrap = {
  playerId: "player-123456789",
  playerName: "テストプレイヤー",
  accountRegistered: false,
  avatarUrl: null,
  developerLoginAvailable: false,
  consent: { accepted: false, termsVersion: "1", privacyVersion: "1" },
  welcomeCreditGranted: false,
  wallet: {
    freeBalance: 3, purchasedBalance: 5, reservedFree: 0, reservedPurchased: 0,
    availableFree: 3, availablePurchased: 5, availableTotal: 8,
  },
  creditCost: 1,
};

function profileProps(overrides: Partial<PlatformProfileProps> = {}): PlatformProfileProps {
  return {
    platform, profileOpen: true, profileRef: { current: null },
    setProfileOpen: vi.fn(), editingName: false, setEditingName: vi.fn(),
    nameDraft: "", setNameDraft: vi.fn(), busy: false,
    savePlayerName: vi.fn(), handleLogout: vi.fn(), requestUserRegistration: vi.fn(),
    standaloneCredits: false, ...overrides,
  };
}

function purchaseProps(overrides: Partial<CreditPurchaseDialogsProps> = {}): CreditPurchaseDialogsProps {
  return {
    purchaseDialog: "select", setPurchaseDialog: vi.fn(), purchaseUnit: 1,
    setPurchaseUnit: vi.fn(), purchasedCredits: 0, purchaseError: "",
    setPurchaseError: vi.fn(), setPurchaseCheck: vi.fn(), busy: false,
    setPlayDialog: vi.fn(), handlePurchase: vi.fn(), closePurchaseComplete: vi.fn(),
    requestUserRegistration: vi.fn(), ...overrides,
  };
}

function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const element = node as ReactElement<Record<string, unknown>>;
  return [element, ...elements(element.props.children as ReactNode)];
}

describe("platform presentation", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("keeps the guest profile, wallet and registration action", () => {
    const markup = renderToStaticMarkup(createElement(PlatformProfile, profileProps()));
    expect(markup).toContain('id="platform-profile-menu"');
    expect(markup).toContain('aria-expanded="true"');
    expect(markup).toContain("ゲスト");
    expect(markup).toContain("無料 3 / 購入 5");
    expect(markup).toContain("ユーザー登録で名前を変更");
    expect(markup).not.toContain("ログアウト");
  });

  it("keeps the collapsed loading profile", () => {
    const markup = renderToStaticMarkup(createElement(PlatformProfile, profileProps({ platform: null, profileOpen: false })));
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).not.toContain('id="platform-profile-menu"');
  });

  it("preserves the registered name editor and busy logout state", () => {
    const markup = renderToStaticMarkup(createElement(PlatformProfile, profileProps({
      platform: { ...platform, accountRegistered: true }, editingName: true,
      nameDraft: "変更中", busy: true,
    })));
    expect(markup).toContain('maxLength="24"');
    expect(markup).toContain('value="変更中"');
    expect(markup).toContain('disabled=""');
    expect(markup).toContain("ログアウト中");
    expect(markup).not.toContain("ゲスト");
  });

  it("keeps one standalone credit top-up button", () => {
    const markup = renderToStaticMarkup(createElement(PlatformProfile, profileProps({ standaloneCredits: true })));
    expect(markup.match(/クレジットを追加/g)).toHaveLength(1);
  });

  it("preserves name editing callbacks", () => {
    const props = profileProps({ platform: { ...platform, accountRegistered: true } });
    const button = elements(PlatformProfile(props)).find(element => element.props.title === "名前を変更");
    (button?.props.onClick as () => void)();
    expect(props.setNameDraft).toHaveBeenCalledWith(platform.playerName);
    expect(props.setEditingName).toHaveBeenCalledWith(true);
  });

  it("shows developer registration only when available", () => {
    const props = { accountDialogOpen: true, setAccountDialogOpen: vi.fn(), platform };
    expect(renderToStaticMarkup(createElement(AccountRegistrationDialog, props))).not.toContain("開発者ユーザーでログイン");
    expect(renderToStaticMarkup(createElement(AccountRegistrationDialog, {
      ...props, platform: { ...platform, developerLoginAvailable: true },
    }))).toContain("開発者ユーザーでログイン");
  });

  it("keeps both consent documents and disables submission while saving", () => {
    const markup = renderToStaticMarkup(createElement(ConsentDialog, {
      consentPurpose: "registration", setConsentPurpose: vi.fn(), busy: true, handleConsent: vi.fn(),
    }));
    expect(markup).toContain('src="/legal/terms.html"');
    expect(markup).toContain('src="/legal/privacy.html"');
    expect(markup).toContain("保存中");
    expect(markup.match(/disabled=""/g)).toHaveLength(2);
  });

  it("preserves welcome accept and decline callbacks", () => {
    const props = { welcomeDialogOpen: true, busy: false, skipWelcomeCredit: vi.fn(), handleWelcomeCredit: vi.fn() };
    const buttons = elements(WelcomeCreditDialog(props)).filter(element => element.type === "button");
    (buttons[0]?.props.onClick as () => void)();
    (buttons[1]?.props.onClick as () => void)();
    expect(props.skipWelcomeCredit).toHaveBeenCalledOnce();
    expect(props.handleWelcomeCredit).toHaveBeenCalledOnce();
  });

  it("keeps all purchase packages, selected state and the bonus", () => {
    vi.stubGlobal("navigator", { language: "ja-JP" });
    const markup = renderToStaticMarkup(createElement(CreditPurchaseDialogs, purchaseProps({ purchaseUnit: 10 })));
    expect(markup.match(/role="radio"/g)).toHaveLength(4);
    expect(markup.match(/aria-checked="true"/g)).toHaveLength(1);
    expect(markup).toContain("60クレジット");
    expect(markup).toContain("10クレジット ボーナス");
    expect(markup).toContain("1000円で購入");
  });

  it("preserves purchase selection and back transitions", () => {
    vi.stubGlobal("navigator", { language: "en-US" });
    const props = purchaseProps();
    const buttons = elements(CreditPurchaseDialogs(props)).filter(element => element.type === "button");
    (buttons[3]?.props.onClick as () => void)();
    expect(props.setPurchaseUnit).toHaveBeenCalledWith(10);
    (buttons[4]?.props.onClick as () => void)();
    expect(props.setPurchaseDialog).toHaveBeenCalledWith(null);
    expect(props.setPlayDialog).toHaveBeenCalledWith("insufficient");
  });

  it("keeps processing errors and completion registration actions", () => {
    const errorMarkup = renderToStaticMarkup(createElement(CreditPurchaseDialogs, purchaseProps({
      purchaseDialog: "processing", purchaseError: "確認失敗",
    })));
    expect(errorMarkup).toContain('role="alert"');
    expect(errorMarkup).toContain("再確認");
    const completeMarkup = renderToStaticMarkup(createElement(CreditPurchaseDialogs, purchaseProps({
      purchaseDialog: "complete", purchasedCredits: 15,
    })));
    expect(completeMarkup).toContain("15クレジット");
    expect(completeMarkup).toContain("ユーザー登録へ");
  });

  it("keeps policy frames and footer outside dialogs", () => {
    const markup = renderToStaticMarkup(createElement(PlatformPolicies, { policy: "privacy", setPolicy: vi.fn() }));
    expect(markup).toContain('class="policy-document-frame"');
    expect(markup).toContain('src="/legal/privacy.html"');
    expect(markup).toContain('class="platform-footer"');
  });

  it("renders no inactive dialogs", () => {
    expect(renderToStaticMarkup(createElement(CreditPurchaseDialogs, purchaseProps({ purchaseDialog: null })))).toBe("");
    expect(renderToStaticMarkup(createElement(ConsentDialog, {
      consentPurpose: null, setConsentPurpose: vi.fn(), busy: false, handleConsent: vi.fn(),
    }))).toBe("");
    expect(renderToStaticMarkup(createElement(AccountRegistrationDialog, {
      accountDialogOpen: false, setAccountDialogOpen: vi.fn(), platform,
    }))).toBe("");
  });
});
