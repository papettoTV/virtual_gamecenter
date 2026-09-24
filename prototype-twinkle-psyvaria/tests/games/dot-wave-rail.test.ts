import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { createExchange, tap } from "../../src/games/mochi-beat/duel/core";
import { NeonRail, railState, railX, railLanes } from "../../src/games/mochi-beat/duel/NeonRail";

it.each([60/108, 60/156, 60/216])("aligns each diamond with the judgement clock at tempo %s", beatSeconds => {
  const exchange = createExchange(0, 12, beatSeconds);
  for (const side of [0, 1] as const) {
    const chart = side === 0 ? exchange.attack : exchange.defense;
    for (const note of chart.notes) {
      const seconds = note.beat * beatSeconds;
      const state = railState(exchange, seconds);
      expect(railX(state.progress)).toBeCloseTo(railX(note.beat - state.offset));
      expect(tap(exchange, side, seconds)).toBe("perfect");
    }
  }
});

it("keeps separate four-beat charts and previews defense two beats early", () => {
  const exchange = createExchange(0, 0, .5);
  expect(railLanes(exchange, 2.999)).toEqual([4]);
  expect(railLanes(exchange, 3)).toEqual([4, 8]);
  expect(railState(exchange, 3, 4).notes).toBe(exchange.attack.notes);
  expect(railState(exchange, 3, 4).progress).toBe(2);
  expect(railState(exchange, 3, 8).progress).toBe(-2);
  expect(railState(exchange, 3, 8).cursorVisible).toBe(true);
  expect(railLanes(exchange, 4)).toEqual([8]);
  expect(railState(exchange, 4).progress).toBe(0);
  expect(railState(exchange, 4).notes).toBe(exchange.defense.notes);
  expect(railX(-2)).toBe(40);
  expect(railX(4)).toBe(960);
  expect(railState(exchange, .999).cursorVisible).toBe(false);
  expect(railState(exchange, 1).cursorVisible).toBe(true);
  const distance = railX(-1) - railX(-2);
  for (let beat = -1; beat < 4; beat++) expect(railX(beat + 1) - railX(beat)).toBeCloseTo(distance);
});

it.each([0, 1] as const)("overlays only the upcoming side's lead-in, leaving current targets readable (attacker %s)", attacker => {
  const exchange = createExchange(attacker, 0, .5);
  exchange.attack.notes[0]!.grade = "perfect";
  const html = renderToStaticMarkup(createElement(NeonRail, { exchange, seconds: 3, viewSide: (1 - attacker) as 0 | 1 }));
  expect(html.match(/class="neon-rail-cursor"/g)).toHaveLength(2);
  expect(html.match(/class="neon-rail-note /g)).toHaveLength(exchange.attack.notes.length);
  expect(html).toContain('class="neon-rail-note perfect"');
  expect(html).toContain("あなたの防御、2拍前から準備");
  const after = renderToStaticMarkup(createElement(NeonRail, { exchange, seconds: 4 }));
  expect(after.match(/class="neon-rail-cursor"/g)).toHaveLength(1);
  expect(after).not.toContain('class="neon-rail-note perfect"');
});

it("colors successful taps while a missed target keeps its original appearance", () => {
  const exchange = createExchange(0, 0, .5);
  const draw = () => renderToStaticMarkup(createElement(NeonRail, { exchange, seconds: 2.5 }));
  const unplayed = draw();
  exchange.attack.notes[0]!.grade = "miss";
  expect(draw()).toBe(unplayed);
  exchange.attack.notes[0]!.grade = "perfect";
  exchange.attack.notes[1]!.grade = "good";
  expect(draw()).toContain('class="neon-rail-note perfect"');
  expect(draw()).toContain('class="neon-rail-note good"');
});
