import { env, exports } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { afterEach, beforeAll, expect, it } from "vitest";
import { CabinetRoom } from "../../src/worker/cabinet-room";
import { hashIdentifier } from "../../src/worker/identity-hash";
import { migrateTestDatabase } from "../migrate-test-database";

beforeAll(migrateTestDatabase);
const sockets: WebSocket[] = [];
afterEach(() => { for (const socket of sockets.splice(0)) socket.close(); });

it.each(["graze-duel", "dot-wave", "deep-sea-salvage"].flatMap(gameId =>
  ["before-accept", "during-check", "check-failure"].map(scenario => ({ gameId, scenario })),
))("closes $gameId handshake on $scenario without sending state", async ({ gameId, scenario }) => {
  const bootstrap = await exports.default.fetch("http://localhost/api/platform/bootstrap");
  const { playerId } = await bootstrap.json<{ playerId: string }>();
  const cookie = bootstrap.headers.get("set-cookie")!.split(";", 1)[0]!;
  const sessionHash = await hashIdentifier(cookie.split("=")[1]!);
  const cabinet = crypto.randomUUID();
  const room = env.CABINET_ROOMS.getByName(cabinet);
  await runInDurableObject(room, instance => {
    const originalEnvironment = Reflect.get(instance, "env") as Env;
    const database = originalEnvironment.DB;
    const proxy = new Proxy(database, {
      get(target, key) {
        if (key !== "prepare") return Reflect.get(target, key, target);
        return (query: string) => {
          const statement = database.prepare(query);
          if (query.startsWith("SELECT 1 AS active FROM player_sessions")) {
            return {
              bind: (...values: unknown[]) => ({
                first: async () => {
                  if (scenario === "check-failure") throw Error("database unavailable");
                  const result = await statement.bind(...values).first();
                  if (scenario === "during-check") {
                    await database.prepare("DELETE FROM player_sessions WHERE token_hash = ?").bind(sessionHash).run();
                    await instance.revokeSession(playerId, sessionHash);
                  }
                  return result;
                },
              }),
            };
          }
          if (!query.startsWith("INSERT INTO player_cabinets")) return statement;
          return {
            bind: (...values: unknown[]) => ({
              run: async () => {
                const result = await statement.bind(...values).run();
                if (scenario === "before-accept") {
                  await database.prepare("DELETE FROM player_sessions WHERE token_hash = ?").bind(sessionHash).run();
                  await instance.revokeSession(playerId, sessionHash);
                }
                return result;
              },
            }),
          };
        };
      },
    });
    Reflect.set(instance, "env", { ...originalEnvironment, DB: proxy });
  });
  const response = await room.fetch(new Request(`http://localhost/api/cabinets/${cabinet}/ws?gameId=${gameId}`, {
    headers: { Upgrade: "websocket", Cookie: cookie },
  }));
  expect(response.status).toBe(101);
  const socket = response.webSocket!;
  socket.accept(); sockets.push(socket);
  const messages: string[] = [];
  socket.addEventListener("message", event => messages.push(String(event.data)));
  const code = await new Promise<number>((resolve, reject) => {
    const timer = setTimeout(() => reject(Error("Revoked handshake stayed open")), 3000);
    socket.addEventListener("close", event => { clearTimeout(timer); resolve(event.code); }, { once: true });
  });
  expect(code).toBe(1008);
  expect(messages).toEqual([]);
});

it.each(["leave", "releaseAdmission"])("revokes and closes all matching sockets even when %s fails", async failingStep => {
  const attachments = [0, 1].map(index => ({ clientId: String(index), admissionId: `admission-${index}`, playerId: "player", sessionHash: "session", role: "player", revoked: false }));
  const closed: number[] = [];
  const released: number[] = [];
  const connections = attachments.map((_, index) => ({
    deserializeAttachment: () => attachments[index],
    serializeAttachment: (attachment: typeof attachments[number]) => { attachments[index] = attachment; },
    close: (code: number) => { expect(code).toBe(1008); closed.push(index); },
  }));
  const room = {
    ready: Promise.resolve(),
    ctx: { getWebSockets: () => connections },
    attachment: (socket: typeof connections[number]) => socket.deserializeAttachment(),
    disconnectRevokedSocket: Reflect.get(CabinetRoom.prototype, "disconnectRevokedSocket"),
    soloRun: { playerId: "player" },
    leave: async (socket: typeof connections[number]) => {
      expect(socket.deserializeAttachment()?.revoked).toBe(true);
      if (failingStep === "leave") throw Error("cleanup unavailable");
    },
    releaseAdmission: async (socket: typeof connections[number]) => {
      released.push(connections.indexOf(socket));
      if (failingStep === "releaseAdmission") throw Error("release unavailable");
    },
  };
  await expect(Reflect.apply(CabinetRoom.prototype.revokeSession, room, ["player", "session"])).rejects.toThrow("unavailable");
  expect(closed.sort()).toEqual([0, 1]);
  expect(released.sort()).toEqual([0, 1]);
  expect(attachments.every(attachment => attachment.revoked)).toBe(true);
  expect(attachments.map(attachment => attachment.admissionId)).toEqual(["admission-0", "admission-1"]);
  expect(room.soloRun).toBeNull();
});
