import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import path from "node:path";
import EmbeddedPostgres from "embedded-postgres";
import { TEST_DATABASE_URL } from "./testDb";

/**
 * Starts a throwaway PostgreSQL server for the test run, applies the real
 * migrations to it, and removes it afterwards. Tests never touch the
 * development database.
 */
export default async function setup() {
  const databaseDir = path.resolve(".data/postgres-test");
  rmSync(databaseDir, { recursive: true, force: true });

  const pg = new EmbeddedPostgres({ databaseDir, user: "postgres", password: "postgres", port: 54330, persistent: false, onLog: () => {} });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase("azzopardi_test");

  execFileSync("npx", ["prisma", "migrate", "deploy"], { env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL }, stdio: "pipe" });

  return async () => {
    await pg.stop();
    rmSync(databaseDir, { recursive: true, force: true });
  };
}
