import { afterEach, describe, expect, it, vi } from "vitest";
import { CABINET_PRESENCE_EVENT, publishCabinetPresence } from "../../src/realtime/cabinet-presence";

afterEach(() => vi.unstubAllGlobals());

describe("shared cabinet presence", () => {
  it("notifies the UI from the existing socket without an extra directory request", () => {
    const dispatchEvent = vi.fn();
    vi.stubGlobal("window", { dispatchEvent });
    vi.stubGlobal("CustomEvent", class extends Event {
      detail: unknown;
      constructor(type: string, options: { detail: unknown }) { super(type); this.detail = options.detail; }
    });
    const presence = { cabinetId: "room", gameId: "dot-wave", playerCount: 1 };
    publishCabinetPresence(presence);
    expect(dispatchEvent).toHaveBeenCalledWith(expect.objectContaining({ type: CABINET_PRESENCE_EVENT, detail: presence }));
  });
  it("does not require a browser event API in non-browser consumers", () => {
    vi.stubGlobal("window", {});
    expect(() => publishCabinetPresence({ cabinetId: "room", gameId: "graze-duel", playerCount: 0 })).not.toThrow();
  });
});
