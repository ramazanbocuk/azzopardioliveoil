import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "@/generated/prisma/client";
import { databaseConnection } from "./environment";

/**
 * One Prisma client per process. In development the instance is parked on
 * globalThis so hot reloads do not open a new connection pool each time.
 *
 * A parked client knows only the tables that existed when it was made. After
 * a migration the regenerated client code is reloaded but the parked
 * instance is not, and every query on a new table fails with "cannot read
 * properties of undefined". So the instance is kept only while its list of
 * tables matches the generated client's; otherwise it is replaced.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient; prismaModels?: string };
const MODELS = Object.keys(Prisma.ModelName).sort().join(",");

function createClient(): PrismaClient {
  const { connectionString, max } = databaseConnection();
  if (!connectionString) throw new Error("DATABASE_URL is not set. Copy .env.example to .env.");
  // Idle connections are closed quickly: a paused server copy must not sit on connections others need.
  return new PrismaClient({ adapter: new PrismaPg({ connectionString, max, idleTimeoutMillis: 5_000 }) });
}

export function getPrisma(): PrismaClient {
  if (globalForPrisma.prisma && globalForPrisma.prismaModels !== MODELS) {
    void globalForPrisma.prisma.$disconnect().catch(() => undefined);
    globalForPrisma.prisma = undefined;
  }
  if (!globalForPrisma.prisma) {
    globalForPrisma.prisma = createClient();
    globalForPrisma.prismaModels = MODELS;
  }
  return globalForPrisma.prisma;
}

export type Db = PrismaClient;
/** The client or an open transaction: services accept either. */
export type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];
