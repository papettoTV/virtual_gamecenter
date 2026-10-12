import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import assert from "node:assert/strict";

const source = readFileSync(new URL("../public/analytics.js", import.meta.url), "utf8");
const key = "pulbase.analytics-consent.v1";
const lifetime = 180 * 86400000;

function runtime({ url = "https://pulbase.example/cabinets/secret?token=private", choice, age = 0, blocked = false, framed = false } = {}) {
  let now = Date.now();
  const storage = new Map();
  if (choice) storage.set(key, JSON.stringify({ version: 1, choice, updatedAt: now - age }));
  const cookies = new Map([["_ga", "tracking"], ["_ga_ABC", "tracking"], ["vgc_session", "session"], ["vgc_device", "device"]]);
  const scripts = [];
  const events = new Map();
  const timers = new Map();
  let timerId = 0;
  const window = {
    location: new URL(url),
    localStorage: {
      getItem(name) { if (blocked) throw Error("blocked"); return storage.get(name) ?? null; },
      setItem(name, value) { if (blocked) throw Error("blocked"); storage.set(name, value); },
    },
    addEventListener(name, listener) { const list = events.get(name) ?? []; list.push(listener); events.set(name, list); },
    setTimeout(callback, delay) { timers.set(++timerId, { callback, delay }); return timerId; },
    clearTimeout(identifier) { timers.delete(identifier); },
  };
  window.top = framed ? {} : window;
  const document = {
    createElement: () => ({}),
    head: { appendChild: (script) => scripts.push(script) },
    get cookie() { return [...cookies].map(([name, value]) => `${name}=${value}`).join("; "); },
    set cookie(value) { cookies.delete(value.split("=")[0]); },
  };
  class Clock extends Date { static now() { return now; } }
  const context = vm.createContext({ window, document, Date: Clock });
  vm.runInContext(source, context);
  return {
    window, storage, scripts, cookies, timers,
    api: window.PulbaseAnalytics,
    emit(name, event = {}) { for (const listener of events.get(name) ?? []) listener(event); },
    advance(duration) { now += duration; const pending = [...timers.values()]; timers.clear(); for (const timer of pending) timer.callback(); },
    bootstrap() { vm.runInContext(source, context); },
  };
}

test("未選択・拒否ではGoogleタグもキューも作らない", () => {
  for (const choice of [undefined, "rejected"]) {
    const state = runtime({ choice });
    assert.equal(state.scripts.length, 0);
    assert.equal(state.window.dataLayer, undefined);
    assert.equal(state.window["ga-disable-G-0SLPCHD77R"], true);
    assert.equal(state.cookies.get("vgc_session"), "session");
  }
});

test("明示同意でのみ読み込み、URLからID・クエリを除外", () => {
  const state = runtime();
  state.api.setChoice("accepted");
  assert.equal(state.scripts.length, 1);
  const commands = state.window.dataLayer.map((command) => [...command]);
  assert.equal(commands.at(-1)[2].page_location, "https://pulbase.example/cabinets/live");
  assert.equal(commands.at(-1)[2].page_referrer, "");
  assert.equal(commands.find((command) => command[0] === "config")[2].send_page_view, false);
  assert.ok(!JSON.stringify(commands).includes("secret"));
  assert.ok(!JSON.stringify(commands).includes("private"));
});

test("撤回後は計測停止、ゲームCookie維持、再同意はタグ重複なし", () => {
  const state = runtime({ choice: "accepted" });
  state.api.setChoice("rejected");
  state.emit("popstate");
  state.window.gtag("event", "ignored");
  assert.equal(state.window.dataLayer.length, 0);
  assert.equal(state.cookies.has("_ga"), false);
  assert.equal(state.cookies.get("vgc_device"), "device");
  state.api.setChoice("accepted");
  assert.equal(state.scripts.length, 1);
  assert.ok(state.window.dataLayer.some((command) => command[0] === "config"));
  assert.equal(state.window["ga-disable-G-0SLPCHD77R"], false);
});

test("ローカル・LAN・file・規約iframeでは同意してもタグを読み込まない", () => {
  for (const url of ["http://localhost:5174/", "http://127.0.0.1/", "http://192.168.0.20/", "http://10.0.0.1/", "http://172.16.0.1/", "file:///index.html"]) {
    assert.equal(runtime({ url, choice: "accepted" }).scripts.length, 0);
  }
  assert.equal(runtime({ framed: true, choice: "accepted" }).scripts.length, 0);
});

test("180日期限・不正値・未来の同意は無効、タイマー上限で早期失効しない", () => {
  for (const options of [{ choice: "accepted", age: lifetime }, { choice: "invalid" }, { choice: "accepted", age: -1 }]) {
    assert.equal(runtime(options).api.getSnapshot().choice, null);
  }
  const state = runtime({ choice: "accepted" });
  state.advance(2147483647);
  assert.equal(state.api.getSnapshot().choice, "accepted");
  state.advance(lifetime);
  assert.equal(state.api.getSnapshot().choice, null);
  assert.equal(state.window["ga-disable-G-0SLPCHD77R"], true);
});

test("他タブでの拒否・保存削除を反映", () => {
  const state = runtime({ choice: "accepted" });
  const existing = JSON.parse(state.storage.get(key));
  state.storage.set(key, JSON.stringify({ ...existing, choice: "rejected" }));
  state.emit("storage", { key });
  assert.equal(state.api.getSnapshot().choice, "rejected");
  assert.equal(state.window["ga-disable-G-0SLPCHD77R"], true);
  state.storage.clear();
  state.emit("storage", { key: null });
  assert.equal(state.api.getSnapshot().choice, null);
});

test("保存禁止でもそのページだけ選択可、二重初期化しない", () => {
  const state = runtime({ blocked: true });
  state.api.setChoice("accepted");
  assert.equal(state.api.getSnapshot().persisted, false);
  assert.equal(state.scripts.length, 1);
  state.bootstrap();
  assert.equal(state.scripts.length, 1);
});

test("ページ遷移も同意時のみ、共有結果IDを除外", () => {
  const state = runtime({ choice: "accepted" });
  state.window.location = new URL("https://pulbase.example/results/player-result?name=private#secret");
  state.emit("popstate");
  assert.equal(state.window.dataLayer.at(-1)[2].page_location, "https://pulbase.example/results/shared");
  state.api.setChoice("rejected");
  state.emit("popstate");
  assert.equal(state.window.dataLayer.length, 0);
});

test("保存済みの選択は次の訪問でも引き継ぐ", () => {
  const state = runtime();
  state.api.setChoice("rejected");
  assert.equal(JSON.parse(state.storage.get(key)).choice, "rejected");
  assert.equal(runtime({ choice: "rejected" }).scripts.length, 0);
  assert.equal(runtime({ choice: "accepted" }).scripts.length, 1);
});

test("同意済み規約iframeは親ページのGA Cookieを削除しない", () => {
  const state = runtime({ choice: "accepted", framed: true });
  assert.equal(state.scripts.length, 0);
  assert.equal(state.cookies.get("_ga"), "tracking");
});
