import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import { GAME_CATALOG, MOCHI_BEAT } from "../src/domain/game";
import versions from "../src/domain/game-versions.json";
import { GameVersion } from "../src/features/game/GameVersion";
import { bumpGameVersion } from "../scripts/bump-game-version.mjs";

const files = vi.hoisted(() => ({ readFile: vi.fn(), writeFile: vi.fn() }));
vi.mock("node:fs/promises", () => files);
afterEach(() => vi.clearAllMocks());

it.each([...GAME_CATALOG, MOCHI_BEAT])("$id uses the same three-part version for display and results", game => {
  expect(game.currentVersion).toMatch(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/);
  expect(game.currentVersion).toBe(String(versions[game.id as keyof typeof versions]));
  const markup = renderToStaticMarkup(createElement(GameVersion, { game }));
  expect(markup).toContain(`v${game.currentVersion}</small>`);
  expect(markup).toContain(`${game.title} バージョン ${game.currentVersion}`);
});

it.each([["major", "2.0.0"], ["minor", "1.3.0"], ["patch", "1.2.4"]])("increments %s and resets lower segments", async (change, expected) => {
  files.readFile.mockResolvedValue(JSON.stringify({ "buzz-barrier": "3.4.5", "dot-wave": "1.2.3" }));
  await expect(bumpGameVersion("versions.json", "dot-wave", change)).resolves.toBe(expected);
  expect(files.writeFile).toHaveBeenCalledExactlyOnceWith("versions.json", JSON.stringify({ "buzz-barrier": "3.4.5", "dot-wave": expected }, null, 2) + "\n");
});

it.each([0, -1, 1.5, "1", "01.2.3", "1.02.3", "1.2.03", "v1.0.0", "1.2.3-beta", "1.2.3.4", "1.0.9007199254740991"])("rejects invalid or exhausted versions: %s", async version => {
  files.readFile.mockResolvedValue(JSON.stringify({ "dot-wave": version }));
  await expect(bumpGameVersion("versions.json", "dot-wave", "patch")).rejects.toThrow();
  expect(files.writeFile).not.toHaveBeenCalled();
});

it("rejects unknown game IDs without modifying the registry", async () => {
  files.readFile.mockResolvedValue(JSON.stringify(versions));
  await expect(bumpGameVersion("versions.json", "unknown-game", "patch")).rejects.toThrow();
  expect(files.writeFile).not.toHaveBeenCalled();
});

it.each([undefined, "", "auto", "PATCH"])("requires an explicit supported change type: %s", async change => {
  await expect(bumpGameVersion("versions.json", "dot-wave", change)).rejects.toThrow();
  expect(files.writeFile).not.toHaveBeenCalled();
});
