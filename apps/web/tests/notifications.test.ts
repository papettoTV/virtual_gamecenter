import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NotificationStore } from "../src/features/notifications/notifications";

describe("shared notifications", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("expires success and info after five seconds but retains errors", () => {
    const store = new NotificationStore();
    store.show({ id: "success", type: "success", message: "完了" });
    store.show({ id: "info", type: "info", message: "お知らせ" });
    store.show({ id: "error", type: "error", message: "失敗" });
    vi.advanceTimersByTime(4999);
    expect(store.getSnapshot()).toHaveLength(3);
    vi.advanceTimersByTime(1);
    expect(store.getSnapshot().map(item => item.id)).toEqual(["error"]);
    store.dismiss("error");
    expect(store.getSnapshot()).toEqual([]);
  });

  it("starts the queued notice timer only when a visible slot opens", () => {
    const store = new NotificationStore();
    for (const id of ["first", "second", "third"]) store.show({ id, type: "error", message: id });
    store.show({ id: "queued", type: "success", message: "待機" });
    vi.advanceTimersByTime(10000);
    expect(store.getSnapshot()).toHaveLength(4);
    store.dismiss("first");
    vi.advanceTimersByTime(5000);
    expect(store.getSnapshot().map(item => item.id)).toEqual(["second", "third"]);
  });

  it("replaces duplicate notices and resets the expiry", () => {
    const store = new NotificationStore();
    store.show({ id: "copy", type: "success", message: "コピー" });
    vi.advanceTimersByTime(4000);
    store.show({ id: "copy", type: "success", message: "コピー再完了" });
    vi.advanceTimersByTime(1000);
    expect(store.getSnapshot()).toHaveLength(1);
    vi.advanceTimersByTime(4000);
    expect(store.getSnapshot()).toEqual([]);
  });

  it("clears game notices and prevents their obsolete actions from running", async () => {
    const store = new NotificationStore();
    const run = vi.fn();
    const notice = { id: "retry", scope: "game", type: "error" as const, message: "失敗", action: { label: "再試行", run } };
    store.show(notice);
    store.show({ id: "payment", type: "success", message: "購入完了" });
    store.clearScope("game");
    await store.runAction(notice);
    expect(run).not.toHaveBeenCalled();
    expect(store.getSnapshot().map(item => item.id)).toEqual(["payment"]);
  });

  it("keeps the success notification created by a retry", async () => {
    const store = new NotificationStore();
    const notice = { id: "retry", type: "error" as const, message: "失敗", action: {
      label: "再試行", run: async () => { store.show({ id: "retry", type: "success", message: "成功" }); },
    } };
    store.show(notice);
    await store.runAction(notice);
    expect(store.getSnapshot()[0]?.type).toBe("success");
  });

  it("invalidates asynchronous game feedback on exit while keeping platform feedback", () => {
    const store = new NotificationStore();
    const gameIsActive = store.captureScope("game");
    const platformIsActive = store.captureScope();
    store.clearScope("game");
    expect(gameIsActive()).toBe(false);
    expect(platformIsActive()).toBe(true);
    expect(store.captureScope("game")()).toBe(true);
  });
});
