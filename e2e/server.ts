/**
 * Starts everything the end-to-end tests need, in order:
 * a throwaway PostgreSQL, the real migrations, the seed catalogue, a
 * production build, and the production server on port 3100.
 * Playwright launches this and stops it when the run ends.
 */
import { execFileSync, spawn } from "node:child_process";
import { rmSync } from "node:fs";
import path from "node:path";
import EmbeddedPostgres from "embedded-postgres";

const PORT = 3100;
const env = {
  ...process.env,
  NODE_ENV: "production",
  NEXT_DIST_DIR: ".next-e2e",
  DATABASE_URL: "postgresql://postgres:postgres@localhost:54331/azzopardi_e2e",
  APP_URL: `http://localhost:${PORT}`,
  APP_SECRET: "e2e-only-secret-e2e-only-secret-e2e-only",
  SEED_ADMIN_EMAIL: "",
  SEED_ADMIN_PASSWORD: "",
  STRIPE_SECRET_KEY: "",
  STRIPE_WEBHOOK_SECRET: "",
  ANTHROPIC_API_KEY: "", // the browser tests never call a model
} as NodeJS.ProcessEnv;

async function main() {
  const databaseDir = path.resolve(".data/postgres-e2e");
  rmSync(databaseDir, { recursive: true, force: true });
  const pg = new EmbeddedPostgres({ databaseDir, user: "postgres", password: "postgres", port: 54331, persistent: false, onLog: () => {} });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase("azzopardi_e2e");

  const run = (command: string, args: string[]) => execFileSync(command, args, { env, stdio: "inherit" });
  run("npx", ["prisma", "migrate", "deploy"]);
  run("npx", ["tsx", "prisma/seed.ts"]);
  run("npx", ["next", "build"]);

  const server = spawn("npx", ["next", "start", "-p", String(PORT)], { env, stdio: "inherit" });
  const stop = async () => {
    server.kill();
    await pg.stop().catch(() => {});
    rmSync(databaseDir, { recursive: true, force: true });
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  server.on("exit", stop);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
