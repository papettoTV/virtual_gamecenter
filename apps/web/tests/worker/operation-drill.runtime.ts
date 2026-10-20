import { env, exports } from "cloudflare:workers";
import { beforeAll, expect, it } from "vitest";
import { migrateTestDatabase } from "../migrate-test-database";
import { assertOperationDrill, type OperationOperator } from "../../src/recovery/operation-drill";

const operator = Reflect.get(exports, "OperationOperator") as Service<OperationOperator>;

beforeAll(async () => {
  await migrateTestDatabase();
  await env.DB.prepare("CREATE TABLE revocation_drill_cabinets (cabinet_id TEXT PRIMARY KEY, game_id TEXT)").run();
});

it("has no public HTTP entry and never permits local/production or a missing drill guard", async () => {
  expect((await exports.default.fetch("http://localhost/")).status).toBe(404);
  for (const APP_ENV of ["local", "production", undefined]) expect(() => assertOperationDrill({ APP_ENV, REVOCATION_DRILL: "synthetic-only-v1", OPERATION_DRILL: "synthetic-only-v1" })).toThrow();
  expect(() => assertOperationDrill({ APP_ENV: "staging" })).toThrow();
});

it.each(["start", "credit"] as const)("executes real %s failure and recovered boundaries with a bounded repeat guard", async family => {
  const failed = await operator.exercise(family, "fail");
  expect(failed).toMatchObject({ processed: 3, mode: "fail", loadTest: false });
  await expect(Promise.resolve(operator.exercise(family, "fail"))).rejects.toThrow("operation_drill_already_attempted_today");
  expect(await operator.exercise(family, "recover")).toMatchObject({ processed: 13, mode: "recover" });
}, 30000);

it("records valid-state provider errors without making external Google calls", async () => {
  expect(await operator.exercise("login", "fail")).toMatchObject({ processed: 3 });
  await expect(Promise.resolve(operator.exercise("login", "recover"))).rejects.toThrow("operation_drill_input");
});

it("refuses to exercise a database containing a non-synthetic registered identity", async () => {
  await env.DB.batch([
    env.DB.prepare("INSERT INTO accounts (id, display_name) VALUES ('unexpected-account', 'Not synthetic')"),
    env.DB.prepare("INSERT INTO account_identities (provider, provider_subject, account_id) VALUES ('google', 'unexpected-subject', 'unexpected-account')"),
  ]);
  await expect(Promise.resolve(operator.exercise("start", "fail"))).rejects.toThrow("operation_drill_non_synthetic_database");
});
