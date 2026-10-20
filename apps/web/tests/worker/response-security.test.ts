import { describe, expect, it } from "vitest";
import { authorizeRequest } from "../../src/worker/auth";
import { secureResponse } from "../../src/worker/response-security";

const request = (credentials?: string) => new Request("https://develop.virtual-gamecenter.pages.dev/", {
  headers: credentials ? { Authorization: "Basic " + btoa(credentials) } : {},
});
const auth = { BASIC_AUTH_USERNAME: "operator", BASIC_AUTH_PASSWORD: "long-password:with-colon" };

describe("response security", () => {
  it("accepts matching credentials and rejects mismatched names, passwords and lengths", async () => {
    expect(await authorizeRequest(request("operator:long-password:with-colon"), auth)).toBeNull();
    for (const value of [undefined, "other:long-password:with-colon", "operator:wrong", "operator:", "op:long-password:with-colon"]) {
      const denied = await authorizeRequest(request(value), auth);
      expect(denied?.status).toBe(401);
      expect(denied?.headers.get("Cache-Control")).toBe("no-store");
      expect(denied?.headers.get("WWW-Authenticate")).toContain("Basic");
    }
  });

  it("fails closed without configuration and preserves local development access", async () => {
    expect((await authorizeRequest(request(), {}))?.status).toBe(503);
    for (const host of ["localhost", "127.0.0.1", "[::1]", "192.168.0.10", "10.0.0.1", "172.16.0.1"]) {
      expect(await authorizeRequest(new Request(`http://${host}/`), { APP_ENV: "local" })).toBeNull();
      expect((await authorizeRequest(new Request(`http://${host}/`), { ...auth, APP_ENV: "staging" }))?.status).toBe(401);
    }
    for (const host of ["10.attacker.example", "192.168.attacker.example", "172.16.attacker.example", "172.32.0.1"]) {
      expect((await authorizeRequest(new Request(`https://${host}/`), { ...auth, APP_ENV: "local" }))?.status).toBe(401);
    }
    expect((await authorizeRequest(new Request("https://develop.virtual-gamecenter.pages.dev/", { headers: { Authorization: "Basic %%%" } }), auth))?.status).toBe(401);
  });

  it.each(["/api/platform/bootstrap", "/api/platform/auth/google/callback?code=private", "/api/platform/data-deletion/preview", "/api/platform/profile"])("does not cache personal responses including errors and redirects: %s", path => {
    for (const status of [200, 302, 401, 403, 503]) {
      const result = secureResponse(new Request("https://example.com" + path), new Response(null, {
        status, headers: { "Cache-Control": "public, max-age=86400", "Set-Cookie": "vgc_session=test; HttpOnly; Secure", Location: "/?account=error" },
      }));
      expect(result.headers.get("Cache-Control")).toBe("private, no-store");
      expect(result.headers.get("Referrer-Policy")).toBe("no-referrer");
      expect(result.headers.get("X-Content-Type-Options")).toBe("nosniff");
      expect(result.headers.get("Set-Cookie")).toContain("HttpOnly");
      expect(result.headers.get("Location")).toBe("/?account=error");
    }
  });

  it("preserves public asset caching and prevents caching access-denied pages", () => {
    const asset = secureResponse(new Request("https://example.com/icon.png"), new Response(null, { headers: { "Cache-Control": "public, max-age=3600" } }));
    expect(asset.headers.get("Cache-Control")).toBe("public, max-age=3600");
    expect(secureResponse(request(), new Response(null, { status: 401 })).headers.get("Cache-Control")).toBe("no-store");
  });

  it("returns WebSocket upgrades unchanged", () => {
    const pair = new WebSocketPair();
    pair[1].accept();
    const upgrade = new Response(null, { status: 101, webSocket: pair[0] });
    expect(secureResponse(request(), upgrade)).toBe(upgrade);
    pair[1].close();
  });
});
