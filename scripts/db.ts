/**
 * Local development database: a real PostgreSQL server bundled as an npm
 * package, so the project runs without installing Postgres or Docker.
 * Data lives in .data/postgres. Not for production — use a managed database.
 *
 *   npm run db:start   start and keep running (Ctrl+C to stop)
 */
import EmbeddedPostgres from "embedded-postgres";
import { existsSync } from "node:fs";
import path from "node:path";

const dataDir = path.resolve(".data/postgres");
const port = Number(process.env.LOCAL_DB_PORT ?? 54329);

async function main() {
  const pg = new EmbeddedPostgres({ databaseDir: dataDir, user: "postgres", password: "postgres", port, persistent: true });
  const fresh = !existsSync(path.join(dataDir, "PG_VERSION"));
  if (fresh) await pg.initialise();
  await pg.start();
  if (fresh) await pg.createDatabase("azzopardi");
  console.log(`\nLocal PostgreSQL ready on port ${port} (database "azzopardi"). Ctrl+C to stop.\n`);

  const stop = async () => {
    await pg.stop();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
