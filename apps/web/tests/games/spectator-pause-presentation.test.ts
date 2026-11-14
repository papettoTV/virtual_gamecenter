import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { getPausePresentation } from "../../src/games/graze-duel/rendering/pause-presentation";
import { createRenderer } from "../../src/games/deep-sea-salvage/renderer";
import { createState } from "../../src/games/deep-sea-salvage/state";
import { createDefaultTerrain } from "../../src/games/deep-sea-salvage/terrain";
import type { Simulation } from "../../src/games/deep-sea-salvage/simulation";
import { SalvageIntro } from "../../src/games/deep-sea-salvage/ui/SalvageGameUI";

afterEach(() => vi.unstubAllGlobals());

describe("BUZZ BARRIERの開始・再開待ち", () => {
  it.each([true, false])("観戦はcompact=%sでも操作を促さない", compact => {
    for (const waitingForStart of [true, false]) {
      expect(getPausePresentation({ cabinetRole: "spectator", compact, waitingForStart })).toEqual({
        action: `プレイヤーの${waitingForStart ? "開始" : "再開"}を待っています`, instructions: [],
      });
    }
  });

  it.each([true, false])("プレイヤーのcompact=%sの操作説明は維持する", compact => {
    for (const waitingForStart of [true, false]) {
      const presentation = getPausePresentation({ cabinetRole: "player", compact, waitingForStart });
      expect(presentation.instructions).toHaveLength(compact ? 2 : 3);
      expect(presentation.action).toContain(waitingForStart ? (compact ? "右上の「▶」をタップして開始" : "ゲーム開始") : "再開");
      expect(presentation.instructions.join(" ")).toContain(compact ? "スライド" : "WASD");
    }
  });
});

function renderSalvage(watching: boolean, mode: "ready" | "pause" | "collection", compact = true) {
  const texts: string[] = [];
  const context = new Proxy<Record<string, unknown>>({
    fillText: (text: string) => texts.push(text),
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} }),
  }, { get: (target, property: string) => target[property] ?? (() => {}) });
  const canvas = {
    width: 960, height: 640, getContext: () => context,
    getBoundingClientRect: () => compact ? ({ width: 375, height: 560 }) : ({ width: 960, height: 640 }),
  } as unknown as HTMLCanvasElement;
  vi.stubGlobal("document", { createElement: () => canvas });
  vi.stubGlobal("Image", class { src = ""; });
  const state = createState(960, createDefaultTerrain());
  if (mode !== "ready") { state.phase = "dive"; state.message = "魚を調査して電力をつなぎ、深海へ潜れ"; }
  state.paused = mode === "pause";
  state.collectionOpen = mode === "collection";
  const queries = {
    screenY: (depth: number) => 400 + depth,
    getCurrentVelocity: () => 0, isVentActive: () => false,
    canResearchBoss: () => false, dangerSpawnX: () => 100,
  } as unknown as Pick<Simulation, "screenY" | "getCurrentVelocity" | "isVentActive" | "canResearchBoss" | "dangerSpawnX">;
  const renderer = createRenderer(canvas, state, queries, new URLSearchParams(), () => watching);
  renderer.draw(); renderer.dispose();
  return texts;
}

describe("深海サルベージの観戦案内", () => {
  it.each([
    ["ready", "プレイヤーの開始を待っています"],
    ["pause", "プレイヤーの再開を待っています"],
    ["collection", "プレイヤーが図鑑を表示しています"],
  ] as const)("観戦の%s画面は操作を促さない", (mode, message) => {
    const texts = renderSalvage(true, mode);
    expect(texts).toContain(message);
    expect(texts.join(" ")).not.toMatch(/WASD|潜航開始|ボタンで再開|ボタンで閉じる|クリックでリザルト/);
  });

  it.each([true, false])("プレイヤーのready画面はcompact=%sでもHTMLにタッチ・キーボードの操作説明と開始ボタンを維持する", compact => {
    // Ready instructions moved to responsive HTML so they remain readable on phones.
    // The canvas must not add a second, keyboard-only start prompt underneath it.
    expect(renderSalvage(false, "ready", compact).join(" ")).not.toMatch(/プレイヤーの開始を待っています|潜航開始/);
    const html = renderToStaticMarkup(createElement(SalvageIntro));
    expect(html).toContain('class="salvage-touch-help">画面を押したまま、進みたい方向へ指を動かす');
    expect(html).toContain('class="salvage-touch-help">タップして潜航開始');
    expect(html).toContain('class="salvage-key-help">WASD / 矢印: 移動　P: 一時停止');
    expect(html).toContain('class="salvage-key-help">潜航開始（P）');
    expect(html).toMatch(/<button\b(?=[^>]*\baria-label="潜航開始")(?=[^>]*\btype="button")(?=[^>]*\bdata-ready-start="")[^>]*>/);
    expect(html).toContain("確認画面で承認すると1クレジットを使用します");
  });

  it.each([
    ["pause", "P / 一時停止ボタンで再開"],
    ["collection", "F / 図鑑ボタンで閉じる"],
  ] as const)("プレイヤーの%s画面は操作説明を維持する", (mode, message) => {
    expect(renderSalvage(false, mode)).toContain(message);
  });
});

