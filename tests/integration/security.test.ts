import { beforeEach, describe, expect, it } from "vitest";
import { createServer } from "@/graphql/server";
import { storefrontSchema } from "@/graphql/storefront";
import { processJobs, purgeExpired } from "@/server/jobs";
import type { Transport } from "@/server/notifications/channels";
import nextConfig from "../../next.config";
import { code, createClient, db, resetDb, seedCatalog } from "../helpers";

const server = createServer(storefrontSchema);
const client = () => createClient(server);
const ENV = { RESEND_API_KEY: "re_test_placeholder", EMAIL_FROM: "shop@example.com" };
const account = { email: "ada@example.com", password: "the original password", firstName: "Ada", lastName: "L" };
const REGISTER = `mutation ($input: RegisterInput!) { register(input: $input) { id } }`;
const LOGIN = `mutation ($e: String!, $p: String!) { login(email: $e, password: $p) { id } }`;
const RESET = `mutation ($id: String!, $exp: String!, $sig: String!, $password: String!) { resetPassword(id: $id, exp: $exp, sig: $sig, password: $password) }`;

/** Requests a reset and returns the link parameters from the email that would be sent. */
async function resetLink(email = account.email) {
  await client().gql(`mutation ($e: String!) { requestPasswordReset(email: $e) }`, { e: email });
  const sent: string[] = [];
  const transport: Transport = async (_url, init) => {
    sent.push(JSON.parse(init.body).text as string);
    return { ok: true, status: 200, text: async () => "" };
  };
  await processJobs(db, { env: ENV, transport });
  if (sent.length === 0) return null;
  const url = new URL(sent[0].split("\n").find((line) => line.startsWith("http")) ?? "");
  return { id: url.searchParams.get("id") ?? "", exp: url.searchParams.get("exp") ?? "", sig: url.searchParams.get("sig") ?? "" };
}

beforeEach(async () => {
  await resetDb();
  await seedCatalog();
  process.env.APP_SECRET = "s".repeat(40);
});

describe("password reset", () => {
  it("answers identically for known and unknown addresses, and emails only real accounts", async () => {
    await client().gql(REGISTER, { input: account });
    const request = `mutation ($e: String!) { requestPasswordReset(email: $e) }`;
    const known = await client().gql<{ requestPasswordReset: boolean }>(request, { e: account.email });
    const unknown = await client().gql<{ requestPasswordReset: boolean }>(request, { e: "nobody@example.com" });
    expect(known.data).toEqual(unknown.data);
    expect(await db.outboxJob.count()).toBe(1);
  });

  it("changes the password, signs out every device, and works only once", async () => {
    const owner = client();
    await owner.gql(REGISTER, { input: account });
    const link = await resetLink();
    expect(link).not.toBeNull();

    expect(code(await client().gql(RESET, { ...link, password: "short" }))).toBe("BAD_INPUT");
    const changed = await client().gql<{ resetPassword: boolean }>(RESET, { ...link, password: "a brand new password" });
    expect(changed.data?.resetPassword).toBe(true);

    expect((await owner.gql<{ me: null }>(`{ me { id } }`)).data?.me).toBeNull(); // old session is gone
    expect(code(await client().gql(LOGIN, { e: account.email, p: account.password }))).toBe("INVALID_CREDENTIALS");
    expect((await client().gql(LOGIN, { e: account.email, p: "a brand new password" })).errors).toBeUndefined();
    expect(code(await client().gql(RESET, { ...link, password: "yet another password" }))).toBe("BAD_INPUT"); // link is dead
  });

  it("rejects forged, altered and expired links", async () => {
    await client().gql(REGISTER, { input: account });
    await client().gql(REGISTER, { input: { ...account, email: "eve@example.com" } });
    const link = await resetLink("eve@example.com");
    const victim = await db.customer.findUniqueOrThrow({ where: { email: account.email } });
    if (!link) throw new Error("no link");

    const attempt = (override: Record<string, string>) => client().gql(RESET, { ...link, password: "an attacker password", ...override });
    expect(code(await attempt({ id: victim.id }))).toBe("BAD_INPUT"); // someone else's account
    expect(code(await attempt({ exp: String(Number(link.exp) + 3_600_000) }))).toBe("BAD_INPUT"); // extended expiry
    expect(code(await attempt({ sig: "x".repeat(43) }))).toBe("BAD_INPUT");
    const past = String(Date.now() - 1000);
    expect(code(await attempt({ exp: past }))).toBe("BAD_INPUT");
    expect((await client().gql(LOGIN, { e: account.email, p: account.password })).errors).toBeUndefined(); // victim untouched
  });

  it("limits how many reset emails one address can trigger", async () => {
    await client().gql(REGISTER, { input: account });
    const request = `mutation ($e: String!) { requestPasswordReset(email: $e) }`;
    const results = [];
    for (let i = 0; i < 4; i++) results.push(code(await client().gql(request, { e: account.email })));
    expect(results).toEqual([undefined, undefined, undefined, "RATE_LIMITED"]);
    expect(await db.outboxJob.count()).toBe(1); // and only one email is queued in any ten minutes
  });
});

