import { createState } from "./state";
import { createDefaultTerrain } from "./terrain";
import { createSimulation } from "./simulation";
import { createRenderer } from "./renderer";

export function startShowcaseDemo(canvas: HTMLCanvasElement) {
  const course = createDefaultTerrain();
  const state = createState(canvas.width, course);
  const keys = new Set<string>();
  const pointer = { active: true, x: canvas.width / 2, y: canvas.height * .57 + 70 };
  const simulation = createSimulation(state, {
    initialPower: 100, powerDrain: 0, rareRate2: .001, rareRate3: .01,
    researchScale: 1, bossStart: 1500, bossInterval: 1500,
  }, { keys, pointer }, {
    width: canvas.width, height: canvas.height, horizontalBounds: () => [42, canvas.width - 42],
  }, { updateButtons() {}, onFinish() {} });
  const renderer = createRenderer(canvas, state, simulation, new URLSearchParams(), () => true);
  const restart = () => {
    simulation.reset(course, { startDepth: 700, hull: 3, bossProgress: 0, terrainPreview: false });
    simulation.startDive();
  };
  restart();
  let previous = performance.now();
  let frame = 0;
  const draw = (now: number) => {
    const elapsed = Math.min((now - previous) / 1000, .05);
    previous = now;
    if (state.elapsed > 40 || state.phase === "result") restart();
    pointer.x = canvas.width / 2 + Math.sin(state.elapsed * .45) * 180;
    state.invincible = 2;
    state.power = 100;
    simulation.ensureChunks();
    simulation.update(elapsed);
    renderer.draw();
    frame = requestAnimationFrame(draw);
  };
  frame = requestAnimationFrame(draw);
  return () => { cancelAnimationFrame(frame); renderer.dispose(); };
}
