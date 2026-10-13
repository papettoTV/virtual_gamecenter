import { afterEach, describe, expect, it, vi } from "vitest";
import { createCabinetClient } from "../../src/realtime/cabinet-client";

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
describe("cabinet reconnect budgets", () => {
  it("backs off failed handshakes and stops automatically on policy close", async () => {
    vi.useFakeTimers();
    const sockets: FakeSocket[] = [];
    class FakeSocket extends EventTarget {
      static OPEN = 1;
      readyState = 0;
      bufferedAmount = 0;
      send = vi.fn();
      constructor() { super(); sockets.push(this); }
      close(code = 1006) { this.readyState = 3; this.dispatchEvent(Object.assign(new Event("close"), { code })); }
      open() { this.readyState = 1; this.dispatchEvent(new Event("open")); }
    }
    vi.stubGlobal("WebSocket", FakeSocket);
    vi.stubGlobal("window", { location: { protocol: "https:", host: "example.test" }, setTimeout, clearTimeout });
    const client = createCabinetClient();
    client.join("test", "graze-duel");
    sockets[0]!.close();
    await vi.advanceTimersByTimeAsync(1000); expect(sockets).toHaveLength(2);
    sockets[1]!.close();
    await vi.advanceTimersByTimeAsync(1000); expect(sockets).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1000); expect(sockets).toHaveLength(3);
    sockets[2]!.open(); sockets[2]!.close(1008);
    await vi.advanceTimersByTimeAsync(60_000); expect(sockets).toHaveLength(3);
    client.leave();
  });
});
