import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlatformExperience } from "../../src/features/platform/PlatformExperience";
import { gameHost } from "../../src/game-sdk/game-host";
import { executePlay } from "../../src/features/platform/play-service";
import { claimWelcomeCredit, fetchPlatformBootstrap, PlatformApiError, type PlatformBootstrap } from "../../src/features/platform/platform-client";
import { notifications } from "../../src/features/notifications/notifications";
import { recordPlayStartedFromWatch } from "../../src/features/engagement/engagement-client";

const runtime = vi.hoisted(() => ({
  states: [] as unknown[], cursor: 0,
  refs: [] as Array<{ current: unknown }>, refCursor: 0,
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
  useCallback: (callback: unknown) => callback,
  useEffect: (effect: () => (() => void) | void) => runtime.effects.push(effect),
  useRef: (current: unknown) => {
    const index = runtime.refCursor++;
    runtime.refs[index] ??= { current };
    return runtime.refs[index];
  },
}));
vi.mock("../../src/features/platform/use-platform-account", () => ({
  usePlatformAccount: () => ({
    profileOpen: false, setProfileOpen: vi.fn(), profileRef: { current: null },
    accountDialogOpen: false, setAccountDialogOpen: vi.fn(), consentPurpose: null,
    setConsentPurpose: vi.fn(), editingName: false, setEditingName: vi.fn(),
    nameDraft: "", setNameDraft: vi.fn(), requestUserRegistration: vi.fn(),
    savePlayerName: vi.fn(), handleLogout: vi.fn(),
  }),
}));
vi.mock("../../src/features/platform/use-credit-purchase", () => ({
  useCreditPurchase: () => ({
    purchaseDialog: null, setPurchaseDialog: vi.fn(), purchaseUnit: 1,
    setPurchaseUnit: vi.fn(), purchasedCredits: 0, purchaseError: "",
    setPurchaseError: vi.fn(), setPurchaseCheck: vi.fn(), handlePurchase: vi.fn(),
    closePurchaseComplete: vi.fn(),
  }),
}));
vi.mock("../../src/features/platform/play-service", () => ({ executePlay: vi.fn() }));
vi.mock("../../src/features/platform/platform-client", async importOriginal => ({
  ...await importOriginal<typeof import("../../src/features/platform/platform-client")>(),
  fetchPlatformBootstrap: vi.fn(), claimWelcomeCredit: vi.fn(),
}));
vi.mock("../../src/features/notifications/notifications", () => ({
  notifications: { show: vi.fn(), dismiss: vi.fn() },
}));
vi.mock("../../src/features/engagement/engagement-client", () => ({
  createTrackedWatchUrl: vi.fn(), recordPlayStartedFromWatch: vi.fn(), recordShareCreated: vi.fn(),
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

function render(standaloneCredits = false) {
  runtime.cursor = 0;
  runtime.refCursor = 0;
  runtime.effects = [];
  return PlatformExperience({ standaloneCredits });
}

function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const element = node as ReactElement<Record<string, unknown>>;
  return [element, ...elements(element.props.children as ReactNode)];
}

function confirm() {
  const button = elements(render()).find(element => element.props.className === "platform-primary-button play-credit-start-button");
  expect(button).toBeDefined();
  (button?.props.onClick as () => void)();
}

async function flush() {
  for (let attempt = 0; attempt < 6; attempt++) await Promise.resolve();
}

describe("typed platform play integration", () => {
  let cleanup: Array<() => void>;
  let detach: () => void;
  const play = vi.fn();
  let events: EventTarget;
  let bootstrapPlatform: PlatformBootstrap;

  beforeEach(() => {
    runtime.states = [platform];
    runtime.refs = [];
    cleanup = [];
    events = new EventTarget();
    vi.stubGlobal("window", {
      location: { href: "https://example.test/cabinets/test-cabinet?game=deep-sea-salvage", search: "?game=deep-sea-salvage", pathname: "/cabinets/test-cabinet" },
      addEventListener: events.addEventListener.bind(events),
      removeEventListener: events.removeEventListener.bind(events),
      dispatchEvent: events.dispatchEvent.bind(events),
      history: {
        state: { preserved: true },
        replaceState: vi.fn((_state: unknown, _title: string, path: string) => {
          const url = new URL(path, window.location.href);
          window.location.href = url.href;
          window.location.search = url.search;
        }),
      },
      sessionStorage: { getItem: vi.fn(() => null) },
    });
    bootstrapPlatform = { ...platform };
    vi.mocked(fetchPlatformBootstrap).mockResolvedValue(bootstrapPlatform);
    play.mockResolvedValue(true);
    detach = gameHost.attach({ play, dispose: vi.fn() });
  });
  afterEach(() => {
    cleanup.forEach(dispose => dispose());
    detach();
    vi.unstubAllGlobals();
    vi.resetAllMocks();
  });

  function mount(standaloneCredits = false) {
    render(standaloneCredits);
    for (const effect of runtime.effects) {
      const dispose = effect();
      if (dispose) cleanup.push(dispose);
    }
  }

  it("returns to the arcade without spending a credit when initial play is cancelled", () => {
    const pushState = vi.fn();
    vi.stubGlobal("location", window.location);
    vi.stubGlobal("history", { pushState });
    vi.stubGlobal("document", { body: { classList: { contains: () => false } } });
    vi.stubGlobal("PopStateEvent", class extends Event {});
    mount();
    gameHost.requestPlay("start");
    const button = elements(render()).find(element => element.props.className === "platform-cancel-button");
    expect(button).toBeDefined();
    (button!.props.onClick as () => void)();
    expect(pushState).toHaveBeenCalledWith({}, "", "/");
    expect(executePlay).not.toHaveBeenCalled();
    expect(play).not.toHaveBeenCalled();
  });

  it("opens the start confirmation once and removes only the start query", () => {
    window.location.href = "https://example.test/cabinets/test-cabinet?game=deep-sea-salvage&start=1&watch=0#ranking";
    window.location.search = "?game=deep-sea-salvage&start=1&watch=0";
    mount();
    expect(runtime.states[2]).toBe("start");
    expect(runtime.states[3]).toBe("confirm");
    expect(window.history.replaceState).toHaveBeenCalledWith(
      { preserved: true }, "", "/cabinets/test-cabinet?game=deep-sea-salvage&watch=0#ranking",
    );
    expect(play).not.toHaveBeenCalled();
    runtime.states[2] = null;
    runtime.states[3] = null;
    mount();
    expect(runtime.states[2]).toBe(null);
    expect(window.history.replaceState).toHaveBeenCalledOnce();
  });

  it("waits for platform loading before consuming start=1", async () => {
    runtime.states[0] = null;
    window.location.href += "&start=1";
    window.location.search += "&start=1";
    mount();
    expect(runtime.states[2]).toBe(null);
    expect(window.history.replaceState).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(runtime.states[0]).toBe(bootstrapPlatform));
    mount();
    expect(runtime.states[2]).toBe("start");
    expect(runtime.states[3]).toBe("confirm");
  });

  it("does not auto-start standalone credits", () => {
    window.location.href += "&start=1";
    window.location.search += "&start=1";
    mount(true);
    expect(runtime.states[2]).toBe(null);
    expect(window.history.replaceState).not.toHaveBeenCalled();
  });

  it.each(["account=registered", "purchase=cancelled", "purchase=success&session_id=checkout"])(
    "does not duplicate a %s return even after return parameters are cleaned",
    async returnQuery => {
      runtime.states[0] = null;
      window.location.href += "&start=1&" + returnQuery;
      window.location.search += "&start=1&" + returnQuery;
      mount();
      const url = new URL(window.location.href);
      url.searchParams.delete("account");
      url.searchParams.delete("purchase");
      url.searchParams.delete("session_id");
      window.location.href = url.href;
      window.location.search = url.search;
      await vi.waitFor(() => expect(runtime.states[0]).toBe(bootstrapPlatform));
      mount();
      expect(runtime.states[2]).toBe(null);
      expect(runtime.states[3]).toBe(null);
      expect(new URL(window.location.href).searchParams.has("start")).toBe(false);
    },
  );

  it("does not overwrite a pending retry with auto-start", () => {
    runtime.states[2] = "retry";
    runtime.states[3] = "confirm";
    window.location.href += "&start=1";
    window.location.search += "&start=1";
    mount();
    expect(runtime.states[2]).toBe("retry");
    expect(new URL(window.location.href).searchParams.has("start")).toBe(false);
  });

  it("does not duplicate a stored retry restore", () => {
    vi.mocked(window.sessionStorage.getItem).mockReturnValue("retry");
    window.location.href += "&start=1";
    window.location.search += "&start=1";
    mount();
    expect(runtime.states[2]).toBe(null);
    expect(new URL(window.location.href).searchParams.has("start")).toBe(false);
  });

  it.each(["start", "retry"] as const)("holds %s until confirmation and delegates to executePlay", async action => {
    vi.mocked(executePlay).mockImplementation(async transaction => {
      transaction.walletChanged({ ...platform.wallet, availableTotal: 4 });
      return transaction.start(transaction.action, "reservation");
    });
    mount();
    await vi.waitFor(() => expect(runtime.states[0]).toBe(bootstrapPlatform));
    gameHost.requestPlay(action);
    expect(runtime.states[2]).toBe(action);
    expect(runtime.states[3]).toBe("confirm");
    expect(play).not.toHaveBeenCalled();
    confirm();
    await vi.waitFor(() => expect(runtime.states[4]).toBe(false));
    expect(executePlay).toHaveBeenCalledWith({
      gameId: "deep-sea-salvage", cabinetId: "test-cabinet", action,
      start: expect.any(Function), walletChanged: expect.any(Function),
    });
    expect(play).toHaveBeenCalledWith(action, "reservation");
    expect((runtime.states[0] as PlatformBootstrap).wallet.availableTotal).toBe(4);
    expect(runtime.states[2]).toBe(null);
    expect(runtime.states[3]).toBe(null);
    expect(runtime.states[4]).toBe(false);
    expect(recordPlayStartedFromWatch).toHaveBeenCalledWith("deep-sea-salvage", "test-cabinet");
  });

  it("retains confirmation when the SDK reports that play did not start", async () => {
    vi.mocked(executePlay).mockResolvedValue(false);
    mount();
    gameHost.requestPlay("retry");
    confirm();
    await flush();
    expect(runtime.states[2]).toBe("retry");
    expect(runtime.states[3]).toBe("confirm");
    expect(recordPlayStartedFromWatch).not.toHaveBeenCalled();
    expect(notifications.show).toHaveBeenCalledWith(expect.objectContaining({ type: "info" }));
  });

  it("opens the insufficient dialog after checking today's refill without executing play", async () => {
    runtime.states[0] = { ...platform, wallet: { ...platform.wallet, availableTotal: 0 } };
    bootstrapPlatform = runtime.states[0] as PlatformBootstrap;
    vi.mocked(fetchPlatformBootstrap).mockResolvedValue(bootstrapPlatform);
    mount();
    gameHost.requestPlay("start");
    await flush();
    expect(runtime.states[3]).toBe("insufficient");
    expect(executePlay).not.toHaveBeenCalled();
  });

  it("rechecks an exhausted long-open tab and resumes confirmation after daily refill", async () => {
    runtime.states[0] = { ...platform, wallet: { ...platform.wallet, availableTotal: 0 } };
    vi.mocked(fetchPlatformBootstrap).mockResolvedValue({ ...platform, wallet: { ...platform.wallet, freeBalance: 3, availableFree: 3, availableTotal: 3 } });
    mount();
    gameHost.requestPlay("start");
    await flush();
    expect(runtime.states[3]).toBe("confirm");
    expect((runtime.states[0] as PlatformBootstrap).wallet.availableTotal).toBe(3);
    expect(play).not.toHaveBeenCalled();
  });

  it("preserves insufficient-credit errors and the supplied wallet", async () => {
    const wallet = { ...platform.wallet, availableTotal: 0 };
    vi.mocked(executePlay).mockRejectedValue(new PlatformApiError("insufficient_credit", 409, wallet));
    mount();
    gameHost.requestPlay("start");
    confirm();
    await flush();
    expect(runtime.states[3]).toBe("insufficient");
    expect((runtime.states[0] as PlatformBootstrap).wallet).toEqual(wallet);
    expect(runtime.states[4]).toBe(false);
  });

  it("unsubscribes from game requests on unmount", () => {
    mount();
    cleanup.forEach(dispose => dispose());
    cleanup = [];
    gameHost.requestPlay("start");
    expect(runtime.states[2]).toBe(null);
  });

  it("preserves standalone top-up decline callbacks", () => {
    runtime.states[0] = { ...platform, welcomeCreditGranted: false };
    mount(true);
    const onDecline = vi.fn();
    events.dispatchEvent(new CustomEvent("request-credit-topup", { detail: { onDecline } }));
    expect(runtime.states[5]).toBe(true);
    const welcome = elements(render(true)).find(element => "skipWelcomeCredit" in element.props);
    (welcome?.props.skipWelcomeCredit as () => void)();
    expect(onDecline).toHaveBeenCalledOnce();
    expect(runtime.states[5]).toBe(false);
    expect(runtime.states[3]).toBe(null);
  });

  it("preserves standalone wallet refresh after claiming welcome credits", async () => {
    runtime.states[0] = { ...platform, welcomeCreditGranted: false };
    vi.mocked(claimWelcomeCredit).mockResolvedValue({ welcomeCreditGranted: true, wallet: platform.wallet });
    mount(true);
    const refreshed = vi.fn();
    events.addEventListener("platform-wallet-changed", refreshed);
    events.dispatchEvent(new CustomEvent("request-credit-topup"));
    const welcome = elements(render(true)).find(element => "handleWelcomeCredit" in element.props);
    await (welcome?.props.handleWelcomeCredit as () => Promise<void>)();
    expect(refreshed).toHaveBeenCalledOnce();
    expect(runtime.states[3]).toBe(null);
    expect(runtime.states[5]).toBe(false);
  });
});
