import { afterEach, describe, expect, it, vi } from "vitest";
import { createCabinetClient } from "../../src/realtime/cabinet-client";

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
describe("cabinet reconnect budgets", () => {
  it.each(["graze-duel", "dot-wave", "deep-sea-salvage"])("acknowledges only decoded start permissions on the current connection: %s", game => {
    const sockets: FakeSocket[] = [];
    class FakeSocket extends EventTarget {
      static OPEN = 1;
      readyState = 1;
      bufferedAmount = 0;
      send = vi.fn();
      constructor() { super(); sockets.push(this); }
      close() { this.readyState = 3; }
      receive(value: object) { this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(value) })); }
    }
    vi.stubGlobal("WebSocket", FakeSocket);
    vi.stubGlobal("window", { location: { protocol: "https:", host: "example.test", search: "" }, setTimeout, clearTimeout });
    const onMessage = vi.fn(), client = createCabinetClient({ onMessage });
    client.join("first", game);
    const first = sockets[0]!;
    const startReceipt = { attemptId: "request", token: "nonce", type: "startSolo", ignored: "private" };
    first.receive({ type: "soloStarted", reservationId: "request", startReceipt });
    expect(JSON.parse(first.send.mock.lastCall![0])).toEqual({ type: "startReceipt", attemptId: "request", token: "nonce" });
    first.send.mockClear();
    first.receive({ type: "versusCountdown", matchId: "match", startsAt: 1, startReceipt });
    expect(first.send).toHaveBeenCalledTimes(1);
    first.send.mockClear();
    first.receive({ type: "viewerKeyframe", startReceipt });
    first.receive({ type: "soloStarted", startReceipt: { attemptId: "", token: "nonce" } });
    first.receive({ type: "soloStarted", startReceipt: { attemptId: "request", token: "x".repeat(65) } });
    expect(first.send).not.toHaveBeenCalled();
    first.send.mockImplementation(() => { throw Error("socket closed"); });
    const before = onMessage.mock.calls.length;
    first.receive({ type: "soloStarted", startReceipt });
    expect(onMessage.mock.calls).toHaveLength(before + 1);
    client.join("second", game);
    first.send.mockClear();
    first.receive({ type: "soloStarted", startReceipt });
    expect(first.send).not.toHaveBeenCalled();
    client.leave();
  });
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
