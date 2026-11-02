import { describe, expect, it } from "vitest";
import { authorizeRequest } from "../../src/worker/auth";

const basic = { BASIC_AUTH_USERNAME: "test", BASIC_AUTH_PASSWORD: "password" };
const allowed = {
  ...basic, APP_ENV: "staging",
  STAGING_TRUSTED_NETWORKS: JSON.stringify(["192.0.2.20/32", "2001:db8:1234:5678::/64"]),
};
function request(address?: string, headers: Record<string, string> = {}, host = "develop.virtual-gamecenter.pages.dev") {
  return new Request(`https://${host}/`, { headers: {
    "X-Pulbase-Gateway-Environment": "staging",
    ...(address ? { "CF-Connecting-IP": address } : {}), ...headers,
  } });
}

describe("staging trusted networks", () => {
  it.each(["192.0.2.20", "2001:db8:1234:5678::", "2001:0DB8:1234:5678:ffff:ffff:ffff:ffff"])("allows the verified home network without credentials: %s", async address => {
    expect(await authorizeRequest(request(address), allowed)).toBeNull();
  });

  it.each([undefined, "192.0.2.19", "192.0.2.21", "2001:db8:1234:5677:ffff:ffff:ffff:ffff", "2001:db8:1234:5679::", "::ffff:192.0.2.20", "192.0.2.20, 198.51.100.1", "192.0.2.020", "garbage", "2001:db8:1234:5678::%en0"])("retains Basic authentication outside the home network: %s", async address => {
    const denied = await authorizeRequest(request(address), allowed);
    expect(denied?.status).toBe(401);
    expect(denied?.headers.get("WWW-Authenticate")).toContain("Basic");
    expect(denied?.headers.get("Cache-Control")).toBe("no-store");
    expect(await authorizeRequest(request(address, { Authorization: "Basic " + btoa("test:password") }), allowed)).toBeNull();
  });

  it.each([undefined, "", "[]", "null", '"192.0.2.20"', "broken", '["192.0.2.20/32", "bad"]', '["0.0.0.0/0"]', '["::/0"]', '["192.0.2.20/33"]', '["2001:db8::/129"]', '["192.0.2.20/01"]'])("fails back to Basic for missing or malformed configuration: %s", async networks => {
    for (const address of ["192.0.2.20", "2001:db8:1234:5678::1"]) {
      expect((await authorizeRequest(request(address), { ...allowed, STAGING_TRUSTED_NETWORKS: networks }))?.status).toBe(401);
    }
  });

  it("bounds the configuration and rejects mixed non-string entries", async () => {
    for (const networks of [JSON.stringify(Array(33).fill("192.0.2.20")), " ".repeat(4097), '["192.0.2.20", null]', '["192.0.2.20", true]']) {
      expect((await authorizeRequest(request("192.0.2.20"), { ...allowed, STAGING_TRUSTED_NETWORKS: networks }))?.status).toBe(401);
    }
  });

  it("does not trust client-selected forwarding headers, hosts or environments", async () => {
    expect((await authorizeRequest(request(undefined, { "X-Forwarded-For": "192.0.2.20", "X-Real-IP": "192.0.2.20", "X-Pulbase-Client-IP": "192.0.2.20" }), allowed))?.status).toBe(401);
    expect((await authorizeRequest(request("192.0.2.20", { "X-Pulbase-Gateway-Environment": "" }), allowed))?.status).toBe(401);
    for (const host of ["pulbase.com", "virtual-gamecenter.pages.dev", "other.example", "localhost"]) {
      expect((await authorizeRequest(request("192.0.2.20", {}, host), allowed))?.status).toBe(401);
    }
    for (const environment of [undefined, "production", "local"]) {
      expect((await authorizeRequest(request("192.0.2.20"), { ...allowed, APP_ENV: environment }))?.status).toBe(401);
    }
  });

  it("supports exact IPv6 addresses and IPv4 CIDR boundaries", async () => {
    const env = { ...allowed, STAGING_TRUSTED_NETWORKS: '["2001:db8::1/128", "198.51.100.32/30"]' };
    for (const address of ["2001:0db8:0:0:0:0:0:1", "198.51.100.32", "198.51.100.35"]) expect(await authorizeRequest(request(address), env)).toBeNull();
    for (const address of ["2001:db8::2", "198.51.100.31", "198.51.100.36"]) expect((await authorizeRequest(request(address), env))?.status).toBe(401);
  });
});
