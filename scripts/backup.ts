/**
 * Logical backup and restore of the whole database, with no tools to install.
 *
 *   npm run db:backup                     writes backups/azzopardi-<timestamp>.json.gz
 *   npm run db:restore -- <file>          restores into an EMPTY, migrated database
 *   npm run db:restore -- <file> --force  empties the database first, then restores
 *
 * PostgreSQL itself serialises and parses every row, so dates, arrays, JSON
 * and enums round-trip exactly. A backup file contains customers' personal
 * data: store it encrypted, restrict access, and never commit it.
 *
 * This complements, and does not replace, the database host's own automatic
 * backups and point-in-time recovery. See docs/backup-recovery.md.
 */
import "dotenv/config";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync, gzipSync } from "node:zlib";
import pg from "pg";

type Backup = { version: 1; createdAt: string; migrations: string[]; tables: Record<string, unknown[]> };

async function connect(connectionString: string) {
  const client = new pg.Client({ connectionString });
  await client.connect();
  return client;
}

async function tableNames(client: pg.Client): Promise<string[]> {
  const result = await client.query<{ tablename: string }>(`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations' ORDER BY tablename`);
  return result.rows.map((row) => row.tablename);
}

/** Parents before children, so foreign keys are satisfied as rows go in. */
async function insertOrder(client: pg.Client, tables: string[]): Promise<string[]> {
  const result = await client.query<{ child: string; parent: string }>(`
    SELECT child.relname AS child, parent.relname AS parent
    FROM pg_constraint c JOIN pg_class child ON child.oid = c.conrelid JOIN pg_class parent ON parent.oid = c.confrelid
    WHERE c.contype = 'f' AND c.connamespace = 'public'::regnamespace AND child.oid <> parent.oid`);
  const pending = new Map(tables.map((table) => [table, new Set(result.rows.filter((row) => row.child === table).map((row) => row.parent))]));
  const ordered: string[] = [];
  while (pending.size > 0) {
    const ready = [...pending].filter(([, parents]) => [...parents].every((parent) => ordered.includes(parent) || !pending.has(parent))).map(([table]) => table);
    if (ready.length === 0) throw new Error("Circular foreign keys: cannot determine restore order.");
    for (const table of ready.sort()) {
      ordered.push(table);
      pending.delete(table);
    }
  }
  return ordered;
}

export async function createBackup(connectionString: string): Promise<Backup> {
  const client = await connect(connectionString);
  try {
    // One snapshot for every table, so the backup is consistent even while the shop is taking orders.
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const tables: Backup["tables"] = {};
    for (const table of await tableNames(client)) {
      const rows = await client.query<{ rows: unknown[] }>(`SELECT COALESCE(json_agg(t), '[]'::json) AS rows FROM "${table}" t`);
      tables[table] = rows.rows[0].rows;
    }
    const migrations = await client.query<{ migration_name: string }>(`SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY migration_name`);
    await client.query("COMMIT");
    return { version: 1, createdAt: new Date().toISOString(), migrations: migrations.rows.map((row) => row.migration_name), tables };
  } finally {
    await client.end();
  }
}

export async function restoreBackup(connectionString: string, backup: Backup, options: { force?: boolean } = {}): Promise<Record<string, number>> {
  const client = await connect(connectionString);
  try {
    const existing = await tableNames(client);
    const applied = (await client.query<{ migration_name: string }>(`SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY migration_name`)).rows.map((row) => row.migration_name);
    if (JSON.stringify(applied) !== JSON.stringify(backup.migrations)) {
      throw new Error(`The database schema does not match the backup. Backup was taken at migration "${backup.migrations.at(-1)}", database is at "${applied.at(-1)}". Check out the matching code version and run "npm run db:deploy" first.`);
    }

    await client.query("BEGIN");
    if (options.force) {
      await client.query(`TRUNCATE ${existing.map((table) => `"${table}"`).join(", ")} RESTART IDENTITY CASCADE`);
    } else {
      for (const table of existing) {
        const count = await client.query<{ n: string }>(`SELECT COUNT(*) AS n FROM "${table}"`);
        if (count.rows[0].n !== "0") throw new Error(`Table "${table}" is not empty. Restore into an empty database, or pass --force to erase it first.`);
      }
    }

    const restored: Record<string, number> = {};
    for (const table of await insertOrder(client, existing)) {
      const rows = backup.tables[table] ?? [];
      if (rows.length > 0) await client.query(`INSERT INTO "${table}" SELECT * FROM json_populate_recordset(NULL::"${table}", $1::json)`, [JSON.stringify(rows)]);
      restored[table] = rows.length;
    }

    // Auto-incrementing columns (order numbers) must continue after the highest restored value.
    const serials = await client.query<{ table_name: string; column_name: string }>(`SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public' AND column_default LIKE 'nextval(%'`);
    for (const { table_name, column_name } of serials.rows) {
      await client.query(`SELECT setval(pg_get_serial_sequence('"${table_name}"', '${column_name}'), GREATEST((SELECT COALESCE(MAX("${column_name}"), 0) FROM "${table_name}"), 1), (SELECT COUNT(*) > 0 FROM "${table_name}"))`);
    }
    await client.query("COMMIT");
    return restored;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set.");

  if (command === "backup") {
    const backup = await createBackup(url);
    const file = rest[0] ?? path.join("backups", `azzopardi-${backup.createdAt.replace(/[:.]/g, "-")}.json.gz`);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, gzipSync(JSON.stringify(backup)));
    chmodSync(file, 0o600);
    const rows = Object.values(backup.tables).reduce((sum, table) => sum + table.length, 0);
    console.log(`Backup written to ${file} (${rows} rows in ${Object.keys(backup.tables).length} tables). It contains personal data: store it encrypted.`);
  } else if (command === "restore" && rest[0]) {
    const backup = JSON.parse(gunzipSync(readFileSync(rest[0])).toString()) as Backup;
    const restored = await restoreBackup(url, backup, { force: rest.includes("--force") });
    console.log(`Restored backup from ${backup.createdAt}: ${Object.values(restored).reduce((a, b) => a + b, 0)} rows.`);
  } else {
    console.log("Usage: tsx scripts/backup.ts backup [file] | restore <file> [--force]");
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
