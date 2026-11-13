"use server";

import { updateTag } from "next/cache";
import type { AdminRole } from "@/generated/prisma/client";
import * as admin from "@/server/admin";
import * as backoffice from "@/server/backoffice";
import * as assistantAdmin from "@/server/assistantAdmin";
import * as provenance from "@/server/provenance";
import * as stock from "@/server/stock";
import * as tracking from "@/server/tracking";
import * as translations from "@/server/translations";
import * as fulfilment from "@/server/fulfilment";
import * as twoFactor from "@/server/twoFactor";
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
  await run("/admin", (ctx) => adminLogin(ctx, { email: text(form, "email"), password: text(form, "password"), code: text(form, "code") }).then(() => undefined), "Signed in.");
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
      const items = [...form.keys()].filter((key) => key.startsWith("qty:")).map((key) => ({ orderItemId: key.slice(4), quantity: Math.round(number(key)) || 0, lotNumber: text(form, `lot:${key.slice(4)}`) }));
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

export async function releaseShipmentAttempt(orderId: string, attemptId: string) {
  await run(`/admin/orders/${orderId}`, (ctx) => fulfilment.releaseAttempt(ctx, attemptId), "Attempt released. The order can be booked again.");
}

/** Books one label per selected order. The choice arrives as "carrier|service". */
export async function bulkBookLabels(form: FormData) {
  await run("/admin/fulfilment", async (ctx) => {
    const [carrier, ...service] = text(form, "choice").split("|");
    const result = await fulfilment.bulkBookLabels(ctx, form.getAll("ids").map(String), { carrier, service: service.join("|") });
    afterResponse(() => processJobs(getPrisma()), "run after bulk booking");
    const failed = result.failed.length ? ` Not booked: ${result.failed.slice(0, 4).map((row) => `${row.number} (${row.reason})`).join("; ")}${result.failed.length > 4 ? "…" : ""}` : "";
    return `/admin/fulfilment?${result.booked.length ? "ok" : "error"}=${encodeURIComponent(`${result.booked.length} label${result.booked.length === 1 ? "" : "s"} booked.${failed}`)}`;
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
    const product = await admin.saveProduct(ctx, id, formData(form, { booleans: ["isVisible", "isFeatured", "allowBackorder"] }));
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
    await admin.saveVariant(ctx, productId, variantId, formData(form, { booleans: ["isActive"], euros: ["priceCents", "compareAtCents", "costCents"] }));
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
    requireAdmin(ctx, "MANAGER", "notifications");
    await requeueJob(ctx.db, id);
    await processJobs(ctx.db);
  }, "Job retried.");
}

export async function runJobsNow() {
  await run("/admin/notifications", async (ctx) => {
    requireAdmin(ctx, "MANAGER", "notifications");
    const report = await processJobs(ctx.db);
    return `/admin/notifications?ok=${encodeURIComponent(`Ran ${report.claimed} job(s): ${report.done} sent, ${report.skipped} skipped, ${report.retried} to retry, ${report.failed} failed.`)}`;
  });
}

// ── Back office ──

export async function reviewStatus(id: string, status: "APPROVED" | "REJECTED" | "PENDING") {
  await run("/admin/reviews", async (ctx) => {
    await backoffice.setReviewStatus(ctx, id, status);
    updateTag("catalog");
  }, status === "APPROVED" ? "Review approved and published." : status === "REJECTED" ? "Review rejected." : "Review moved back to pending.");
}

export async function saveSupplier(id: string | null, form: FormData) {
  await run("/admin/suppliers", (ctx) => backoffice.saveSupplier(ctx, id, formData(form, { booleans: ["isActive"] })).then(() => undefined), "Supplier saved.");
}

export async function removeSupplier(id: string) {
  await run("/admin/suppliers", async (ctx) => {
    const outcome = await backoffice.removeSupplier(ctx, id);
    return `/admin/suppliers?ok=${encodeURIComponent(outcome === "deleted" ? "Supplier deleted." : "Supplier has lots on record, so it was deactivated rather than deleted.")}`;
  });
}

export async function savePost(id: string | null, form: FormData) {
  await run(id ? `/admin/content/${id}` : "/admin/content/new", async (ctx) => {
    const saved = await backoffice.savePost(ctx, id, formData(form, { booleans: ["isPublished"] }));
    updateTag("journal");
    return `/admin/content/${saved}`;
  }, "Article saved.");
}

export async function deletePost(id: string) {
  await run("/admin/content", async (ctx) => {
    await backoffice.deletePost(ctx, id);
    updateTag("journal");
  }, "Article deleted.");
}

export async function saveContent(form: FormData) {
  await run("/admin/content", async (ctx) => {
    await admin.saveSetting(ctx, "content", formData(form, { booleans: ["announcementOn"] }));
    updateTag("content");
  }, "Announcement saved.");
}

export async function saveWholesale(customerId: string, backTo: string, form: FormData) {
  await run(backTo, (ctx) => backoffice.setWholesale(ctx, customerId, formData(form)), "Wholesale terms saved.");
}

