import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const selection = process.argv[2] ?? "u";
assert(["j", "u"].includes(selection), "Choose j or u");
const sourcePath = selection === "u" ? "round5/samples/02-soft.wav" : "round3/samples/02-wet.wav";
const source = await readFile(new URL(`../../../deliverables/buzz-graze-audio-options/${sourcePath}`, import.meta.url));
assert.equal(source.toString("ascii", 0, 4), "RIFF");
assert.equal(source.toString("ascii", 8, 12), "WAVE");
assert.equal(source.readUInt16LE(20), 1);
assert.equal(source.readUInt16LE(22), 1);
assert.equal(source.readUInt32LE(24), 48000);
assert.equal(source.readUInt16LE(34), 16);
const start = Math.round(0.15 * 48000);
const duration = selection === "u" ? 0.4 : 0.32;
const length = Math.round(duration * 48000);
const output = Buffer.alloc(44 + length * 2);
source.copy(output, 0, 0, 44);
source.copy(output, 44, 44 + start * 2, 44 + (start + length) * 2);
output.writeUInt32LE(output.length - 8, 4);
output.writeUInt32LE(output.length - 44, 40);
let peak = 0, tailPeak = 0;
for (let index = 44; index < output.length; index += 2) {
  const amplitude = Math.abs(output.readInt16LE(index) / 32768);
  peak = Math.max(peak, amplitude);
  if (index >= output.length - 48000 * 0.03 * 2) tailPeak = Math.max(tailPeak, amplitude);
}
assert(peak > 0.005 && peak <= 0.061);
assert(tailPeak < 0.001);
const target = new URL(`../src/games/graze-duel/assets/graze-${selection}.wav`, import.meta.url);
await mkdir(new URL(".", target), { recursive: true });
await writeFile(target, output);
console.log(`${selection.toUpperCase()} one-shot: ${duration}s, peak ${peak.toFixed(4)}, tail ${tailPeak.toFixed(6)}`);