describe("customer data rights", () => {
  it("exports the customer's own data and nothing about anyone else", async () => {
    const ada = client();
    await ada.gql(REGISTER, { input: account });
    await client().gql(REGISTER, { input: { ...account, email: "other@example.com", firstName: "Other" } });
    expect(code(await client().gql(`{ myData }`))).toBe("UNAUTHENTICATED");

    const exported = JSON.parse((await ada.gql<{ myData: string }>(`{ myData }`)).data?.myData ?? "{}");
    expect(exported.account).toMatchObject({ email: "ada@example.com", firstName: "Ada" });
    expect(JSON.stringify(exported)).not.toContain("other@example.com");
    expect(JSON.stringify(exported)).not.toMatch(/passwordHash|argon2|tokenHash/);
  });

  it("deletes the account only with the right password, and keeps the orders", async () => {
    const ada = client();
    await ada.gql(REGISTER, { input: account });
    const customer = await db.customer.findUniqueOrThrow({ where: { email: account.email } });
    await db.order.create({ data: { customerId: customer.id, email: account.email, subtotalCents: 1, shippingCents: 0, totalCents: 1, shippingRateName: "S", weightGrams: 1, shipFirstName: "A", shipLastName: "L", shipLine1: "S", shipPostalCode: "1", shipCity: "B", shipCountryCode: "BE" } });

    const remove = `mutation ($p: String!) { deleteMyAccount(password: $p) }`;
    expect(code(await client().gql(remove, { p: account.password }))).toBe("UNAUTHENTICATED");
    expect(code(await ada.gql(remove, { p: "not my password" }))).toBe("INVALID_CREDENTIALS");
    expect((await ada.gql<{ deleteMyAccount: boolean }>(remove, { p: account.password })).data?.deleteMyAccount).toBe(true);

    expect((await ada.gql<{ me: null }>(`{ me { id } }`)).data?.me).toBeNull();
    expect(code(await client().gql(LOGIN, { e: account.email, p: account.password }))).toBe("INVALID_CREDENTIALS");
    expect(await db.customer.findUniqueOrThrow({ where: { id: customer.id } })).toMatchObject({ firstName: "Erased", passwordHash: "erased" });
    expect((await db.order.findFirstOrThrow()).customerId).toBeNull();
    expect((await db.auditLog.findFirstOrThrow({ where: { action: "customer.self_erase" } })).actorType).toBe("customer");
  });
});

describe("housekeeping and headers", () => {
  it("purges expired sessions, stale counters and old carts, and nothing current", async () => {
    const customer = await db.customer.create({ data: { email: "c@example.com", passwordHash: "x", firstName: "C", lastName: "D" } });
    const old = new Date(Date.now() - 100 * 86_400_000);
    await db.customerSession.createMany({ data: [{ tokenHash: "old", customerId: customer.id, expiresAt: old }, { tokenHash: "live", customerId: customer.id, expiresAt: new Date(Date.now() + 86_400_000) }] });
    await db.rateLimit.createMany({ data: [{ key: "old", count: 1, windowStart: old }, { key: "live", count: 1, windowStart: new Date() }] });
    await db.cart.create({ data: { tokenHash: "live-cart" } });
    await db.$executeRaw`INSERT INTO "Cart" ("id", "tokenHash", "createdAt", "updatedAt") VALUES ('old-cart', 'old-cart', ${old}, ${old})`;

    expect(await purgeExpired(db)).toEqual({ sessions: 1, counters: 1, carts: 1, jobs: 0 });
    expect([await db.customerSession.count(), await db.rateLimit.count(), await db.cart.count()]).toEqual([1, 1, 1]);
  });

  it("sends the security headers on every page and stricter ones where tokens appear", async () => {
    const rules = (await nextConfig.headers?.()) ?? [];
    const of = (source: string) => Object.fromEntries((rules.find((rule) => rule.source === source)?.headers ?? []).map((h) => [h.key, h.value]));
    const all = of("/:path*");
    expect(all["Content-Security-Policy"]).toContain("frame-ancestors 'none'");
    expect(all["Content-Security-Policy"]).toContain("object-src 'none'");
    expect(all["Content-Security-Policy"]).not.toMatch(/https?:\/\//); // no third-party origins at all
    expect(all).toMatchObject({ "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY", "Referrer-Policy": "strict-origin-when-cross-origin" });
    expect(of("/order-confirmation")["Referrer-Policy"]).toBe("no-referrer");
    expect(of("/account/reset")["Referrer-Policy"]).toBe("no-referrer");
    expect(of("/admin/:path*")["Cache-Control"]).toBe("private, no-store");
    expect(nextConfig.poweredByHeader).toBe(false);
  });
});
