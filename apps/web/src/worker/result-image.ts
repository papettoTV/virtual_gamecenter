import { brandWordmarkRuns } from "../brand/wordmark-raster";
import { getGameDefinition } from "../domain/game";
import type { SharedResult } from "../domain/shared-result";
import { presentResult } from "../features/sharing/result-presenters";

const WIDTH = 1200;
const HEIGHT = 630;
type Color = readonly [number, number, number];

const FONT: Readonly<Record<string, readonly number[]>> = {
  A: [14, 17, 17, 31, 17, 17, 17], B: [30, 17, 17, 30, 17, 17, 30],
  C: [14, 17, 16, 16, 16, 17, 14], D: [30, 17, 17, 17, 17, 17, 30],
  E: [31, 16, 16, 30, 16, 16, 31], F: [31, 16, 16, 30, 16, 16, 16],
  G: [14, 17, 16, 23, 17, 17, 15], H: [17, 17, 17, 31, 17, 17, 17],
  I: [31, 4, 4, 4, 4, 4, 31], J: [7, 2, 2, 2, 18, 18, 12],
  K: [17, 18, 20, 24, 20, 18, 17], L: [16, 16, 16, 16, 16, 16, 31],
  M: [17, 27, 21, 21, 17, 17, 17], N: [17, 25, 21, 19, 17, 17, 17],
  O: [14, 17, 17, 17, 17, 17, 14], P: [30, 17, 17, 30, 16, 16, 16],
  Q: [14, 17, 17, 17, 21, 18, 13], R: [30, 17, 17, 30, 20, 18, 17],
  S: [15, 16, 16, 14, 1, 1, 30], T: [31, 4, 4, 4, 4, 4, 4],
  U: [17, 17, 17, 17, 17, 17, 14], V: [17, 17, 17, 17, 17, 10, 4],
  W: [17, 17, 17, 21, 21, 21, 10], X: [17, 17, 10, 4, 10, 17, 17],
  Y: [17, 17, 10, 4, 4, 4, 4], Z: [31, 1, 2, 4, 8, 16, 31],
  "0": [14, 17, 19, 21, 25, 17, 14], "1": [4, 12, 4, 4, 4, 4, 14],
  "2": [14, 17, 1, 2, 4, 8, 31], "3": [30, 1, 1, 14, 1, 1, 30],
  "4": [2, 6, 10, 18, 31, 2, 2], "5": [31, 16, 16, 30, 1, 1, 30],
  "6": [14, 16, 16, 30, 17, 17, 14], "7": [31, 1, 2, 4, 8, 8, 8],
  "8": [14, 17, 17, 14, 17, 17, 14], "9": [14, 17, 17, 15, 1, 1, 14],
  " ": [0, 0, 0, 0, 0, 0, 0], ":": [0, 4, 4, 0, 4, 4, 0],
  "/": [1, 2, 2, 4, 8, 8, 16], ",": [0, 0, 0, 0, 0, 4, 8],
  ".": [0, 0, 0, 0, 0, 0, 4], "-": [0, 0, 0, 31, 0, 0, 0],
  "%": [25, 25, 2, 4, 8, 19, 19], "+": [0, 4, 4, 31, 4, 4, 0],
  "?": [14, 17, 1, 2, 4, 0, 4], "!": [4, 4, 4, 4, 4, 0, 4],
};

function pngChunk(kind: string, data: Uint8Array): Uint8Array {
  const chunk = new Uint8Array(data.length + 12);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, data.length);
  chunk.set(new TextEncoder().encode(kind), 4);
  chunk.set(data, 8);
  let crc = 0xffffffff;
  for (const byte of chunk.subarray(4, data.length + 8)) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  view.setUint32(data.length + 8, (crc ^ 0xffffffff) >>> 0);
  return chunk;
}

export async function renderResultImage(result: SharedResult): Promise<Response> {
  const presentation = presentResult(result);
  const title = getGameDefinition(result.gameId)?.title ?? result.gameId;
  return renderCard(title, presentation.imageLines, presentation.accent);
}

