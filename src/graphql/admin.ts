import SchemaBuilder from "@pothos/core";
import type { AdminUser, Product, Variant } from "@/generated/prisma/client";
import { adminLogin, adminLogout, requireAdmin } from "@/server/auth";
import type { Ctx } from "@/server/context";
import { AppError } from "@/server/errors";

/**
 * Admin API — a separate schema on a separate endpoint, so administrative
 * types never appear in the public schema. Every field calls requireAdmin
 * with the minimum role it needs; there is no field that trusts the client.
 *
 * Phase 4 ships the foundation (sign-in, roles, audit, inventory). The full
 * management surface is added in Phase 6.
 */

// Fields are non-null unless marked `nullable: true`, so generated client types are precise.
const builder = new SchemaBuilder<{ Context: Ctx; DefaultFieldNullability: false }>({ defaultFieldNullability: false });

const AdminUserType = builder.objectRef<AdminUser>("AdminUser").implement({
  fields: (t) => ({
    id: t.exposeID("id"),
    email: t.exposeString("email"),
    name: t.exposeString("name"),
    role: t.exposeString("role"),
  }),
});

const AdminVariantType = builder.objectRef<Variant>("AdminVariant").implement({
  fields: (t) => ({
    id: t.exposeID("id"),
    sku: t.exposeString("sku"),
    label: t.exposeString("label"),
    priceCents: t.exposeInt("priceCents"),
    stock: t.exposeInt("stock"),
    reserved: t.exposeInt("reserved"),
    available: t.int({ resolve: (v) => v.stock - v.reserved }),
    lowStockThreshold: t.exposeInt("lowStockThreshold"),
    isActive: t.exposeBoolean("isActive"),
  }),
});

const AdminProductType = builder.objectRef<Product & { variants: Variant[] }>("AdminProduct").implement({
  fields: (t) => ({
    id: t.exposeID("id"),
    slug: t.exposeString("slug"),
    name: t.exposeString("name"),
    isVisible: t.exposeBoolean("isVisible"),
    variants: t.field({ type: [AdminVariantType], resolve: (p) => p.variants }),
  }),
});

const InventoryReasonEnum = builder.enumType("InventoryReason", { values: ["RECEIVED", "ADJUSTMENT", "RETURN", "DAMAGED"] as const });

builder.queryType({
  fields: (t) => ({
    me: t.field({ type: AdminUserType, nullable: true, resolve: (_root, _args, ctx) => ctx.admin }),
    products: t.field({
      type: [AdminProductType],
      description: "All products, including hidden ones, with stock levels. Staff and above.",
      resolve: (_root, _args, ctx) => {
        requireAdmin(ctx, "VIEW", "catalog");
        return ctx.db.product.findMany({ where: { deletedAt: null }, orderBy: { position: "asc" }, include: { variants: { orderBy: { position: "asc" } } } });
      },
    }),
  }),
});

builder.mutationType({
  fields: (t) => ({
    login: t.field({
      type: AdminUserType,
      args: { email: t.arg.string({ required: true }), password: t.arg.string({ required: true }) },
      resolve: (_root, args, ctx) => adminLogin(ctx, args),
    }),
    logout: t.boolean({
      resolve: async (_root, _args, ctx) => {
        await adminLogout(ctx);
        return true;
      },
    }),
    adjustInventory: t.field({
      type: AdminVariantType,
      description: "Adds or removes units on hand. Managers and above. Recorded in the movement ledger and the audit log.",
      args: {
        sku: t.arg.string({ required: true }),
        delta: t.arg.int({ required: true }),
        reason: t.arg({ type: InventoryReasonEnum, required: true }),
        note: t.arg.string(),
      },
      resolve: async (_root, args, ctx) => {
        const admin = requireAdmin(ctx, "MANAGER", "inventory");
        if (args.delta === 0 || Math.abs(args.delta) > 100_000) throw new AppError("BAD_INPUT", "Enter a non-zero quantity.", "delta");
        return ctx.db.$transaction(async (tx) => {
          // Stock may not drop below what unpaid orders are holding.
          const changed = await tx.$executeRaw`UPDATE "Variant" SET "stock" = "stock" + ${args.delta} WHERE "sku" = ${args.sku} AND "stock" + ${args.delta} >= "reserved"`;
          if (changed !== 1) throw new AppError("BAD_INPUT", "Unknown SKU, or the change would take stock below reserved units.", "delta");
          const variant = await tx.variant.findUniqueOrThrow({ where: { sku: args.sku } });
          await tx.inventoryMovement.create({ data: { variantId: variant.id, delta: args.delta, reason: args.reason, adminUserId: admin.id, note: args.note?.slice(0, 500) } });
          await tx.auditLog.create({ data: { actorType: "admin", actorId: admin.id, action: "inventory.adjust", entity: "Variant", entityId: variant.id, data: { sku: args.sku, delta: args.delta, reason: args.reason }, ip: ctx.ip } });
          return variant;
        });
      },
    }),
  }),
});

export const adminSchema = builder.toSchema();
