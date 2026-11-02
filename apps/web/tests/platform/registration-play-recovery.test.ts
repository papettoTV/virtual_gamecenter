import { ConsentDialog } from "../../src/features/platform/ConsentDialog";
import { AccountRegistrationDialog } from "../../src/features/platform/AccountRegistrationDialog";
import { acceptPolicies } from "../../src/features/platform/platform-client";
import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlatformExperience } from "../../src/features/platform/PlatformExperience";
import { gameHost } from "../../src/game-sdk/game-host";
import { executePlay } from "../../src/features/platform/play-service";
import { claimWelcomeCredit, fetchPlatformBootstrap, PlatformApiError, type PlatformBootstrap } from "../../src/features/platform/platform-client";
import { notifications } from "../../src/features/notifications/notifications";
import { recordPlayStartedFromWatch } from "../../src/features/engagement/engagement-client";

const slots = { pendingAction: 1, playDialog: 2, busy: 3, welcome: 4 } as const;

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
vi.mock("../../src/features/platform/play-service", () => ({ executePlay: vi.fn() }));
vi.mock("../../src/features/platform/platform-client", async importOriginal => ({
  ...await importOriginal<typeof import("../../src/features/platform/platform-client")>(),
  fetchPlatformBootstrap: vi.fn(), claimWelcomeCredit: vi.fn(), acceptPolicies: vi.fn(),
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

describe("registration cancellation with real account and purchase hooks", () => {
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
      // The Workers EventTarget used by this suite has no DOM capture phase.
      // Adapt that boundary here; browser specs verify actual propagation order.
      addEventListener: vi.fn((type: string, listener: EventListener, options?: boolean | AddEventListenerOptions) => {
        events.addEventListener(type, listener, typeof options === "boolean" ? false : { ...options, capture: false });
      }),
      removeEventListener: vi.fn((type: string, listener: EventListener) => {
        events.removeEventListener(type, listener, false);
      }),
      dispatchEvent: events.dispatchEvent.bind(events),
      history: {
        state: { preserved: true },
        replaceState: vi.fn((_state: unknown, _title: string, path: string) => {
          const url = new URL(path, window.location.href);
          window.location.href = url.href;
          window.location.search = url.search;
        }),
      },
      sessionStorage: { getItem: vi.fn(() => null), removeItem: vi.fn() },
    });
    vi.stubGlobal("document", { querySelector: () => null });
    bootstrapPlatform = { ...platform, accountRegistered: false, consent: { ...platform.consent, accepted: false }, wallet: { ...platform.wallet, freeBalance: 0, availableFree: 0, availableTotal: 0 } };
    runtime.states = [bootstrapPlatform];
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

  function component(type: unknown) {
    return elements(render()).find(element => element.type === type)!;
  }

  it.each(["consent", "registration"])("recovers after closing %s without reload", async closeAt => {
    mount();
    gameHost.requestPlay("start");
    await flush();
    const registration = elements(render()).find(element => element.type === "button" && element.props.children === "ユーザー登録で5枚を受け取る")!;
    expect(registration).toBeDefined();
    (registration.props.onClick as () => void)();
    expect(component(ConsentDialog).props.consentPurpose).toBe("registration");
    expect(runtime.states[slots.playDialog]).toBe(null);
    if (closeAt === "registration") {
      vi.mocked(acceptPolicies).mockResolvedValue({ consent: platform.consent, wallet: bootstrapPlatform.wallet });
      await (component(ConsentDialog).props.handleConsent as () => Promise<void>)();
      expect(component(AccountRegistrationDialog).props.accountDialogOpen).toBe(true);
      // Consent success must advance registration, not cancel the pending intent.
      expect(runtime.states[slots.pendingAction]).toBe("start");
      gameHost.requestPlay("retry");
      expect(runtime.states[slots.pendingAction]).toBe("start");
      const dialog = AccountRegistrationDialog(component(AccountRegistrationDialog).props as unknown as Parameters<typeof AccountRegistrationDialog>[0]);
      const close = elements(dialog).find(element => element.props["aria-label"] === "ユーザー登録を閉じる")!;
      (close.props.onClick as () => void)();
    } else {
      const dialog = ConsentDialog(component(ConsentDialog).props as unknown as Parameters<typeof ConsentDialog>[0]);
      const close = elements(dialog).find(element => element.props["aria-label"] === "規約確認を閉じる")!;
      (close.props.onClick as () => void)();
    }
    expect(runtime.states[slots.pendingAction]).toBe(null);
    expect(runtime.states[slots.playDialog]).toBe(null);
    expect((runtime.states[0] as PlatformBootstrap).wallet).toEqual(bootstrapPlatform.wallet);
    expect(executePlay).not.toHaveBeenCalled();
    expect(play).not.toHaveBeenCalled();
    cleanup.forEach(dispose => dispose()); cleanup = [];
    mount();
    gameHost.requestPlay("start"); gameHost.requestPlay("retry");
    await flush();
    expect(runtime.states[slots.pendingAction]).toBe("start");
    expect(runtime.states[slots.playDialog]).toBe("insufficient");
    expect(executePlay).not.toHaveBeenCalled();
    const cancel = elements(render()).find(element => element.props.className === "platform-cancel-button")!;
    (cancel.props.onClick as () => void)();
    // Simulate a later daily refill through the existing wallet refresh boundary.
    bootstrapPlatform = { ...bootstrapPlatform, wallet: platform.wallet };
    vi.mocked(fetchPlatformBootstrap).mockResolvedValue(bootstrapPlatform);
    window.dispatchEvent(new Event("platform-wallet-changed"));
    await flush();
    cleanup.forEach(dispose => dispose()); cleanup = [];
    mount();
    gameHost.requestPlay("start"); gameHost.requestPlay("retry");
    expect(runtime.states[slots.playDialog]).toBe("confirm");
    expect(executePlay).not.toHaveBeenCalled();
    expect(play).not.toHaveBeenCalled();
    let authorize!: () => void;
    vi.mocked(executePlay).mockImplementation(transaction => new Promise(resolve => {
      authorize = () => resolve(transaction.start(transaction.action, "reservation"));
    }));
    confirm(); confirm(); gameHost.requestPlay("start");
    expect(executePlay).toHaveBeenCalledOnce();
    expect(play).not.toHaveBeenCalled();
    authorize(); await flush();
    expect(play).toHaveBeenCalledExactlyOnceWith("start", "reservation");
    expect(runtime.states[slots.pendingAction]).toBe(null);
    expect(runtime.states[slots.playDialog]).toBe(null);
  });
});
