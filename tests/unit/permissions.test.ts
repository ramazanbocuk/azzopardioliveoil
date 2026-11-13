import { describe, expect, it } from "vitest";
import { AREAS, ROLES, ROLE_ORDER, can, levelOf } from "@/server/permissions";

describe("staff permissions", () => {
  it("defines all nine roles of the brief, plus the two kept for existing accounts", () => {
    expect([...ROLE_ORDER].sort()).toEqual(Object.keys(ROLES).sort());
    for (const role of ["SUPER_ADMINISTRATOR", "ADMINISTRATOR", "OPERATIONS_MANAGER", "WAREHOUSE_MANAGER", "SHIPPING_MANAGER", "CUSTOMER_SUPPORT", "ACCOUNTANT", "MARKETING_MANAGER", "ANALYST"] as const) expect(ROLES[role].label).toBeTruthy();
  });

  it("keeps the accounts created before the nine roles exactly as they were", () => {
    for (const area of AREAS.filter((area) => area !== "security")) {
      expect(levelOf("STAFF", area)).toBe(2);
      expect(levelOf("MANAGER", area)).toBe(3);
      expect(levelOf("ADMINISTRATOR", area)).toBe(4);
    }
  });

  it("lets only administrators and the accountant move money out", () => {
    const refunders = ROLE_ORDER.filter((role) => can(role, "ADMINISTRATOR", "payments"));
    expect(refunders.sort()).toEqual(["ACCOUNTANT", "ADMINISTRATOR", "SUPER_ADMINISTRATOR"]);
  });

  it("lets only administrators manage staff, settings and other people's security", () => {
    for (const area of ["staff", "settings"] as const) expect(ROLE_ORDER.filter((role) => can(role, "ADMINISTRATOR", area)).sort()).toEqual(["ADMINISTRATOR", "SUPER_ADMINISTRATOR"]);
    expect(ROLE_ORDER.filter((role) => can(role, "ADMINISTRATOR", "security")).sort()).toEqual(["ADMINISTRATOR", "SUPER_ADMINISTRATOR"]);
    expect(ROLE_ORDER.every((role) => can(role, "STAFF", "security"))).toBe(true); // everyone manages their own two-factor sign-in
  });

  it("gives the read-only analyst nothing to change", () => {
    const writable = AREAS.filter((area) => !["reports", "accounting", "security"].includes(area) && can("ANALYST", "STAFF", area));
    expect(writable).toEqual([]);
    expect(can("ANALYST", "VIEW", "orders")).toBe(true);
    expect(can("ANALYST", "MANAGER", "reports")).toBe(true); // reports are read-only: this level only allows exporting
    expect(can("ANALYST", "VIEW", "staff")).toBe(false);
  });

  it("keeps each specialist inside their own part of the business", () => {
    expect(can("WAREHOUSE_MANAGER", "MANAGER", "inventory")).toBe(true);
    expect(can("WAREHOUSE_MANAGER", "VIEW", "payments")).toBe(false);
    expect(can("WAREHOUSE_MANAGER", "VIEW", "reports")).toBe(false);
    expect(can("SHIPPING_MANAGER", "MANAGER", "shipping")).toBe(true);
    expect(can("SHIPPING_MANAGER", "MANAGER", "catalog")).toBe(false);
    expect(can("CUSTOMER_SUPPORT", "STAFF", "orders")).toBe(true);
    expect(can("CUSTOMER_SUPPORT", "ADMINISTRATOR", "payments")).toBe(false);
    expect(can("CUSTOMER_SUPPORT", "MANAGER", "returns")).toBe(true);
    expect(can("ACCOUNTANT", "MANAGER", "accounting")).toBe(true);
    expect(can("ACCOUNTANT", "STAFF", "orders")).toBe(false);
    expect(can("MARKETING_MANAGER", "MANAGER", "discounts")).toBe(true);
    expect(can("MARKETING_MANAGER", "VIEW", "payments")).toBe(false);
    expect(can("OPERATIONS_MANAGER", "MANAGER", "orders")).toBe(true);
    expect(can("OPERATIONS_MANAGER", "ADMINISTRATOR", "payments")).toBe(false);
    expect(can("OPERATIONS_MANAGER", "ADMINISTRATOR", "staff")).toBe(false);
  });
});
