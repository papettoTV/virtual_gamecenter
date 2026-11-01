import { afterEach, beforeEach, expect, it, vi } from "vitest";

let sockets: Socket[];
class Socket extends EventTarget {
  static OPEN = 1;
  readyState = 0;
  bufferedAmount = 0;
  send = vi.fn();
  constructor(readonly url: string) { super(); sockets.push(this); }
  close() { this.readyState = 3; }
  open() { this.readyState = 1; this.dispatchEvent(new Event("open")); }
  receive(message: object) { this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(message) })); }
}
beforeEach(() => {
  vi.resetModules(); vi.useFakeTimers(); sockets = [];
  vi.stubGlobal("window", { location: { protocol: "http:", host: "localhost", search: "" }, setTimeout, clearTimeout });
  vi.stubGlobal("WebSocket", Socket);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
async function setup() {
  let finish!: (response: Response) => void;
  const fetch = vi.fn((_url: string, _init?: RequestInit) => new Promise<Response>(resolve => { finish = resolve; }));
  vi.stubGlobal("fetch", fetch);
  const { createCabinetSession } = await import("../../src/game-sdk/cabinet-session");
  const { GameLifetime } = await import("../../src/game-sdk/lifetime");
  const lifetime = new GameLifetime();
  const onError = vi.fn();
  const session = createCabinetSession({ gameId: "graze-duel", lifetime, onError });
  return { session, lifetime, fetch, onError, finish: (ok = true) => finish(new Response(JSON.stringify(ok ? {} : { error: "unavailable" }), { status: ok ? 200 : 503 })) };
}
it.each(["graze-duel", "deep-sea-salvage", "dot-wave"])("shares guest creation and waits before admission timeout: %s", async game => {
  const { session, fetch, finish } = await setup();
  const { fetchPlatformBootstrap } = await import("../../src/features/platform/platform-client");
  const initial = fetchPlatformBootstrap();
  session.join("first", game);
  const ready = vi.fn(); const waiting = session.waitForPlayer().then(ready);
  session.send({ type: "joinCabinet", gameId: game, watch: false });
  await vi.advanceTimersByTimeAsync(6500);
  expect(sockets).toHaveLength(0); expect(ready).not.toHaveBeenCalled(); expect(fetch).toHaveBeenCalledTimes(1);
  finish(); await initial; await vi.advanceTimersByTimeAsync(0);
  expect(sockets).toHaveLength(1);
  sockets[0]!.open();
  expect(JSON.parse(sockets[0]!.send.mock.calls[0]![0])).toEqual({ type: "joinCabinet", gameId: game, watch: false });
  sockets[0]!.receive({ type: "joinedCabinet", role: "player", clientId: "local" });
  await waiting; expect(ready).toHaveBeenCalledWith(true);
  session.leave(); session.join("next", game); await vi.advanceTimersByTimeAsync(0);
  expect(fetch).toHaveBeenCalledTimes(1); expect(sockets).toHaveLength(2);
  session.leave();
});
it.each(["graze-duel", "deep-sea-salvage", "dot-wave"].flatMap(game =>
  ["leave", "dispose", "move"].map(action => [game, action])
))("invalidates pending %s guest connection on %s", async (game, action) => {
  const { session, lifetime, finish } = await setup();
  session.join("old", game); const waiting = session.waitForPlayer();
  await vi.advanceTimersByTimeAsync(6500);
  expect(sockets).toHaveLength(0);
  if (action === "dispose") lifetime.dispose();
  else if (action === "leave") session.leave();
  else session.join("new", "dot-wave", true);
  await expect(waiting).resolves.toBe(false);
  finish(); await vi.advanceTimersByTimeAsync(0);
  expect(sockets).toHaveLength(action === "move" ? 1 : 0);
  if (action === "move") {
    expect(sockets[0]!.url).toContain("/new/ws?gameId=dot-wave");
    sockets[0]!.open();
    expect(JSON.parse(sockets[0]!.send.mock.calls[0]![0]).watch).toBe(true);
  }
  session.leave();
});
it("fails closed without retrying or charging when bootstrap fails, and permits an explicit retry", async () => {
  const { session, fetch, finish, onError } = await setup();
  session.join("first", "graze-duel"); const waiting = session.waitForPlayer();
  finish(false); await expect(waiting).resolves.toBe(false);
  await vi.advanceTimersByTimeAsync(30_000);
  expect(sockets).toHaveLength(0); expect(onError).toHaveBeenCalledOnce(); expect(fetch).toHaveBeenCalledTimes(1);
  session.join("first", "graze-duel"); finish(); await vi.advanceTimersByTimeAsync(0);
  expect(sockets).toHaveLength(1); expect(fetch).toHaveBeenCalledTimes(2);
  expect(fetch.mock.calls.every(call => String(call[0]).endsWith("/api/platform/bootstrap"))).toBe(true);
  session.leave();
});
it.each(["graze-duel", "deep-sea-salvage", "dot-wave"])("starts the %s admission budget only after bootstrap, and still times out absent authorization", async game => {
  const { session, finish } = await setup();
  session.join("first", game);
  const settled = vi.fn(); const waiting = session.waitForPlayer().then(settled);
  await vi.advanceTimersByTimeAsync(6500);
  expect(settled).not.toHaveBeenCalled();
  finish(); await vi.advanceTimersByTimeAsync(4999);
  expect(settled).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1); await waiting;
  expect(settled).toHaveBeenCalledWith(false);
  await expect(session.startSolo("unapproved")).resolves.toBe(false);
  expect(sockets[0]!.send).not.toHaveBeenCalled();
  session.leave();
});
