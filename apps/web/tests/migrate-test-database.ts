import { env } from "cloudflare:workers";

const migrations = import.meta.glob<string>("../migrations/*.sql", { eager: true, query: "?raw", import: "default" });

export async function migrateTestDatabase(): Promise<void> {
  await migrateTestDatabaseWithHook();
}

export async function migrateTestDatabaseWithHook(beforeMigration?: (path: string) => Promise<void>): Promise<void> {
  for (const path of Object.keys(migrations).sort()) {
    await beforeMigration?.(path);
    const sql = migrations[path]!.replace(/^--.*$/gm, "");
    await env.DB.batch(sql.split(/;\s*(?=(?:CREATE|ALTER|UPDATE|INSERT|DELETE|DROP)\b)/)
      .filter(statement => statement.trim()).map(statement => env.DB.prepare(statement)));
  }
}
