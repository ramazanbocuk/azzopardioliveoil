"use server";

import { updateTag } from "next/cache";
import type { AdminRole } from "@/generated/prisma/client";
import * as admin from "@/server/admin";
import { formData, run } from "@/server/adminSession";
import { afterResponse } from "@/server/afterResponse";
import { adminLogin, adminLogout, requireAdmin } from "@/server/auth";
import { getPrisma } from "@/server/db";
import { processJobs, requeueJob } from "@/server/jobs";

/**
 * Server actions for the admin panel. They are thin: read the form, call a
 * service in src/server/admin.ts (which checks the role and writes the audit
 * record), refresh cached storefront data, and redirect with the outcome.
 * Next.js rejects server-action requests from other origins.
 */

const text = (form: FormData, key: string) => String(form.get(key) ?? "");

export async function signIn(form: FormData) {
  await run("/admin", (ctx) => adminLogin(ctx, { email: text(form, "email"), password: text(form, "password") }).then(() => undefined), "Signed in.");
}

export async function signOut() {
  await run("/admin", (ctx) => adminLogout(ctx), "Signed out.");
}

// ── Orders ──

export async function addNote(orderId: string, form: FormData) {
  await run(`/admin/orders/${orderId}`, (ctx) => admin.addOrderNote(ctx, orderId, text(form, "body")), "Note added.");
}

export async function setLot(orderId: string, itemId: string, form: FormData) {
  await run(`/admin/orders/${orderId}`, (ctx) => admin.setItemLot(ctx, itemId, text(form, "lotNumber")), "Lot recorded.");
}

export async function startPacking(orderId: string) {
  await run(`/admin/orders/${orderId}`, (ctx) => admin.startFulfilment(ctx, orderId), "Order moved to packing.");
}

export async function ship(orderId: string, form: FormData) {
  await run(
    `/admin/orders/${orderId}`,
    async (ctx) => {
      await admin.markShipped(ctx, orderId, formData(form));
      afterResponse(() => processJobs(getPrisma()), "run after shipping");
    },
    "Order marked as shipped.",
  );
}

export async function deliver(orderId: string) {
  await run(`/admin/orders/${orderId}`, (ctx) => admin.markDelivered(ctx, orderId), "Order marked as delivered.");
}

export async function cancelOrder(orderId: string) {
  await run(`/admin/orders/${orderId}`, (ctx) => admin.cancelUnpaidOrder(ctx, orderId), "Order cancelled and stock released.");
}

export async function refund(orderId: string, form: FormData) {
  await run(`/admin/orders/${orderId}`, (ctx) => admin.refundOrder(ctx, orderId, formData(form, { euros: ["amountCents"], booleans: ["restock"] })), "Refund sent.");
}

export async function returnStatus(orderId: string, returnId: string, status: "APPROVED" | "REJECTED" | "RECEIVED") {
  await run(`/admin/orders/${orderId}`, (ctx) => admin.setReturnStatus(ctx, returnId, status), "Return updated.");
}

// ── Catalogue ──

export async function saveProduct(id: string | null, form: FormData) {
  await run(id ? `/admin/products/${id}` : "/admin/products/new", async (ctx) => {
    const product = await admin.saveProduct(ctx, id, formData(form, { booleans: ["isVisible", "isFeatured"] }));
    updateTag("catalog");
    return `/admin/products/${product.id}`;
  });
}

export async function deleteProduct(id: string) {
  await run(`/admin/products/${id}`, async (ctx) => {
    await admin.deleteProduct(ctx, id);
    updateTag("catalog");
    return "/admin/products";
  }, "Product removed from sale.");
}

export async function saveVariant(productId: string, variantId: string | null, form: FormData) {
  await run(`/admin/products/${productId}`, async (ctx) => {
    await admin.saveVariant(ctx, productId, variantId, formData(form, { booleans: ["isActive"], euros: ["priceCents", "compareAtCents"] }));
    updateTag("catalog");
  });
}

export async function adjustStock(productId: string, variantId: string, form: FormData) {
  await run(`/admin/products/${productId}`, async (ctx) => {
    await admin.adjustStock(ctx, variantId, Number(text(form, "delta")), text(form, "reason") as "RECEIVED" | "ADJUSTMENT" | "RETURN" | "DAMAGED", text(form, "note"));
    updateTag("catalog");
  }, "Stock updated.");
}

