import { expect, it } from "vitest";
import { availableGameModes, isGameModeAvailable, isSoloOrSpectatorCommand } from "../../src/domain/play-mode-policy";

it.each([undefined, "", "staging", "production", "unknown"])("fails closed outside explicit local development: %s", APP_ENV => {
  for (const LOCAL_MULTIPLAYER_ENABLED of [undefined, "false", "true"]) {
    expect(availableGameModes({ APP_ENV, LOCAL_MULTIPLAYER_ENABLED })).toEqual(["solo"]);
  }
});

it("does not allow unknown future commands through the public WebSocket policy", () => {
  expect(isSoloOrSpectatorCommand("newMultiplayerMode")).toBe(false);
  expect(isSoloOrSpectatorCommand("requestChallenge")).toBe(false);
  expect(isSoloOrSpectatorCommand("startSolo")).toBe(true);
  expect(isSoloOrSpectatorCommand("cancelChallenge")).toBe(true);
});

it("allows future versus regression only with the explicit local setting, never coop", () => {
  expect(availableGameModes()).toEqual(["solo"]);
  expect(availableGameModes({ APP_ENV: "local" })).toEqual(["solo"]);
  expect(availableGameModes({ APP_ENV: "local", LOCAL_MULTIPLAYER_ENABLED: "true" })).toEqual(["solo", "versus"]);
  expect(isGameModeAvailable("coop", { APP_ENV: "local", LOCAL_MULTIPLAYER_ENABLED: "true" })).toBe(false);
  expect(isGameModeAvailable("unknown")).toBe(false);
});
