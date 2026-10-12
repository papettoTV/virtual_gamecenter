import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCreditPurchase } from "../../src/features/platform/use-credit-purchase";
import { usePlatformAccount } from "../../src/features/platform/use-platform-account";
import { createCreditCheckout, fetchCreditPurchaseStatus, logoutUser, PlatformApiError, updatePlayerName, type PlatformBootstrap } from "../../src/features/platform/platform-client";
import { notifications } from "../../src/features/notifications/notifications";

const runtime = vi.hoisted(() => ({
  states: [] as unknown[],
  cursor: 0,
  effects: [] as Array<() => (() => void) | void>,
}));

vi.mock("react", async importOriginal => ({
  ...await importOriginal<typeof import("react")>(),
  useState: (initial: unknown) => {
    const index = runtime.cursor++;
    if (!(index in runtime.states)) runtime.states[index] = initial;
    return [runtime.states[index], (value: unknown) => {
      runtime.states[index] = typeof value === "function" ? value(runtime.states[index]) : value;
    }];
  },
  useEffect: (effect: () => (() => void) | void) => runtime.effects.push(effect),
  useRef: (current: unknown) => ({ current }),
}));
vi.mock("../../src/features/platform/platform-client", async importOriginal => ({
  ...await importOriginal<typeof import("../../src/features/platform/platform-client")>(),
  createCreditCheckout: vi.fn(),
  fetchCreditPurchaseStatus: vi.fn(),
  updatePlayerName: vi.fn(),
  logoutUser: vi.fn(),
}));
vi.mock("../../src/features/notifications/notifications", () => ({
  notifications: { show: vi.fn(), dismiss: vi.fn() },
}));

const platform: PlatformBootstrap = {
  playerId: "player", playerName: "Player", accountRegistered: true,
  avatarUrl: null, developerLoginAvailable: false,
  consent: { accepted: true, termsVersion: "1", privacyVersion: "1" },
  welcomeCreditGranted: true, creditCost: 1,
  wallet: {
    freeBalance: 5, purchasedBalance: 0, reservedFree: 0, reservedPurchased: 0,
    availableFree: 5, availablePurchased: 0, availableTotal: 5,
  },
};

function renderPurchase(options = purchaseOptions()) {
  runtime.cursor = 0;
  runtime.effects = [];
  return useCreditPurchase(options);
}

function purchaseOptions() {
  return {
    purchasesEnabled: true,
    pendingAction: "retry" as const, setPendingAction: vi.fn(),
    setPlayDialog: vi.fn(), setBusy: vi.fn(), updateWallet: vi.fn(),
  };
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
}

