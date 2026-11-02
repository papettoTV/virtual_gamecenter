import { createElement, useRef } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, expect, it } from "vitest";
import { useMobilePlay } from "../src/features/game/use-mobile-play";
import { setLiveContext } from "../src/features/sharing/share-service";

function Presentation() {
  const screen = useRef<HTMLElement>(null);
  const play = useMobilePlay(screen);
  return createElement("section", {
    "data-active": play.active,
    "data-available": play.available,
  });
}

afterEach(() => setLiveContext(null));

it.each([null, "playing", "paused"] as const)(
  "renders the regular presentation on the server with live phase %s",
  phase => {
    setLiveContext(phase === null ? null : {
      gameId: "graze-duel", cabinetId: "ssr-test", role: "player", phase,
    });
    expect(renderToString(createElement(Presentation))).toBe(
      '<section data-active="false" data-available="false"></section>',
    );
  },
);
