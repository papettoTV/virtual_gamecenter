import { afterEach, describe, expect, it, vi } from "vitest";
import { recordWatchStarted } from "../../src/features/engagement/engagement-client";

afterEach(() => vi.unstubAllGlobals());

describe("showcase watch attribution", () => {
  it("does not record automatic previews as intentional watch arrivals", () => {
    const storage = { getItem: vi.fn(), setItem: vi.fn() };
    const fetch = vi.fn();
    vi.stubGlobal("window", { self: {}, top: {} });
    vi.stubGlobal("location", { href: "https://example.com/cabinets/room?watch=1&preview=1" });
    vi.stubGlobal("sessionStorage", storage);
    vi.stubGlobal("fetch", fetch);
    recordWatchStarted("graze-duel", "room");
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("still records a direct visit to a watch URL", () => {
    const storage = { getItem: vi.fn(), setItem: vi.fn() };
    const fetch = vi.fn().mockResolvedValue(new Response());
    const frame = {};
    vi.stubGlobal("window", { self: frame, top: frame });
    vi.stubGlobal("location", { href: "https://example.com/cabinets/room?watch=1&preview=1" });
    vi.stubGlobal("sessionStorage", storage);
    vi.stubGlobal("fetch", fetch);
    recordWatchStarted("graze-duel", "room");
    expect(storage.setItem).toHaveBeenCalledWith("vgc_watch_recorded:room", "1");
    expect(fetch).toHaveBeenCalledWith("/api/platform/engagement/events", expect.objectContaining({ method: "POST" }));
  });
});
