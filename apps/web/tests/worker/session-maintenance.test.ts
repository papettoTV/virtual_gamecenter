import { env, exports } from "cloudflare:workers";
import { beforeAll, expect, it } from "vitest";
import { activateSessionSweeps } from "../../src/worker/session-maintenance";
import { migrateTestDatabase } from "../migrate-test-database";

beforeAll(migrateTestDatabase);

it("activates old rooms in bounded, repeatable pages without skipping failed batches", async () => {
  const player = crypto.randomUUID();
  const prefix = `zz-idle-${crypto.randomUUID()}-`;
  await env.DB.prepare("INSERT INTO players (id, guest_name) VALUES (?, 'Activation test')").bind(player).run();
  for (let index = 0; index < 51; index += 1) await env.DB.prepare("INSERT INTO player_cabinets (player_id, cabinet_id) VALUES (?, ?)").bind(player, `${prefix}${String(index).padStart(2, "0")}`).run();
  const visited: string[] = [];
  const rooms = { getByName: (name: string) => ({ activateSessionSweep: async () => { visited.push(name); } }) };
  const first = await activateSessionSweeps(env.DB, rooms, prefix);
  expect(first.visited).toBe(50);
  expect(first.next).toBe(`${prefix}49`);
  expect((await activateSessionSweeps(env.DB, rooms, first.next!)).next).toBeNull();
  expect(new Set(visited).size).toBe(51);
  await expect(activateSessionSweeps(env.DB, { getByName: () => ({ activateSessionSweep: async () => { throw Error("private failure"); } }) }, prefix)).rejects.toThrow("sweep_activation_incomplete");
});

it("rejects malformed cursors and disallows maintenance outside staging", async () => {
  for (const cursor of ["' OR 1=1", "a".repeat(129), "cabinet/name"]) await expect(activateSessionSweeps(env.DB, env.CABINET_ROOMS, cursor)).rejects.toThrow("invalid_sweep_cursor");
  expect(await exports.SessionMaintenance.activate()).toMatchObject({ error: "staging_maintenance_only" });
});
