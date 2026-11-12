import { beforeEach, describe, expect, it } from "vitest";
import { adminSchema } from "@/graphql/admin";
import { createServer } from "@/graphql/server";
import { storefrontSchema } from "@/graphql/storefront";
import { code, createAdmin, createClient, db, resetDb, seedCatalog } from "../helpers";

const server = createServer(adminSchema);
const client = () => createClient(server, "/api/admin/graphql");

const LOGIN = `mutation ($e: String!, $p: String!) { login(email: $e, password: $p) { role } }`;
const ADJUST = `mutation ($d: Int!) { adjustInventory(sku: "t-500", delta: $d, reason: RECEIVED, note: "delivery") { stock available } }`;

async function signedIn(role: "ADMINISTRATOR" | "MANAGER" | "STAFF") {
  const { email, password } = await createAdmin(role);
  const c = client();
  await c.gql(LOGIN, { e: email, p: password });
  return c;
}

beforeEach(async () => {
  await resetDb();
  await seedCatalog();
});

describe("admin API", () => {
  it("is closed to anonymous callers", async () => {
    const c = client();
    expect(code(await c.gql(`{ products { name } }`))).toBe("UNAUTHENTICATED");
    expect(code(await c.gql(ADJUST, { d: 5 }))).toBe("UNAUTHENTICATED");
  });

  it("does not accept a customer session as an admin session", async () => {
    const shop = createClient(createServer(storefrontSchema));
    await shop.gql(`mutation ($input: RegisterInput!) { register(input: $input) { id } }`, { input: { email: "c@example.com", password: "a long enough password", firstName: "C", lastName: "C" } });
    const c = client();
    c.jar.set("azz_admin", shop.jar.get("azz_session") ?? "");
    c.jar.set("azz_session", shop.jar.get("azz_session") ?? "");
    expect(code(await c.gql(`{ products { name } }`))).toBe("UNAUTHENTICATED");
  });

  it("signs in with a strict cookie and records it in the audit log", async () => {
    const { email, password } = await createAdmin("STAFF");
    const c = client();
    expect(code(await c.gql(LOGIN, { e: email, p: "the wrong password" }))).toBe("INVALID_CREDENTIALS");
    const ok = await c.gql<{ login: { role: string } }>(LOGIN, { e: email, p: password });
    expect(ok.data?.login.role).toBe("STAFF");
    expect(ok.setCookies.find((cookie) => cookie.startsWith("azz_admin="))).toMatch(/HttpOnly; SameSite=Strict/);
    expect((await db.auditLog.findMany({ orderBy: { createdAt: "asc" } })).map((row) => row.action)).toEqual(["admin.login.failed", "admin.login"]);
  });

  it("lets staff read stock but not change it", async () => {
    const staff = await signedIn("STAFF");
    const products = await staff.gql<{ products: { name: string; isVisible: boolean; variants: { stock: number }[] }[] }>(`{ products { name isVisible variants { stock } } }`);
    expect(products.data?.products.map((p) => p.name).sort()).toEqual(["Hidden Oil", "Test Oil"]); // hidden products are visible to staff
    expect(code(await staff.gql(ADJUST, { d: 5 }))).toBe("FORBIDDEN");
    expect((await db.variant.findUniqueOrThrow({ where: { sku: "t-500" } })).stock).toBe(10);
  });

  it("lets a manager adjust stock, with a ledger entry and an audit record", async () => {
    const manager = await signedIn("MANAGER");
    const adjusted = await manager.gql<{ adjustInventory: { stock: number; available: number } }>(ADJUST, { d: 12 });
    expect(adjusted.data?.adjustInventory).toEqual({ stock: 22, available: 22 });
    expect(await db.inventoryMovement.findFirstOrThrow()).toMatchObject({ delta: 12, reason: "RECEIVED", note: "delivery" });
    expect(await db.auditLog.findFirstOrThrow({ where: { action: "inventory.adjust" } })).toMatchObject({ actorType: "admin", entity: "Variant" });
  });

  it("will not take stock below what unpaid orders are holding", async () => {
    await db.variant.update({ where: { sku: "t-500" }, data: { reserved: 4 } });
    const manager = await signedIn("MANAGER");
    expect(code(await manager.gql(ADJUST, { d: -7 }))).toBe("BAD_INPUT");
    expect((await manager.gql<{ adjustInventory: { stock: number } }>(ADJUST, { d: -6 })).data?.adjustInventory.stock).toBe(4);
  });

  it("ends the session on sign-out and locks out deactivated users", async () => {
    const admin = await signedIn("ADMINISTRATOR");
    await db.adminUser.updateMany({ data: { isActive: false } });
    expect(code(await admin.gql(`{ products { name } }`))).toBe("UNAUTHENTICATED");
    await db.adminUser.updateMany({ data: { isActive: true } });
    await admin.gql(`mutation { logout }`);
    expect(await db.adminSession.count()).toBe(0);
    expect(code(await admin.gql(`{ products { name } }`))).toBe("UNAUTHENTICATED");
  });
});
