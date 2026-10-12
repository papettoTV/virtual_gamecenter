import { describe, expect, it } from "vitest";
import { rewriteLivePage } from "../src/worker/live-metadata";
import { renderLiveImage } from "../src/worker/result-image";

describe("live URL metadata", () => {
  it("identifies the game without stale claims that play is in progress", async () => {
    const shell = new Response('<html><head><title>Old</title><meta property="og:title" content="Old"></head><body><div id="root"></div></body></html>', { headers: { "Content-Type": "text/html", ETag: "old" } });
    const response = rewriteLivePage(shell, new URL("https://example.test/cabinets/test?game=deep-sea-salvage&shareId=private-attribution"));
    const html = await response.text();
    expect(html).toContain("DEEP SEA SALVAGEの観戦");
    expect(html).toContain("開始前・終了後");
    expect(html).not.toContain("private-attribution");
    expect(html.match(/property="og:title"/g)).toHaveLength(1);
    expect(html).toContain("/share/live/deep-sea-salvage/image.png");
    expect(response.headers.has("etag")).toBe(false);
  });
  it("generates an actual PNG for live invitations", async () => {
    const response = await renderLiveImage("dot-wave");
    expect(response.headers.get("content-type")).toBe("image/png");
    expect([...new Uint8Array(await response.arrayBuffer()).slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  });
});
