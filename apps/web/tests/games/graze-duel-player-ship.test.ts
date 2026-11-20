import { expect, it, vi } from "vitest";
import { drawPlayerShip, getPlayerShipStage, getPlayerWingRotation, type PlayerShipLayer } from "../../src/games/graze-duel/rendering/player-ship";

function render(level?: number, elapsed = 0, layer: PlayerShipLayer = "all") {
  const points: number[][] = [];
  const panels: number[][][] = [];
  let path: number[][] = [];
  const brush = {
    save: vi.fn(), restore: vi.fn(), beginPath: () => { path = []; }, closePath: vi.fn(),
    fill: () => panels.push([...path]), stroke: vi.fn(),
    moveTo: (x: number, y: number) => { points.push([x, y]); path.push([x, y]); },
    lineTo: (x: number, y: number) => { points.push([x, y]); path.push([x, y]); },
    fillRect: (x: number, y: number, width: number, height: number) => points.push([x, y], [x + width, y + height]),
  };
  drawPlayerShip(brush as unknown as CanvasRenderingContext2D, "#69f7ff", 1, level, { elapsed, layer });
  return { points, panels, brush };
}

it.each([[0, 1], [9, 1], [10, 2], [29, 2], [30, 3], [100, 3]])("LV %iで第%i段階になる", (level, stage) => {
  expect(getPlayerShipStage(level)).toBe(stage);
});

it("レベルがない既存描画・観戦データは基本形で描ける", () => {
  expect(getPlayerShipStage()).toBe(1);
  expect(render().points).toEqual(render(0).points);
});

it("3段階とも同じ34×37の表示範囲で中央座標や倍率を変更しない", () => {
  for (const level of [0, 10, 30]) {
    const { points, brush } = render(level);
    expect([
      Math.min(...points.map(point => point[0]!)), Math.max(...points.map(point => point[0]!)),
      Math.min(...points.map(point => point[1]!)), Math.max(...points.map(point => point[1]!)),
    ]).toEqual([-17, 17, -18, 19]);
    expect(brush.save).toHaveBeenCalledOnce();
    expect(brush.restore).toHaveBeenCalledOnce();
  }
});

it("10と30の境界だけで本体形状が変わり、再スタート時は基本形に戻る", () => {
  expect(render(9).points).toEqual(render(0).points);
  expect(render(10).points).not.toEqual(render(9).points);
  expect(render(29).points).toEqual(render(10).points);
  expect(render(30).points).not.toEqual(render(29).points);
  expect(render(100).points).toEqual(render(30).points);
  expect(render(0).points).not.toEqual(render(30).points);
});

it("第3段階は左右の翼を前方に置き、コアの前を囲む盾形にする", () => {
  const { panels } = render(30);
  for (const panel of panels.slice(1, 3)) {
    expect(Math.min(...panel.map(point => point[1]!))).toBe(-18);
    expect(Math.max(...panel.map(point => point[1]!))).toBe(2);
    expect(panel.reduce((sum, point) => sum + point[1]!, 0) / panel.length).toBeLessThan(-9);
  }
  expect(panels[2]).toEqual(panels[1]!.map(([x, y]) => [-x!, y]));
});

it("第3段階の翼だけが前後軸で回り、上からは幅が縮んで裏返る", () => {
  expect(getPlayerWingRotation(2.4)).toBeCloseTo(Math.PI * 2);
  const front = render(30, 0, "wings");
  const edge = render(30, 0.6, "wings");
  const back = render(30, 1.2, "wings");
  expect(front.panels).toHaveLength(2);
  for (const [index, point] of front.points.entries()) {
    expect(edge.points[index]![0]).toBeCloseTo(0);
    expect(back.points[index]![0]).toBeCloseTo(-point[0]!);
    expect(edge.points[index]![1]).toBe(point[1]);
    expect(back.points[index]![1]).toBe(point[1]);
  }
  expect(render(30, 0, "body").points).toEqual(render(30, 0.6, "body").points);
  for (const level of [0, 10]) {
    expect(render(level, 0).points).toEqual(render(level, 0.6).points);
    expect(render(level, 0, "wings").points).toEqual([]);
  }
});

it("回転しても元の描画範囲を超えず、同じゲーム時刻では同じ姿になる", () => {
  for (let index = 0; index <= 24; index += 1) {
    const elapsed = index / 10;
    const { points } = render(30, elapsed);
    expect(points.every(([pointX, pointY]) => Math.abs(pointX!) <= 17 && pointY! >= -18 && pointY! <= 19)).toBe(true);
    expect(points).toEqual(render(30, elapsed).points);
  }
});
