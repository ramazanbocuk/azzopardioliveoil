import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import type { Db } from "./db";
import { AppError, parse } from "./errors";
import { enforce } from "./rateLimit";

const listInput = z.object({
  categorySlug: z.string().max(120).optional(),
  search: z.string().trim().max(80).optional(),
  volumesMl: z.array(z.number().int().positive()).max(20).optional(),
  inStockOnly: z.boolean().optional(),
  sort: z.enum(["FEATURED", "NAME", "NEWEST"]).default("FEATURED"),
  first: z.number().int().min(1).max(48).default(24),
  after: z.string().max(60).optional(),
});

const publicProduct = { isVisible: true, deletedAt: null } satisfies Prisma.ProductWhereInput;

const orderings = {
  FEATURED: [{ position: "asc" }, { id: "asc" }],
  NAME: [{ name: "asc" }, { id: "asc" }],
  NEWEST: [{ createdAt: "desc" }, { id: "asc" }],
} satisfies Record<string, Prisma.ProductOrderByWithRelationInput[]>;

/** Cursor-paginated listing of visible products. All filters are parameterised by Prisma. */
export async function listProducts(db: Db, input: unknown) {
  const args = parse(listInput, input ?? {});
  const variantFilter: Prisma.VariantWhereInput = {
    isActive: true,
    ...(args.volumesMl?.length ? { volumeMl: { in: args.volumesMl } } : {}),
  };
  const where: Prisma.ProductWhereInput = {
    ...publicProduct,
    ...(args.categorySlug ? { category: { slug: args.categorySlug, isVisible: true } } : {}),
    ...(args.search ? { OR: [{ name: { contains: args.search, mode: "insensitive" } }, { blurb: { contains: args.search, mode: "insensitive" } }, { batches: { some: { lotNumber: { equals: args.search, mode: "insensitive" }, isPublished: true } } }] } : {}),
    variants: { some: variantFilter },
  };

  let rows = await db.product.findMany({
    where,
    orderBy: orderings[args.sort],
    take: args.first + 1,
    ...(args.after ? { cursor: { id: args.after }, skip: 1 } : {}),
    include: { variants: { where: { isActive: true }, orderBy: { position: "asc" } } },
  });

  // Stock compares two columns, which a Prisma filter cannot express; the page is small.
  if (args.inStockOnly) rows = rows.filter((p) => p.variants.some((v) => v.stock - v.reserved > 0));

  const hasNextPage = rows.length > args.first;
  const nodes = rows.slice(0, args.first);
  return { nodes, hasNextPage, endCursor: nodes.at(-1)?.id ?? null, totalCount: await db.product.count({ where }) };
}

export function getProduct(db: Db, slug: string) {
  return db.product.findFirst({ where: { slug, ...publicProduct } });
}

export function listCategories(db: Db) {
  return db.category.findMany({ where: { isVisible: true }, orderBy: { position: "asc" } });
}

/** Public lot lookup. Only published batches, and only verified documents. */
export async function lookupLot(db: Db, ip: string, lotNumber: string) {
  await enforce(db, `lot:ip:${ip}`, 30, 300);
  const lot = lotNumber.trim().toUpperCase();
  if (!/^[A-Z0-9-]{3,32}$/.test(lot)) throw new AppError("BAD_INPUT", "That does not look like a lot number.", "lotNumber");
  return db.batch.findFirst({
    where: { lotNumber: lot, isPublished: true },
    // The file itself is served from /media/certificate; it is never loaded just to list its title.
    include: { product: true, documents: { where: { verifiedAt: { not: null } }, orderBy: { createdAt: "asc" }, omit: { data: true } } },
  });
}
