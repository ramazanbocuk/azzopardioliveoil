import { AppError } from "./errors";
import type { Db } from "./db";

/**
 * Fixed-window rate limit backed by PostgreSQL, so it holds across server
 * instances. One atomic statement: no read-then-write race.
 */
export async function hit(db: Db, key: string, limit: number, windowSeconds: number): Promise<number> {
  const rows = await db.$queryRaw<{ count: number }[]>`
    INSERT INTO "RateLimit" ("key", "count", "windowStart") VALUES (${key}, 1, now())
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE WHEN "RateLimit"."windowStart" < now() - make_interval(secs => ${windowSeconds})
                     THEN 1 ELSE "RateLimit"."count" + 1 END,
      "windowStart" = CASE WHEN "RateLimit"."windowStart" < now() - make_interval(secs => ${windowSeconds})
                           THEN now() ELSE "RateLimit"."windowStart" END
    RETURNING "count"`;
  return rows[0]?.count ?? limit + 1;
}

export async function enforce(db: Db, key: string, limit: number, windowSeconds: number): Promise<void> {
  if ((await hit(db, key, limit, windowSeconds)) > limit) {
    throw new AppError("RATE_LIMITED", "Too many attempts. Please wait a few minutes and try again.");
  }
}
