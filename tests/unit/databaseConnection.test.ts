import { describe, expect, it } from "vitest";
import { databaseConnection } from "@/server/environment";

const DIRECT = "postgresql://user@db.example/shop";
const POOLED = "postgresql://user@pooler.example/shop";

describe("database connection", () => {
  it("uses the one address there is, with the usual pool, on a developer's machine", () => {
    expect(databaseConnection({ DATABASE_URL: DIRECT })).toEqual({ connectionString: DIRECT, max: 10, pooled: false });
  });

  it("prefers the pooled address when the host gives one", () => {
    expect(databaseConnection({ DATABASE_URL: DIRECT, DATABASE_URL_POOLED: POOLED, VERCEL: "1" })).toEqual({ connectionString: POOLED, max: 5, pooled: true });
  });

  it("ignores a pooled address that is not a PostgreSQL address", () => {
    expect(databaseConnection({ DATABASE_URL: DIRECT, DATABASE_URL_POOLED: "prisma+postgres://accelerate.example/?api_key=x" }).connectionString).toBe(DIRECT);
    expect(databaseConnection({ DATABASE_URL: DIRECT, DATABASE_URL_POOLED: "  " }).connectionString).toBe(DIRECT);
  });

  it("holds few direct connections on a host that runs many copies", () => {
    expect(databaseConnection({ DATABASE_URL: DIRECT, VERCEL: "1" }).max).toBe(2);
  });

  it("lets the owner set the number, and ignores nonsense", () => {
    expect(databaseConnection({ DATABASE_URL: DIRECT, DATABASE_POOL_MAX: "3" }).max).toBe(3);
    expect(databaseConnection({ DATABASE_URL: DIRECT, DATABASE_POOL_MAX: "many" }).max).toBe(10);
    expect(databaseConnection({ DATABASE_URL: DIRECT, DATABASE_POOL_MAX: "0" }).max).toBe(10);
  });
});
