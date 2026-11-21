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

it.each([...GAME_CATALOG, MOCHI_BEAT])("$id uses the same positive numeric version for display and results", game => {
  expect(game.currentVersion).toMatch(/^[1-9]\d*$/);
  expect(game.currentVersion).toBe(String(versions[game.id as keyof typeof versions]));
  const markup = renderToStaticMarkup(createElement(GameVersion, { game }));
  expect(markup).toContain(`v${game.currentVersion}</small>`);
  expect(markup).toContain(`${game.title} バージョン ${game.currentVersion}`);
});

it("increments only the requested game and writes a newline", async () => {
  files.readFile.mockResolvedValue(JSON.stringify({ "buzz-barrier": 3, "dot-wave": 7 }));
  await expect(bumpGameVersion("versions.json", "dot-wave")).resolves.toBe(8);
  expect(files.writeFile).toHaveBeenCalledExactlyOnceWith("versions.json", '{\n  "buzz-barrier": 3,\n  "dot-wave": 8\n}\n');
});

it.each([0, -1, 1.5, "1", Number.MAX_SAFE_INTEGER])("rejects invalid or exhausted versions: %s", async version => {
  files.readFile.mockResolvedValue(JSON.stringify({ "dot-wave": version }));
  await expect(bumpGameVersion("versions.json", "dot-wave")).rejects.toThrow();
  expect(files.writeFile).not.toHaveBeenCalled();
});

it("rejects unknown game IDs without modifying the registry", async () => {
  files.readFile.mockResolvedValue(JSON.stringify(versions));
  await expect(bumpGameVersion("versions.json", "unknown-game")).rejects.toThrow();
  expect(files.writeFile).not.toHaveBeenCalled();
});