export async function saveCategory(id: string | null, form: FormData) {
  await run("/admin/products", async (ctx) => {
    await admin.saveCategory(ctx, id, formData(form, { booleans: ["isVisible"] }));
    updateTag("catalog");
  });
}

export async function saveBatch(id: string | null, form: FormData) {
  await run("/admin/lots", async (ctx) => {
    await admin.saveBatch(ctx, id, formData(form, { booleans: ["isPublished"] }));
    updateTag("catalog");
  });
}

// ── Customers ──

export async function eraseCustomer(id: string) {
  await run(`/admin/customers/${id}`, async (ctx) => {
    await admin.eraseCustomer(ctx, id);
    return "/admin/customers";
  }, "Customer data erased.");
}

// ── Marketing, shipping, tax ──

export async function saveDiscount(id: string | null, form: FormData) {
  const kind = text(form, "kind");
  const input = formData(form, { booleans: ["isActive"], euros: ["minSubtotalCents"] });
  // "Value" is a percentage for percent codes and an amount in euros for fixed ones.
  if (kind === "FIXED") input.value = Math.round(Number(text(form, "value").replace(",", ".")) * 100);
  await run("/admin/discounts", (ctx) => admin.saveDiscount(ctx, id, input));
}

export async function saveZone(id: string | null, form: FormData) {
  await run("/admin/shipping", async (ctx) => {
    await admin.saveZone(ctx, id, formData(form, { booleans: ["isActive"], lists: ["countries"] }));
    updateTag("shipping");
  });
}

export async function saveRate(zoneId: string, id: string | null, form: FormData) {
  await run("/admin/shipping", async (ctx) => {
    await admin.saveRate(ctx, zoneId, id, formData(form, { booleans: ["isActive"], euros: ["priceCents", "freeAboveCents"] }));
    updateTag("shipping");
  });
}

export async function deleteRate(id: string) {
  await run("/admin/shipping", async (ctx) => {
    await admin.deleteRate(ctx, id);
    updateTag("shipping");
  }, "Rate deleted.");
}

export async function saveTax(form: FormData) {
  await run("/admin/shipping", (ctx) => admin.saveTaxRate(ctx, formData(form)));
}

export async function deleteTax(countryCode: string) {
  await run("/admin/shipping", (ctx) => admin.deleteTaxRate(ctx, countryCode), "VAT rate deleted.");
}

// ── Settings and staff ──

export async function saveStore(form: FormData) {
  await run("/admin/settings", (ctx) => admin.saveSetting(ctx, "store", formData(form)));
}

export async function saveNotifications(form: FormData) {
  await run("/admin/settings", (ctx) => admin.saveSetting(ctx, "notifications", formData(form, { booleans: ["notifyByEmail", "notifyByWhatsapp", "notifyBySms"] })));
}

export async function createStaff(form: FormData) {
  await run("/admin/staff", (ctx) => admin.createStaff(ctx, formData(form)), "Staff account created.");
}

export async function setStaffRole(id: string, form: FormData) {
  await run("/admin/staff", (ctx) => admin.updateStaff(ctx, id, { role: text(form, "role") as AdminRole }), "Role updated.");
}

export async function setStaffActive(id: string, isActive: boolean) {
  await run("/admin/staff", (ctx) => admin.updateStaff(ctx, id, { isActive }), isActive ? "Account reactivated." : "Account deactivated and signed out.");
}

// ── Notifications ──

export async function retryJob(id: string) {
  await run("/admin/notifications", async (ctx) => {
    requireAdmin(ctx, "MANAGER");
    await requeueJob(ctx.db, id);
    await processJobs(ctx.db);
  }, "Job retried.");
}

export async function runJobsNow() {
  await run("/admin/notifications", async (ctx) => {
    requireAdmin(ctx, "MANAGER");
    const report = await processJobs(ctx.db);
    return `/admin/notifications?ok=${encodeURIComponent(`Ran ${report.claimed} job(s): ${report.done} sent, ${report.skipped} skipped, ${report.retried} to retry, ${report.failed} failed.`)}`;
  });
}
