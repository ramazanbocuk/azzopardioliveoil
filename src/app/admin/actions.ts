"use server";

import { updateTag } from "next/cache";
import type { AdminRole } from "@/generated/prisma/client";
import * as admin from "@/server/admin";
import * as fulfilment from "@/server/fulfilment";
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
  await run(`/admin/orders/${orderId}`, (ctx) => admin.startFulfilment(ctx, orderId), "Order moved to processing.");
}

export async function markReady(orderId: string) {
  await run(`/admin/orders/${orderId}`, (ctx) => admin.markReady(ctx, orderId), "Order marked ready for fulfilment.");
}

/** Reads the shipment form: units per line, and identical boxes described once (kg and cm, as people measure them). */
export async function ship(orderId: string, form: FormData) {
  await run(
    `/admin/orders/${orderId}`,
    async (ctx) => {
      const number = (key: string) => Number(text(form, key).trim().replace(",", "."));
      const items = [...form.keys()].filter((key) => key.startsWith("qty:")).map((key) => ({ orderItemId: key.slice(4), quantity: Math.round(number(key)) || 0 }));
      const boxes = Math.min(20, Math.max(1, Math.round(number("boxes")) || 1));
      const kg = number("weightKg");
      const mm = (key: string) => (text(form, key).trim() ? Math.round(number(key) * 10) : null);
      const parcels = kg > 0 ? Array.from({ length: boxes }, () => ({ weightGrams: Math.round(kg * 1000), lengthMm: mm("lengthCm"), widthMm: mm("widthCm"), heightMm: mm("heightCm") })) : null;
      await admin.createShipment(ctx, orderId, { carrier: text(form, "carrier"), service: text(form, "service"), trackingNumber: text(form, "trackingNumber"), trackingUrl: text(form, "trackingUrl"), items: items.length ? items : null, parcels });
      afterResponse(() => processJobs(getPrisma()), "run after shipping");
    },
    "Shipment recorded.",
  );
}

const boxesFrom = (form: FormData) => {
  const number = (key: string) => Number(text(form, key).trim().replace(",", "."));
  const count = Math.min(20, Math.max(1, Math.round(number("boxes")) || 1));
  const mm = (key: string) => (text(form, key).trim() ? Math.round(number(key) * 10) : null);
  return Array.from({ length: count }, () => ({ weightGrams: Math.round(number("weightKg") * 1000), lengthMm: mm("lengthCm"), widthMm: mm("widthCm"), heightMm: mm("heightCm") }));
};

/** Books a label with a carrier. The choice arrives as "carrier|service" from the rate table or the service list. */
export async function bookCarrierLabel(orderId: string, form: FormData) {
  await run(
    `/admin/orders/${orderId}`,
    async (ctx) => {
      const [carrier, ...service] = text(form, "choice").split("|");
      await fulfilment.bookLabel(ctx, orderId, { carrier, service: service.join("|"), boxes: boxesFrom(form) });
      afterResponse(() => processJobs(getPrisma()), "run after booking");
    },
    "Label booked. Print it from the shipment below.",
  );
}

export async function cancelShipment(orderId: string, shipmentId: string) {
  await run(`/admin/orders/${orderId}`, async (ctx) => {
    const result = await fulfilment.cancelBooking(ctx, shipmentId);
    const url = new URL(`/admin/orders/${orderId}`, "http://admin.local");
    url.searchParams.set("ok", result.cancelledWithCarrier ? "Shipment cancelled with the carrier." : "Shipment cancelled here. This carrier has no cancellation API: do not hand the parcel over, and void the label in the carrier's own portal if it offers that.");
    return `${url.pathname}${url.search}`;
  });
}

export async function saveShipping(form: FormData) {
  await run("/admin/settings", (ctx) => admin.saveSetting(ctx, "shipping", formData(form)), "Shipping origin saved.");
}

export async function bulkOrders(backTo: string, form: FormData) {
  await run(backTo, async (ctx) => {
    const result = await admin.bulkUpdateOrders(ctx, form.getAll("ids").map(String), text(form, "action"));
    const skipped = result.skipped.length ? ` Skipped ${result.skipped.length}: ${result.skipped.slice(0, 5).map((row) => `${row.number} (${row.reason})`).join("; ")}${result.skipped.length > 5 ? "…" : ""}` : "";
    const url = new URL(backTo, "http://admin.local");
    url.searchParams.set(result.done.length ? "ok" : "error", `${result.done.length} order${result.done.length === 1 ? "" : "s"} updated.${skipped}`);
    return `${url.pathname}${url.search}`;
  });
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