export async function addWholesale(form: FormData) {
  await run("/admin/wholesale", (ctx) => backoffice.setWholesaleByEmail(ctx, text(form, "email"), formData(form)), "Wholesale account saved.");
}

export async function uploadPhoto(productId: string, form: FormData) {
  await run(`/admin/products/${productId}`, async (ctx) => {
    const file = form.get("photo");
    const data = file instanceof File ? new Uint8Array(await file.arrayBuffer()) : new Uint8Array();
    await backoffice.addProductPhoto(ctx, productId, { data, alt: text(form, "alt") });
    updateTag("catalog");
  }, "Photo uploaded.");
}

export async function deletePhoto(productId: string, imageId: string) {
  await run(`/admin/products/${productId}`, async (ctx) => {
    await backoffice.removeProductPhoto(ctx, imageId);
    updateTag("catalog");
  }, "Photo deleted.");
}

export async function createPurchaseOrder(form: FormData) {
  await run("/admin/inventory/purchasing", async (ctx) => {
    const lines = [...form.keys()].filter((key) => key.startsWith("qty:") && Number(text(form, key)) > 0).map((key) => ({ sku: key.slice(4), quantity: text(form, key), unitCostCents: Math.round(Number(text(form, `cost:${key.slice(4)}`).replace(",", ".") || "0") * 100) }));
    await backoffice.createPurchaseOrder(ctx, { supplierId: text(form, "supplierId"), expectedAt: text(form, "expectedAt"), notes: text(form, "notes"), lines });
  }, "Purchase order created as a draft.");
}

export async function purchaseOrderStatus(id: string, status: "ORDERED" | "CANCELLED") {
  await run("/admin/inventory/purchasing", (ctx) => backoffice.setPurchaseOrderStatus(ctx, id, status), status === "ORDERED" ? "Marked as ordered." : "Purchase order cancelled.");
}

export async function receivePurchaseOrder(id: string) {
  await run("/admin/inventory/purchasing", async (ctx) => {
    await backoffice.receivePurchaseOrder(ctx, id);
    updateTag("catalog");
  }, "Delivery received: stock and unit costs updated.");
}

export async function addCustomerNote(customerId: string, form: FormData) {
  await run(`/admin/customers/${customerId}`, (ctx) => backoffice.addCustomerNote(ctx, customerId, text(form, "body")), "Note added.");
}

export async function setCustomerTags(customerId: string, form: FormData) {
  await run(`/admin/customers/${customerId}`, (ctx) => backoffice.setCustomerTags(ctx, customerId, text(form, "tags")), "Tags saved.");
}

// ── Security ──

export async function beginTwoFactor() {
  await run("/admin/security", (ctx) => twoFactor.beginTotp(ctx).then(() => undefined), "Scan the key below with your authenticator app, then enter a code to finish.");
}

export async function confirmTwoFactor(form: FormData) {
  await run("/admin/security", (ctx) => twoFactor.confirmTotp(ctx, text(form, "code")), "Two-factor sign-in is on. You will be asked for a code each time you sign in.");
}

export async function disableTwoFactor(form: FormData) {
  await run("/admin/security", (ctx) => twoFactor.disableTotp(ctx, text(form, "password")), "Two-factor sign-in is off.");
}

export async function resetTwoFactor(adminUserId: string) {
  await run("/admin/security", (ctx) => twoFactor.resetTotpFor(ctx, adminUserId), "Two-factor sign-in reset. That person has been signed out and can set it up again.");
}

export async function revokeSession(sessionId: string) {
  await run("/admin/security", (ctx) => twoFactor.revokeSession(ctx, sessionId), "Session ended.");
}

// ── Translations ──

const translationPath = (entity: string, id: string, language: string) => `/admin/translations/${entity}/${id}/${language}`;

export async function saveTranslationAction(entity: string, id: string, language: string, form: FormData) {
  await run(translationPath(entity, id, language), async (ctx) => {
    await translations.saveTranslationDraft(ctx, entity, id, language, formData(form));
  }, "Draft saved. Customers still see the published version.");
}

export async function publishTranslationAction(entity: string, id: string, language: string) {
  await run(translationPath(entity, id, language), async (ctx) => {
    await translations.publishTranslation(ctx, entity, id, language);
    updateTag(entity === "journal" ? "journal" : "catalog");
  }, "Published. Customers now see this translation.");
}

export async function unpublishTranslationAction(entity: string, id: string, language: string) {
  await run(translationPath(entity, id, language), async (ctx) => {
    await translations.unpublishTranslation(ctx, entity, id, language);
    updateTag(entity === "journal" ? "journal" : "catalog");
  }, "Taken off the shop. Customers see English again.");
}

// ── Provenance, certificates and laboratory results ──

export async function saveRegion(id: string | null, form: FormData) {
  await run("/admin/regions", async (ctx) => {
    await provenance.saveRegion(ctx, id, formData(form));
    updateTag("catalog");
  }, "Region saved.");
}

export async function deleteRegion(id: string) {
  await run("/admin/regions", async (ctx) => {
    await provenance.deleteRegion(ctx, id);
  }, "Region removed.");
}

