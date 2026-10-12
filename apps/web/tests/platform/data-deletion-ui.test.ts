import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PlatformProfile, type PlatformProfileProps } from "../../src/features/platform/PlatformProfile";
import { clearPlatformStorage } from "../../src/features/platform/DataDeletionDialog";

afterEach(() => vi.unstubAllGlobals());

describe("data deletion profile controls", () => {
  it("exposes distinct guest and registered deletion actions without offering logout as deletion", () => {
    const props = {
      profileOpen: true, profileRef: { current: null }, setProfileOpen: vi.fn(), editingName: false, setEditingName: vi.fn(), nameDraft: "", setNameDraft: vi.fn(), busy: false,
      savePlayerName: vi.fn(), handleLogout: vi.fn(), requestUserRegistration: vi.fn(), standaloneCredits: false,
      platform: { playerId: "test", playerName: "Player-test", accountRegistered: false, wallet: { availableTotal: 5, availableFree: 5, availablePurchased: 0 } },
    } as unknown as PlatformProfileProps;
    expect(renderToStaticMarkup(createElement(PlatformProfile, props))).toContain("ゲストデータを削除");
    const registered = renderToStaticMarkup(createElement(PlatformProfile, { ...props, platform: { ...props.platform!, accountRegistered: true } }));
    expect(registered).toContain("退会・データ削除");
    expect(registered).toContain("ログアウト");
    expect(registered).toContain("ランキング・共有結果を削除");
  });

  it("clears platform and game storage without erasing unrelated browser data", () => {
    const values = new Map([["vgc_pending_play_action", "start"], ["pulbase.deep-sea-salvage.terrain.v1", "terrain"], ["dot-wave:best:v1:win", "10"], ["grazeDuelRankingApiBase", "test"], ["unrelated", "keep"]]);
    const storage = { get length() { return values.size; }, key: (index: number) => [...values.keys()][index], removeItem: (key: string) => values.delete(key) };
    vi.stubGlobal("window", { localStorage: storage, sessionStorage: storage });
    clearPlatformStorage();
    expect([...values]).toEqual([["unrelated", "keep"]]);
  });

  it("reports blocked browser storage without misreporting the server deletion as failed", () => {
    vi.stubGlobal("window", { get localStorage() { throw new Error("blocked"); }, get sessionStorage() { throw new Error("blocked"); } });
    expect(clearPlatformStorage()).toBe(false);
  });
});