export async function renderLiveImage(gameId: string): Promise<Response> {
  const game = getGameDefinition(gameId);
  return renderCard(game?.title ?? "PULBASE", ["LIVE WATCH", "JOIN THE AUDIENCE", "GAME CENTER ONLINE"], "#69f7ff");
}

async function renderCard(title: string, imageLines: string[], accentHex: string): Promise<Response> {
  const accent: Color = /^#[0-9a-f]{6}$/i.test(accentHex)
    ? [parseInt(accentHex.slice(1, 3), 16), parseInt(accentHex.slice(3, 5), 16), parseInt(accentHex.slice(5, 7), 16)]
    : [105, 247, 255];
  const stride = WIDTH * 3 + 1;
  const pixels = new Uint8Array(stride * HEIGHT);
  function rectangle(left: number, top: number, width: number, height: number, color: Color): void {
    for (let row = Math.max(0, top); row < Math.min(HEIGHT, top + height); row++) {
      for (let column = Math.max(0, left); column < Math.min(WIDTH, left + width); column++) {
        const offset = row * stride + 1 + column * 3;
        pixels[offset] = color[0];
        pixels[offset + 1] = color[1];
        pixels[offset + 2] = color[2];
      }
    }
  }
  function text(value: string, left: number, top: number, preferredScale: number, color: Color): void {
    const label = value.toUpperCase().slice(0, 80);
    const scale = Math.max(1, Math.min(preferredScale, Math.floor(1000 / Math.max(1, label.length * 6 - 1))));
    for (let index = 0; index < label.length; index++) {
      const glyph = FONT[label[index]!] ?? FONT["?"]!;
      for (let row = 0; row < 7; row++) {
        for (let column = 0; column < 5; column++) {
          if (glyph[row]! & (1 << (4 - column))) {
            rectangle(left + (index * 6 + column) * scale, top + row * scale, scale, scale, color);
          }
        }
      }
    }
  }

  rectangle(0, 0, WIDTH, HEIGHT, [7, 10, 24]);
  for (let gridX = 0; gridX < WIDTH; gridX += 60) rectangle(gridX, 0, 1, HEIGHT, [14, 22, 39]);
  for (let gridY = 0; gridY < HEIGHT; gridY += 60) rectangle(0, gridY, WIDTH, 1, [14, 22, 39]);
  rectangle(56, 44, 1088, 542, [20, 39, 53]);
  rectangle(60, 48, 1080, 534, [11, 17, 33]);
  rectangle(60, 48, 8, 534, accent);
  rectangle(96, 202, 1008, 3, accent);
  for (const [x, y, width, r, g, b, a] of brandWordmarkRuns) {
    const alpha = a! / 255;
    for (let dx = 0; dx < width!; dx++) {
      const offset = (70 + y!) * stride + 1 + (100 + x! + dx) * 3;
      for (const [channel, value] of [r!, g!, b!].entries()) {
        pixels[offset + channel] = Math.round(value * alpha + pixels[offset + channel]! * (1 - alpha));
      }
    }
  }
  text(title, 100, 134, 7, [240, 246, 255]);
  imageLines.slice(0, 3).forEach((line, index) => {
    text(line, 100, 242 + index * 88, index === 0 ? 7 : 5, index === 0 ? accent : [240, 246, 255]);
  });
  text("PLAY / SHARE / CHALLENGE", 100, 532, 3, [128, 152, 181]);

  const header = new Uint8Array(13);
  const headerView = new DataView(header.buffer);
  headerView.setUint32(0, WIDTH);
  headerView.setUint32(4, HEIGHT);
  header[8] = 8;
  header[9] = 2;
  const compression = new CompressionStream("deflate");
  const compressed = new Response(compression.readable).arrayBuffer();
  const writer = compression.writable.getWriter();
  await writer.write(pixels);
  await writer.close();
  const chunks = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", header), pngChunk("IDAT", new Uint8Array(await compressed)), pngChunk("IEND", new Uint8Array())];
  const png = new Uint8Array(chunks.reduce((length, chunk) => length + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) { png.set(chunk, offset); offset += chunk.length; }
  return new Response(png, { headers: {
    "Content-Type": "image/png",
    "Cache-Control": "public, max-age=86400",
    "X-Content-Type-Options": "nosniff",
  } });
}
