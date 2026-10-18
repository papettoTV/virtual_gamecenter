import { describe, expect, it } from "vitest";
import { GAME_CATALOG } from "../src/domain/game";
import type { SharedResult } from "../src/domain/shared-result";
import { presentResult } from "../src/features/sharing/result-presenters";
import { renderResultImage } from "../src/worker/result-image";

function result(gameId: string): SharedResult {
  return { id: "12345678-1234-4234-8234-123456789abc", gameId, gameVersion: "test-1",
    playerName: "プレイヤー", createdAt: "2026-10-12T00:00:00Z", cleared: true,
    elapsedTimeMs: 125000, score: 12345,
    metrics: { maxLevel: 8, defeatedBossCount: 3, maxDepth: 1234, discoveredCount: 7,
      totalSpeciesCount: 21, mode: "versus", outcome: "win", turns: 12, remainingHp: 5 } };
}

function checksum(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

async function decode(png: Uint8Array): Promise<Uint8Array> {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const kinds: string[] = [];
  let compressed = new Uint8Array();
  let offset = 8;
  while (offset < png.length) {
    const length = view.getUint32(offset);
    const kind = new TextDecoder().decode(png.subarray(offset + 4, offset + 8));
    expect(view.getUint32(offset + 8 + length)).toBe(checksum(png.subarray(offset + 4, offset + 8 + length)));
    kinds.push(kind);
    if (kind === "IDAT") compressed = png.slice(offset + 8, offset + 8 + length);
    offset += length + 12;
  }
  expect(offset).toBe(png.length);
  expect(kinds).toEqual(["IHDR", "IDAT", "IEND"]);
  return new Uint8Array(await new Response(new Blob([compressed]).stream().pipeThrough(new DecompressionStream("deflate"))).arrayBuffer());
}

describe("result PNG", () => {
  it.each(GAME_CATALOG)("renders a deterministic, valid metric card for $id", async game => {
    const saved = result(game.id);
    const response = await renderResultImage(saved);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    const png = new Uint8Array(await response.arrayBuffer());
    expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    const view = new DataView(png.buffer);
    expect(view.getUint32(16)).toBe(1200);
    expect(view.getUint32(20)).toBe(630);
    expect([...png.subarray(24, 29)]).toEqual([8, 2, 0, 0, 0]);
    const pixels = await decode(png);
    const stride = 1200 * 3 + 1;
    expect(pixels.length).toBe(stride * 630);
    // Brand colors stay fixed even when a game's accent changes.
    const headerColors = new Set<string>();
    for (let y = 70; y < 111; y++) for (let x = 100; x < 450; x++) {
      const at = y * stride + 1 + x * 3;
      headerColors.add(Array.from(pixels.subarray(at, at + 3)).join(","));
    }
    expect(headerColors.has("41,217,255")).toBe(true);
    expect(headerColors.has("255,255,255")).toBe(true);
    for (let row = 0; row < 630; row++) expect(pixels[row * stride]).toBe(0);
    expect(new Uint8Array(await (await renderResultImage(saved)).arrayBuffer())).toEqual(png);
    for (const [top, height] of [[80, 28], [134, 49], [242, 49], [330, 35], [418, 35]]) {
      let ink = 0;
      for (let row = top!; row < top! + height!; row++) {
        for (let column = 100; column < 1100; column++) {
          if (pixels[row * stride + 1 + column * 3] !== 11) ink++;
        }
      }
      expect(ink).toBeGreaterThan(100);
    }
    expect(presentResult(saved).imageLines).toHaveLength(3);
  });

  it.each([
    ["graze-duel", { score: 98765 }],
    ["deep-sea-salvage", { metrics: { maxDepth: 9876, discoveredCount: 19 } }],
    ["dot-wave", { metrics: { mode: "solo", outcome: "draw", turns: 99, remainingHp: 1 } }],
  ] satisfies [string, Partial<SharedResult>][])("changes rendered pixels when %s metrics change", async (gameId, changes) => {
    const saved = result(gameId);
    const original = new Uint8Array(await (await renderResultImage(saved)).arrayBuffer());
    const changed = new Uint8Array(await (await renderResultImage({ ...saved, ...changes })).arrayBuffer());
    expect(await decode(changed)).not.toEqual(await decode(original));
  });

  it("uses the Latin domain title for salvage, not the Japanese presentation title", async () => {
    const saved = result("deep-sea-salvage");
    expect(presentResult(saved).title).toBe("深海サルベージ");
    const pixels = await decode(new Uint8Array(await (await renderResultImage(saved)).arrayBuffer()));
    const stride = 1200 * 3 + 1;
    const firstGlyph = Array.from({ length: 7 }, (_, row) => {
      let bits = 0;
      for (let column = 0; column < 5; column++) {
        if (pixels[(134 + row * 7) * stride + 1 + (100 + column * 7) * 3] === 240) bits |= 1 << (4 - column);
      }
      return bits;
    });
    expect(firstGlyph).toEqual([30, 17, 17, 17, 17, 17, 30]);
  });
});
