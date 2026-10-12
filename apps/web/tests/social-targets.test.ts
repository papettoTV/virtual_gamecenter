import { describe, expect, it } from "vitest";
import { createSocialShareUrl, SOCIAL_TARGETS } from "../src/features/sharing/social-targets";

describe("Facebook and X sharing", () => {
  const shared = "https://example.test/results/record?ref=share&shareId=test";
  const text = "深海で新記録！\n#PULBASE & friends";
  it("offers only Facebook and X", () => {
    expect(SOCIAL_TARGETS).toEqual(["facebook", "x"]);
  });
  it("passes the URL to Facebook without inventing a prefilled user message", () => {
    const url = new URL(createSocialShareUrl("facebook", text, shared));
    expect(url.origin + url.pathname).toBe("https://www.facebook.com/sharer/sharer.php");
    expect(url.searchParams.get("u")).toBe(shared);
    expect([...url.searchParams.keys()]).toEqual(["u"]);
  });
  it("preserves editable copy and attribution URL in the X composer", () => {
    const url = new URL(createSocialShareUrl("x", text, shared));
    expect(url.origin + url.pathname).toBe("https://x.com/intent/tweet");
    expect(url.searchParams.get("text")).toBe(text);
    expect(url.searchParams.get("url")).toBe(shared);
  });
});
