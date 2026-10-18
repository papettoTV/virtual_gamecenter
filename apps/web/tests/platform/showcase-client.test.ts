import { afterEach, describe, expect, it, vi } from "vitest";
import { createCabinetClient } from "../../src/realtime/cabinet-client";

afterEach(() => vi.unstubAllGlobals());

describe("showcase spectator connection", () => {
  for (const [explicitWatch, framed] of [[false, true], [true, true], [false, false]] as const) {
    it(`never takes the player seat when watch=${explicitWatch}, framed=${framed}`, () => {
      const handlers = new Map<string, () => void>();
      const sent: string[] = [];
      class Socket {
        static OPEN = 1;
        readyState = 0;
        addEventListener(name: string, handler: () => void) { handlers.set(name, handler); }
        send(message: string) { sent.push(message); }
        close() {}
      }
      let socket: Socket;
      const Factory = class extends Socket {
        constructor() { super(); socket = this; }
      };
      vi.stubGlobal("WebSocket", Factory);
      const frame = {};
      vi.stubGlobal("window", {
        self: frame, top: framed ? {} : frame,
        location: { protocol: "https:", host: "example.com", search: framed ? "?watch=1&preview=1" : "?watch=1" },
      });
      const client = createCabinetClient();
      client.join("room", "graze-duel", explicitWatch);
      socket!.readyState = 1;
      handlers.get("open")?.();
      expect(sent.map(message => JSON.parse(message))).toContainEqual({ type: "joinCabinet", gameId: "graze-duel", watch: true });
      client.leave();
    });
  }
});
