import type { AdminRole } from "@/generated/prisma/client";

/**
 * Who may do what.
 *
 * Every staff action names the AREA it belongs to and the LEVEL it needs:
 *   VIEW           see the screens and lists
 *   STAFF          day-to-day work: process an order, book a label, add a note
 *   MANAGER        change records and rules; export data
 *   ADMINISTRATOR  money out, legal settings, other people's access
 * A role holds one level per area. The check lives in `requireAdmin` and runs
 * on the server for every action, whichever screen or API it comes from.
 *
 * Roles are fixed here, in code, on purpose: a permission that can be edited
 * from the screen it protects is a permission that can be escalated.
 */

export const AREAS = ["orders", "catalog", "inventory", "customers", "shipping", "payments", "discounts", "marketing", "wholesale", "returns", "reviews", "reports", "accounting", "suppliers", "traceability", "content", "notifications", "staff", "security", "settings", "integrations", "assistant", "support", "general"] as const;
export type Area = (typeof AREAS)[number];
export type Level = "VIEW" | "STAFF" | "MANAGER" | "ADMINISTRATOR";

export const LEVEL: Record<Level | "NONE", number> = { NONE: 0, VIEW: 1, STAFF: 2, MANAGER: 3, ADMINISTRATOR: 4 };

type Grants = Partial<Record<Area, Level | "NONE">>;
/** `base` applies to every area not listed. Everyone may manage their own two-factor sign-in and sessions. */
const role = (base: Level | "NONE", grants: Grants = {}) => ({ base, grants: { security: "STAFF" as const, ...grants } });

export const ROLES: Record<AdminRole, { label: string; summary: string; base: Level | "NONE"; grants: Grants }> = {
  SUPER_ADMINISTRATOR: { label: "Super administrator", summary: "Everything, including staff accounts and settings.", ...role("ADMINISTRATOR", { security: "ADMINISTRATOR" }) },
  ADMINISTRATOR: { label: "Administrator", summary: "Everything, including refunds, VAT, settings and staff accounts.", ...role("ADMINISTRATOR", { security: "ADMINISTRATOR" }) },
  OPERATIONS_MANAGER: { label: "Operations manager", summary: "Runs orders, stock, shipping, catalogue and customers. No refunds, settings or staff accounts.", ...role("MANAGER", { staff: "VIEW", settings: "VIEW", integrations: "VIEW" }) },
  MANAGER: { label: "Manager", summary: "As operations manager. Kept for accounts created before the nine roles.", ...role("MANAGER") },
  WAREHOUSE_MANAGER: { label: "Warehouse manager", summary: "Stock, lots, suppliers and packing. Sees orders and customers; no prices, money or reports.", ...role("NONE", { inventory: "MANAGER", suppliers: "MANAGER", traceability: "MANAGER", returns: "MANAGER", orders: "STAFF", shipping: "STAFF", catalog: "VIEW", customers: "VIEW", notifications: "VIEW" }) },
  SHIPPING_MANAGER: { label: "Shipping manager", summary: "Labels, carriers, shipping rates and deliveries. Processes orders; no money or reports.", ...role("NONE", { shipping: "MANAGER", orders: "STAFF", traceability: "STAFF", inventory: "VIEW", catalog: "VIEW", customers: "VIEW", returns: "VIEW", notifications: "VIEW", integrations: "VIEW" }) },
  CUSTOMER_SUPPORT: { label: "Customer support", summary: "Orders, customers, returns and reviews. Sees payments and shipments; cannot refund.", ...role("NONE", { orders: "STAFF", customers: "STAFF", returns: "MANAGER", reviews: "MANAGER", support: "MANAGER", assistant: "VIEW", shipping: "VIEW", payments: "VIEW", catalog: "VIEW", inventory: "VIEW", wholesale: "VIEW", traceability: "VIEW", notifications: "VIEW" }) },
  ACCOUNTANT: { label: "Accountant", summary: "Payments, refunds, VAT and sales reports and their exports. Sees orders and customers.", ...role("NONE", { payments: "ADMINISTRATOR", accounting: "MANAGER", reports: "MANAGER", orders: "VIEW", customers: "VIEW", wholesale: "VIEW", discounts: "VIEW", returns: "VIEW" }) },
  MARKETING_MANAGER: { label: "Marketing manager", summary: "Discounts, newsletter, journal, reviews, product copy and sales reports. Sees orders and customers.", ...role("NONE", { marketing: "MANAGER", discounts: "MANAGER", content: "MANAGER", assistant: "MANAGER", reviews: "MANAGER", catalog: "MANAGER", reports: "MANAGER", orders: "VIEW", customers: "VIEW", wholesale: "VIEW", inventory: "VIEW" }) },
  ANALYST: { label: "Read-only analyst", summary: "Sees everything operational and every report. Changes nothing.", ...role("VIEW", { reports: "MANAGER", accounting: "MANAGER", staff: "NONE", settings: "NONE" }) },
  STAFF: { label: "Staff", summary: "Day-to-day work in every area. Kept for accounts created before the nine roles.", ...role("STAFF") },
};

export const ROLE_ORDER: AdminRole[] = ["SUPER_ADMINISTRATOR", "ADMINISTRATOR", "OPERATIONS_MANAGER", "WAREHOUSE_MANAGER", "SHIPPING_MANAGER", "CUSTOMER_SUPPORT", "ACCOUNTANT", "MARKETING_MANAGER", "ANALYST", "MANAGER", "STAFF"];

export function levelOf(roleName: AdminRole, area: Area): number {
  const entry = ROLES[roleName];
  return LEVEL[entry.grants[area] ?? entry.base];
}

/** True when the role reaches `minimum` in `area`. Pages use it to hide what a person cannot use; the server check is `requireAdmin`. */
export function can(roleName: AdminRole, minimum: Level, area: Area): boolean {
  return levelOf(roleName, area) >= LEVEL[minimum];
}

/** Reports and accounting are read-only areas: holding MANAGER there lets a person export, not alter anything. */
export const EXPORT_ONLY_AREAS: Area[] = ["reports", "accounting"];
