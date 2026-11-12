import DataLoader from "dataloader";
import type { Batch, Category, Variant } from "@/generated/prisma/client";
import type { Ctx } from "@/server/context";

/**
 * Per-request loaders: a list of N products resolves its variants,
 * categories and lots in three queries, not 3×N.
 */
function createLoaders(ctx: Ctx) {
  return {
    variantsByProduct: new DataLoader<string, Variant[]>(async (productIds) => {
      const rows = await ctx.db.variant.findMany({ where: { productId: { in: [...productIds] }, isActive: true }, orderBy: { position: "asc" } });
      return productIds.map((id) => rows.filter((row) => row.productId === id));
    }),
    categoryById: new DataLoader<string, Category | null>(async (ids) => {
      const rows = await ctx.db.category.findMany({ where: { id: { in: [...ids] } } });
      return ids.map((id) => rows.find((row) => row.id === id) ?? null);
    }),
    publishedBatchesByProduct: new DataLoader<string, Batch[]>(async (productIds) => {
      const rows = await ctx.db.batch.findMany({ where: { productId: { in: [...productIds] }, isPublished: true }, orderBy: { bottledAt: "desc" } });
      return productIds.map((id) => rows.filter((row) => row.productId === id));
    }),
  };
}

const cache = new WeakMap<Ctx, ReturnType<typeof createLoaders>>();

export function loaders(ctx: Ctx) {
  let value = cache.get(ctx);
  if (!value) cache.set(ctx, (value = createLoaders(ctx)));
  return value;
}
