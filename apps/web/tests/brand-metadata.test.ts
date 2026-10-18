import { expect, it } from "vitest";
import { rewriteBrandPage } from "../src/worker/live-metadata";

it.each(["https://develop.virtual-gamecenter.pages.dev", "https://pulbase.com"])("uses the current host for the brand card at %s", async origin => {
  const shell = new Response('<head><meta property="og:image" content="/old.png"><meta name="twitter:image" content="/old.png"></head>', { headers: { "content-type": "text/html", etag: "old" } });
  const response = rewriteBrandPage(shell, new URL(origin));
  expect(await response.text()).toContain(`${origin}/brand/social-card.png`);
  expect(response.headers.has("etag")).toBe(false);
});
