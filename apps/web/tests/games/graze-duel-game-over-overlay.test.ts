import { describe, expect, it } from "vitest";
import { drawGameOverOverlay } from "../../src/games/graze-duel/rendering/game-over-overlay";

function render(role: string, clear: boolean, result: object | null) {
  const texts: { text: string; x: number; y: number; color: string }[] = [];
  const rectangles: number[][] = [];
  const context = {
    fillStyle: "", font: "", textAlign: "left",
    fillRect: (...args: number[]) => rectangles.push(args),
    fillText(text: string, x: number, y: number) {
      texts.push({ text, x, y, color: this.fillStyle });
    },
  };
  drawGameOverOverlay(context, {
    cabinetRole: role, clearGame: clear, lastRankingResult: result,
    elapsedRound: 45.81, players: [{ score: 2268, lives: 0 }],
  }, 960, 720);
  expect(rectangles).toEqual([[0, 0, 960, 720]]);
  expect(context.textAlign).toBe("left");
  return texts;
}
const title = (text: string, y = 332) => ({ text, x: 480, y, color: "#f4f7ff" });
const waiting = (y = 378) => ({
  text: "プレイヤーが続けるか辞めるか選ぶのを待っています",
  x: 480, y, color: "#69f7ff",
});

describe("BUZZ BARRIER終了オーバーレイ", () => {
  it.each([null, { rank: 1 }])("観戦終了は結果%jでもタイトルと待機文言のみ", result => {
    expect(render("spectator", false, result)).toEqual([title("GAME OVER"), waiting()]);
  });
  it("観戦クリアはタイトルと待機文言を別位置に描く", () => {
    expect(render("spectator", true, { rank: 1 })).toEqual([
      title("ALL CLEAR  TIME 45s", 242), waiting(288),
    ]);
  });
  it("プレイヤーの終了演出はSCOREを維持する", () => {
    expect(render("player", false, null)).toEqual([
      title("GAME OVER"), { text: "SCORE 2268", x: 480, y: 378, color: "#69f7ff" },
    ]);
  });
  it("プレイヤーの結果確定後はSCOREとリトライ案内を維持する", () => {
    expect(render("player", false, { rank: 1 })).toEqual([
      title("SCORE 2268"), title("Rキーで1クレジットリトライ", 378),
    ]);
  });
  it.each([null, { rank: 1 }])("プレイヤーのクリアは結果%jでもALL CLEARのみ", result => {
    expect(render("player", true, result)).toEqual([title("ALL CLEAR  TIME 45s", 242)]);
  });
});
