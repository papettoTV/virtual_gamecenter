import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanPurchaseParams, formatPurchasePrice, getPurchaseCurrency, restoreStoredPlayAction, storePendingPlayAction } from "../../src/features/platform/purchase-utils";

describe("purchase return helpers", () => {
  let storage: Map<string, string>;
  const replaceState = vi.fn();

  beforeEach(() => {
    storage = new Map();
    vi.stubGlobal("window", {
      sessionStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
      },
      history: { state: { preserved: true }, replaceState },
    });
    vi.stubGlobal("navigator", { language: "ja-JP" });
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

  it("retains Japanese and international prices", () => {
    expect(getPurchaseCurrency()).toBe("jpy");
    expect(formatPurchasePrice(10)).toBe("1000円");
    vi.stubGlobal("navigator", { language: "en-US" });
    expect(getPurchaseCurrency()).toBe("usd");
    expect(formatPurchasePrice(3)).toBe("$3");
  });

  it("does not overwrite a stored action when none is pending", () => {
    storage.set("vgc_pending_play_action", "restartKey");
    storePendingPlayAction(null);
    expect(storage.get("vgc_pending_play_action")).toBe("restartKey");
  });

  it.each(["start", "retry"] as const)("round-trips typed %s actions", action => {
    const setAction = vi.fn();
    storePendingPlayAction(action);
    expect(storage.get("vgc_pending_play_action")).toBe(action);
    expect(restoreStoredPlayAction(setAction)).toBe(true);
    expect(setAction).toHaveBeenCalledWith(action);
  });

  it.each([
    ["start-solo", "start"],
    ["ranking-retry", "retry"],
    ["restartKey", "retry"],
  ])("maps legacy %s to %s without DOM lookup", (stored, action) => {
    storage.set("vgc_pending_play_action", stored);
    const setAction = vi.fn();
    expect(restoreStoredPlayAction(setAction)).toBe(true);
    expect(setAction).toHaveBeenCalledWith(action);
  });

  it("does not restore absent or unknown actions", () => {
    const setAction = vi.fn();
    expect(restoreStoredPlayAction(setAction)).toBe(false);
    storage.set("vgc_pending_play_action", "missing");
    expect(restoreStoredPlayAction(setAction)).toBe(false);
    expect(setAction).not.toHaveBeenCalled();
  });

  it("cleans checkout parameters while preserving the game and history state", () => {
    cleanPurchaseParams(new URL("https://example.test/cabinets/test?game=dot-wave&purchase=success&session_id=checkout#ignored"));
    expect(replaceState).toHaveBeenCalledWith({ preserved: true }, "", "/cabinets/test?game=dot-wave");
  });
});
