import { expect, it } from "vitest";
import { socialImage } from "../src/worker/social-image";
import { rewriteLivePage } from "../src/worker/live-metadata";
import { rewriteResultPage } from "../src/worker/shared-results";

it.each([
  ["graze-duel", "buzz-barrier"], ["dot-wave", "dot-wave"], ["deep-sea-salvage", "deep-sea-salvage"],
])("renders fixed live and result server metadata for %s", async (gameId, filename) => {
  for (const origin of ["https://develop.virtual-gamecenter.pages.dev", "https://example.test:8443"]) {
    const image = socialImage(gameId, origin);
    expect(image.url).toBe(`${origin}/social/${filename}-ogp-v2.jpg`);
    const shell = () => new Response('<html><head><meta property="og:image" content="old"><meta name="twitter:image" content="old"></head><body></body></html>', { headers: { "Content-Type": "text/html" } });
    const live = rewriteLivePage(shell(), new URL(`${origin}/cabinets/test?game=${gameId}&watch=1`));
    const result = rewriteResultPage(shell(), {
      id: "12345678-1234-4234-8234-123456789012", gameId, gameVersion: "test", playerName: "Player",
      score: 12345, elapsedTimeMs: 1000, cleared: false, metrics: {}, createdAt: "2026-01-01T00:00:00Z",
    }, origin);
    for (const response of [live, result]) {
      const html = await response.text();
      expect(html).toContain(`<meta property="og:image" content="${image.url}">`);
      expect(html).toContain(`<meta name="twitter:image" content="${image.url}">`);
      expect(html).toContain('property="og:image:type" content="image/jpeg"');
      expect(html).toContain('property="og:image:width" content="1200"');
      expect(html).toContain('property="og:image:height" content="630"');
      expect(html).toContain(`property="og:image:alt" content="${image.alt}"`);
      expect(html).toContain(`name="twitter:image:alt" content="${image.alt}"`);
      expect(html.match(/property="og:image"/g)).toHaveLength(1);
      expect(html.match(/name="twitter:image"/g)).toHaveLength(1);
      expect(html).not.toContain('content="old"');
    }
  }
});
it.each(["unknown", "__proto__", "constructor", "mochi-beat"])("uses common artwork for %s", gameId => {
  expect(socialImage(gameId, "https://example.test/path")).toEqual({
    url: "https://example.test/brand/social-card.png", type: "image/png",
    alt: "PULBASE ゲームセンター", width: 1200, height: 630,
  });
});