describe("platform account and purchase logic", () => {
  let storage: Map<string, string>;
  const assign = vi.fn();
  const replaceState = vi.fn();
  const dispatchEvent = vi.fn();

  beforeEach(() => {
    runtime.states = [];
    runtime.cursor = 0;
    runtime.effects = [];
    storage = new Map();
    vi.stubGlobal("navigator", { language: "ja-JP" });
    vi.stubGlobal("window", {
      location: { href: "https://example.test/cabinets/test?game=dot-wave", pathname: "/cabinets/test", search: "?game=dot-wave", assign },
      history: { replaceState, pushState: vi.fn(), state: null },
      sessionStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
        removeItem: (key: string) => storage.delete(key),
      },
      dispatchEvent, setTimeout, clearTimeout, addEventListener: vi.fn(), removeEventListener: vi.fn(),
    });
    vi.stubGlobal("PopStateEvent", Event);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetAllMocks();
    vi.useRealTimers();
  });

  it("blocks checkout during the free beta without persisting a pending purchase", async () => {
    await renderPurchase({ ...purchaseOptions(), purchasesEnabled: false }).handlePurchase();
    expect(createCreditCheckout).not.toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
    expect(storage.size).toBe(0);
    expect(notifications.show).toHaveBeenCalledWith(expect.objectContaining({ type: "info" }));
  });

  it("persists the pending action before redirecting to checkout", async () => {
    vi.mocked(createCreditCheckout).mockResolvedValue({
      purchaseId: "purchase", checkoutSessionId: "checkout", checkoutUrl: "https://checkout.test",
    });
    const options = purchaseOptions();
    await renderPurchase(options).handlePurchase();
    expect(storage.get("vgc_pending_play_action")).toBe("retry");
    expect(createCreditCheckout).toHaveBeenCalledWith(1, "jpy", "/cabinets/test?game=dot-wave");
    expect(assign).toHaveBeenCalledWith("https://checkout.test");
    expect(options.setBusy).toHaveBeenCalledWith(true);
    expect(options.setBusy).not.toHaveBeenCalledWith(false);
  });

  it("reports checkout configuration errors and clears busy state", async () => {
    vi.mocked(createCreditCheckout).mockRejectedValue(new PlatformApiError("stripe_test_key_required", 503));
    const options = purchaseOptions();
    await renderPurchase(options).handlePurchase();
    expect(options.setBusy).toHaveBeenLastCalledWith(false);
    expect(notifications.show).toHaveBeenCalledWith(expect.objectContaining({
      id: "purchase-checkout", message: "ローカル開発ではStripeのテスト用Secret Keyを使用してください。",
    }));
  });

  it("restores the insufficient-credit dialog on a cancelled checkout", () => {
    window.location.href = "https://example.test/cabinets/test?purchase=cancelled&game=dot-wave";
    storage.set("vgc_pending_play_action", "restartKey");
    const options = purchaseOptions();
    renderPurchase(options);
    runtime.effects[0]?.();
    expect(options.setPendingAction).toHaveBeenCalledWith("retry");
    expect(options.setPlayDialog).toHaveBeenCalledWith("insufficient");
    expect(replaceState).toHaveBeenCalledWith(null, "", "/cabinets/test?game=dot-wave");
  });

  it("updates the wallet and completes a paid purchase", async () => {
    window.location.href = "https://example.test/cabinets/test?purchase=success&session_id=checkout";
    vi.mocked(fetchCreditPurchaseStatus).mockResolvedValue({
      purchaseId: "purchase", status: "paid", creditAmount: 15, wallet: platform.wallet,
    });
    const options = purchaseOptions();
    renderPurchase(options);
    const cleanup = runtime.effects[0]?.();
    await flush();
    const result = renderPurchase(options);
    expect(result.purchaseDialog).toBe("complete");
    expect(result.purchasedCredits).toBe(15);
    expect(options.updateWallet).toHaveBeenCalledWith(platform.wallet);
    expect(fetchCreditPurchaseStatus).toHaveBeenCalledWith("checkout");
    cleanup?.();
  });

  it("stops polling after unmount without applying a late result", async () => {
    window.location.href = "https://example.test/?purchase=success&session_id=checkout";
    let finish!: (value: Awaited<ReturnType<typeof fetchCreditPurchaseStatus>>) => void;
    vi.mocked(fetchCreditPurchaseStatus).mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const options = purchaseOptions();
    renderPurchase(options);
    const cleanup = runtime.effects[0]?.();
    cleanup?.();
    finish({ purchaseId: "purchase", status: "paid", creditAmount: 5, wallet: platform.wallet });
    await flush();
    expect(options.updateWallet).not.toHaveBeenCalled();
    expect(renderPurchase(options).purchaseDialog).toBe("processing");
  });

  it("offers retry after fifteen unsuccessful purchase checks", async () => {
    vi.useFakeTimers();
    window.setTimeout = setTimeout;
    window.clearTimeout = clearTimeout;
    window.location.href = "https://example.test/?purchase=success&session_id=checkout";
    vi.mocked(fetchCreditPurchaseStatus).mockRejectedValue(new Error("offline"));
    renderPurchase();
    const cleanup = runtime.effects[0]?.();
    await flush();
    await vi.runAllTimersAsync();
    expect(fetchCreditPurchaseStatus).toHaveBeenCalledTimes(15);
    expect(renderPurchase().purchaseError).toContain("決済状況を確認できません");
    cleanup?.();
  });

  it("returns to play confirmation after closing a completed purchase", () => {
    storage.set("vgc_pending_play_action", "restartKey");
    const options = purchaseOptions();
    renderPurchase(options).closePurchaseComplete();
    expect(options.setPlayDialog).toHaveBeenCalledWith("confirm");
    expect(options.setPendingAction).toHaveBeenCalledWith("retry");
    expect(storage.has("vgc_pending_play_action")).toBe(false);
    expect(renderPurchase(options).purchaseDialog).toBe(null);
  });

  it("validates names and saves trimmed names with the existing profile event", async () => {
    const options = { platform, setPlatform: vi.fn(), setBusy: vi.fn(), loadPlatform: vi.fn() };
    let account = usePlatformAccount(options);
    await account.savePlayerName();
    expect(updatePlayerName).not.toHaveBeenCalled();
    account.setNameDraft("  New Player  ");
    runtime.cursor = 0;
    account = usePlatformAccount(options);
    const identity = { playerId: "player", playerName: "New Player", accountRegistered: true, avatarUrl: null };
    vi.mocked(updatePlayerName).mockResolvedValue({ identity });
    await account.savePlayerName();
    expect(updatePlayerName).toHaveBeenCalledWith("New Player");
    const update = options.setPlatform.mock.calls[0]?.[0];
    expect(update(platform)).toEqual({ ...platform, ...identity });
    expect(dispatchEvent).toHaveBeenCalledWith(expect.objectContaining({ type: "platform-profile-changed" }));
    expect(options.setBusy).toHaveBeenLastCalledWith(false);
  });

  it("requires consent before account registration", () => {
    const options = {
      platform: { ...platform, consent: { ...platform.consent, accepted: false } },
      setPlatform: vi.fn(), setBusy: vi.fn(), loadPlatform: vi.fn(),
    };
    usePlatformAccount(options).requestUserRegistration();
    runtime.cursor = 0;
    const account = usePlatformAccount(options);
    expect(account.consentPurpose).toBe("registration");
    expect(account.accountDialogOpen).toBe(false);
  });

  it("restores ranking registration after returning from signup", async () => {
    window.location.href = "https://example.test/cabinets/test?game=dot-wave&account=registered#ranking";
    const options = { platform, setPlatform: vi.fn(), setBusy: vi.fn(), loadPlatform: vi.fn() };
    usePlatformAccount(options);
    runtime.effects[0]?.();
    expect(options.loadPlatform).toHaveBeenCalledOnce();
    expect(dispatchEvent).toHaveBeenCalledWith(expect.objectContaining({ type: "restore-ranking-registration" }));
    expect(replaceState).toHaveBeenCalledWith({}, "", "/cabinets/test?game=dot-wave#ranking");
  });

  it("preserves logout navigation and the returned guest platform", async () => {
    const guest = { ...platform, accountRegistered: false };
    vi.mocked(logoutUser).mockResolvedValue(guest);
    const options = { platform, setPlatform: vi.fn(), setBusy: vi.fn(), loadPlatform: vi.fn() };
    await usePlatformAccount(options).handleLogout();
    expect(options.setPlatform).toHaveBeenCalledWith(guest);
    expect(window.history.pushState).toHaveBeenCalledWith({}, "", "/");
    expect(dispatchEvent).toHaveBeenCalledWith(expect.objectContaining({ type: "popstate" }));
    expect(options.setBusy).toHaveBeenLastCalledWith(false);
  });
});
