import { describe, expect, it } from "vitest";
import {
  getCreditAmount,
  verifyStripeSignature,
} from "../../src/worker/platform";

describe("credit purchases", () => {
  it("adds the ten-unit bonus", () => {
    expect(getCreditAmount(1)).toBe(5);
    expect(getCreditAmount(3)).toBe(15);
    expect(getCreditAmount(5)).toBe(25);
    expect(getCreditAmount(10)).toBe(60);
  });

  it("rejects unsupported unit counts", () => {
    expect(() => getCreditAmount(2)).toThrow("invalid_credit_unit");
  });

  it("verifies Stripe webhook signatures", async () => {
    const payload = JSON.stringify({ id: "evt_test", type: "checkout.session.completed" });
    const timestamp = Math.floor(Date.now() / 1000);
    const secret = "whsec_test";
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const digest = await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(`${timestamp}.${payload}`),
    );
    const signature = Array.from(new Uint8Array(digest), (byte) => (
      byte.toString(16).padStart(2, "0")
    )).join("");

    await expect(
      verifyStripeSignature(payload, `t=${timestamp},v1=${signature}`, secret),
    ).resolves.toBe(true);
    await expect(
      verifyStripeSignature(payload, `t=${timestamp},v1=invalid`, secret),
    ).resolves.toBe(false);
  });
});
