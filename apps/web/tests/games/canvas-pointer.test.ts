import { afterEach, expect, it, vi } from 'vitest';
import { updateCanvasPointer } from '../../src/games/deep-sea-salvage/canvas-pointer';

afterEach(() => vi.unstubAllGlobals());

it.each(['contain', 'cover', 'fill'])('maps the rendered image with %s before and after rotation', objectFit => {
  vi.stubGlobal('getComputedStyle', () => ({ objectFit, borderLeftWidth: '2px', borderTopWidth: '2px' }));
  for (const [width, height] of [[374, 700], [828, 270]] as const) {
    const canvas = { width: 960, height: 640, clientWidth: width, clientHeight: height,
      getBoundingClientRect: () => ({ left: 8, top: 12 }) } as HTMLCanvasElement;
    const scale = (objectFit === 'contain' ? Math.min : Math.max)(width / 960, height / 640);
    const imageWidth = objectFit === 'fill' ? width : 960 * scale;
    const imageHeight = objectFit === 'fill' ? height : 640 * scale;
    const pointer = { active: false, x: 0, y: 0 };
    updateCanvasPointer(canvas, pointer, {
      clientX: 10 + (width - imageWidth) / 2 + imageWidth * .6,
      clientY: 14 + (height - imageHeight) / 2 + imageHeight * .7,
    }, true);
    expect(pointer.active).toBe(true);
    expect(pointer.x).toBeCloseTo(576);
    expect(pointer.y).toBeCloseTo(448);
    if (objectFit === 'contain') {
      updateCanvasPointer(canvas, pointer, { clientX: 10, clientY: 14 }, true);
      expect(pointer.active).toBe(false);
    }
  }
});
