import type { ApolloServer } from "@apollo/server";
import { handleGraphQL } from "@/graphql/server";
import type { Ctx } from "@/server/context";
import { hashPassword } from "@/server/crypto";
import { getPrisma } from "@/server/db";

export const db = getPrisma();

/** Empties every table, so each test starts from a known state. */
export async function resetDb() {
  const tables = await db.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`);
}

/** A small catalogue: one visible product in three sizes, one hidden product, one shipping zone. */
export async function seedCatalog(stock = 10) {
  const category = await db.category.create({ data: { slug: "oil", name: "Oil" } });
  const product = await db.product.create({
    data: {
      slug: "evoo",
      name: "Test Oil",
      categoryId: category.id,
      isVisible: true,
      variants: {
        create: [
          { sku: "t-500", label: "500 ml", volumeMl: 500, priceCents: 1800, weightGrams: 950, stock, position: 0 },
          { sku: "t-750", label: "750 ml", volumeMl: 750, priceCents: 2600, weightGrams: 1350, stock, position: 1 },
          { sku: "t-1000", label: "1000 ml", volumeMl: 1000, priceCents: 3200, weightGrams: 1750, stock: 0, position: 2 },
        ],
      },
    },
  });
  await db.product.create({
    data: { slug: "hidden", name: "Hidden Oil", categoryId: category.id, isVisible: false, variants: { create: [{ sku: "h-500", label: "500 ml", volumeMl: 500, priceCents: 999, weightGrams: 950, stock: 5 }] } },
  });
  const zone = await db.shippingZone.create({
    data: {
      name: "Test zone",
      countries: ["BE", "FR"],
      rates: { create: [{ name: "Standard", priceCents: 695, freeAboveCents: 7500, position: 0 }, { name: "Express", priceCents: 1495, position: 1 }] },
    },
    include: { rates: { orderBy: { position: "asc" } } },
  });
  return { product, standardRateId: zone.rates[0].id, expressRateId: zone.rates[1].id };
}

export async function createAdmin(role: "ADMINISTRATOR" | "MANAGER" | "STAFF", password = "correct horse battery") {
  const email = `${role.toLowerCase()}@test.local`;
  await db.adminUser.create({ data: { email, name: role, role, passwordHash: await hashPassword(password) } });
  return { email, password };
}

type GqlResult<T> = { data: T | null; errors?: { message: string; extensions?: { code?: string; field?: string } }[] };

let nextIp = 1;

/** A browser stand-in: keeps cookies between requests and goes through the real HTTP adapter. */
export function createClient(server: ApolloServer<Ctx>, path = "/api/graphql") {
  const jar = new Map<string, string>();
  const ip = `10.0.0.${nextIp++}`;

  return {
    jar,
    async gql<T = Record<string, never>>(query: string, variables?: Record<string, unknown>, headers: Record<string, string> = {}): Promise<GqlResult<T> & { status: number; setCookies: string[] }> {
      const cookie = [...jar].map(([key, value]) => `${key}=${value}`).join("; ");
      const response = await handleGraphQL(
        server,
        new Request(`http://localhost:3000${path}`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-forwarded-for": ip, ...(cookie ? { cookie } : {}), ...headers },
          body: JSON.stringify({ query, variables }),
        }),
        db,
      );
      const setCookies = response.headers.getSetCookie();
      for (const header of setCookies) {
        const [pair] = header.split(";");
        const index = pair.indexOf("=");
        const name = pair.slice(0, index);
        if (/Max-Age=0/.test(header)) jar.delete(name);
        else jar.set(name, pair.slice(index + 1));
      }
      return { ...((await response.json()) as GqlResult<T>), status: response.status, setCookies };
    },
  };
}

export const code = (result: { errors?: { extensions?: { code?: string } }[] }) => result.errors?.[0]?.extensions?.code;

/** Billing address for orders created directly in tests. */
export const BILL = { billFirstName: "Test", billLastName: "Customer", billLine1: "Teststraat 1", billPostalCode: "1000", billCity: "Brussels", billCountryCode: "BE" } as const;