export async function saveProducer(id: string | null, form: FormData) {
  await run("/admin/producers", async (ctx) => {
    await provenance.saveProducer(ctx, id, formData(form, { booleans: ["isPublic"] }));
    updateTag("catalog");
  }, "Producer saved.");
}

export async function saveVariety(id: string | null, form: FormData) {
  await run("/admin/varieties", async (ctx) => {
    await provenance.saveVariety(ctx, id, formData(form));
    updateTag("catalog");
  }, "Variety saved.");
}

export async function saveProductProfile(productId: string, form: FormData) {
  await run(`/admin/products/${productId}`, async (ctx) => {
    // One row per variety on the form: a ticked box, and optionally its share.
    const varieties = form.getAll("variety").map((id) => ({ varietyId: String(id), percent: String(form.get(`percent:${String(id)}`) ?? "") }));
    const fields = Object.fromEntries(Object.entries(formData(form)).filter(([key]) => key !== "variety" && !key.startsWith("percent:")));
    await provenance.saveProductProfile(ctx, productId, { ...fields, varieties });
    updateTag("catalog");
  }, "Origin and tasting profile saved.");
}

export async function uploadBatchDocument(batchId: string, form: FormData) {
  await run(`/admin/lots/${batchId}`, async (ctx) => {
    const file = form.get("file");
    const data = file instanceof File ? new Uint8Array(await file.arrayBuffer()) : new Uint8Array();
    await provenance.addBatchDocument(ctx, batchId, { data, title: String(form.get("title") ?? ""), kind: String(form.get("kind") ?? "") });
  }, "Document uploaded. It is not shown to customers until it is verified.");
}

export async function verifyBatchDocument(batchId: string, documentId: string, verified: boolean) {
  await run(`/admin/lots/${batchId}`, async (ctx) => {
    await provenance.setDocumentVerified(ctx, documentId, verified);
    updateTag("catalog");
  }, verified ? "Document verified." : "Verification withdrawn.");
}

export async function removeBatchDocument(batchId: string, documentId: string) {
  await run(`/admin/lots/${batchId}`, async (ctx) => {
    await provenance.removeBatchDocument(ctx, documentId);
    updateTag("catalog");
  }, "Document removed. Results read from it are no longer verified.");
}

export async function addLabResult(batchId: string, form: FormData) {
  await run(`/admin/lots/${batchId}`, async (ctx) => {
    await provenance.addLabResult(ctx, batchId, formData(form));
  }, "Result recorded. It is not shown to customers until it is verified.");
}

export async function verifyLabResult(batchId: string, resultId: string, verified: boolean) {
  await run(`/admin/lots/${batchId}`, async (ctx) => {
    await provenance.setLabResultVerified(ctx, resultId, verified);
    updateTag("catalog");
  }, verified ? "Result verified." : "Verification withdrawn.");
}

export async function removeLabResult(batchId: string, resultId: string) {
  await run(`/admin/lots/${batchId}`, async (ctx) => {
    await provenance.removeLabResult(ctx, resultId);
    updateTag("catalog");
  }, "Result removed.");
}

// ── Backorders and taking units off an order ──

export async function cancelUnits(orderId: string, form: FormData) {
  await run(`/admin/orders/${orderId}`, async (ctx) => {
    await stock.cancelOutstanding(ctx, text(form, "orderItemId"), Math.round(Number(text(form, "quantity"))));
    updateTag("catalog");
  }, "Units taken off the order. No money has been returned: issue a refund if one is owed.");
}

// ── Tracking by hand, and testing a carrier ──

export async function addTrackingEvent(orderId: string, shipmentId: string, form: FormData) {
  await run(`/admin/orders/${orderId}`, async (ctx) => {
    await tracking.addTrackingEvent(ctx, shipmentId, formData(form));
  }, "Tracking event recorded.");
}

export async function setTrackingNumber(orderId: string, shipmentId: string, form: FormData) {
  await run(`/admin/orders/${orderId}`, async (ctx) => {
    await tracking.setTrackingNumber(ctx, shipmentId, formData(form));
  }, "Tracking number saved. The customer sees it on their order; no email is sent for this.");
}

export async function testCarrier(key: string) {
  await run("/admin/fulfilment", async (ctx) => `/admin/fulfilment?ok=${encodeURIComponent(await tracking.testCarrier(ctx, key))}`);
}

// ── Assistant, knowledge base and support ──

export async function saveAssistant(form: FormData) {
  await run("/admin/assistant", (ctx) => assistantAdmin.saveAssistantSettings(ctx, formData(form, { booleans: ["customerEnabled", "staffEnabled"] })), "Assistant settings saved.");
}

export async function saveArticle(id: string | null, form: FormData) {
  await run("/admin/knowledge", async (ctx) => {
    await assistantAdmin.saveArticle(ctx, id, formData(form, { booleans: ["isPublished"] }));
  }, "Article saved.");
}

export async function deleteArticle(id: string) {
  await run("/admin/knowledge", (ctx) => assistantAdmin.deleteArticle(ctx, id), "Article deleted.");
}

export async function supportStatus(id: string, form: FormData) {
  await run("/admin/support", (ctx) => assistantAdmin.setSupportStatus(ctx, id, formData(form)), "Request updated.");
}
