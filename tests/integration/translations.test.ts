import { beforeEach, describe, expect, it } from "vitest";
import { createServer } from "@/graphql/server";
import { storefrontSchema } from "@/graphql/storefront";
import type { Ctx } from "@/server/context";
import { customerConfirmationEmail, customerRefundEmail, customerShippedEmail, newsletterConfirmEmail, passwordResetEmail } from "@/server/notifications/messages";
import { getTranslation, publishTranslation, publishedLanguages, saveTranslationDraft, translationOverview, unpublishTranslation } from "@/server/translations";
import { code, createAdmin, createClient, db, resetDb, seedCatalog } from "../helpers";

const server = createServer(storefrontSchema);
const ADDRESS = { firstName: "Greta", lastName: "Kunde", line1: "Teststraße 1", postalCode: "10115", city: "Berlin", countryCode: "BE" };

async function staff(role: "ADMINISTRATOR" | "MANAGER" | "STAFF"): Promise<Ctx> {
  const { email } = await createAdmin(role);
  return { db, ip: "10.9.9.9", userAgent: null, cookies: {}, setCookies: [], customer: null, admin: await db.adminUser.findUniqueOrThrow({ where: { email } }) };
}
const refused = async (promise: Promise<unknown>, expected: string) => expect(await promise.then(() => "resolved", (error: { code?: string }) => error.code)).toBe(expected);
const page = (locale: string) => ({ "x-azz-locale": locale });
const NAME = `{ product(slug: "evoo") { name blurb category { name } } }`;

let productId: string;
let standardRateId: string;

beforeEach(async () => {
  await resetDb();
  const seeded = await seedCatalog();
  productId = seeded.product.id;
  standardRateId = seeded.standardRateId;
  await db.product.update({ where: { id: productId }, data: { blurb: "Pressed in autumn." } });
});

describe("translating a product", () => {
  it("shows customers nothing until a manager publishes", async () => {
    const [editor, manager] = [await staff("STAFF"), await staff("MANAGER")];
    const shop = createClient(server);
    const german = async () => (await shop.gql<{ product: { name: string; blurb: string } }>(NAME, undefined, page("de-de"))).data?.product;

    expect(await german()).toMatchObject({ name: "Test Oil", blurb: "Pressed in autumn." });

    await saveTranslationDraft(editor, "product", productId, "de", { name: "Testöl", blurb: "Im Herbst gepresst.", unknownField: "ignored" });
    expect(await german()).toMatchObject({ name: "Test Oil" }); // a draft is not for customers
    await refused(publishTranslation(editor, "product", productId, "de"), "FORBIDDEN");

    await publishTranslation(manager, "product", productId, "de");
    expect(await german()).toEqual({ name: "Testöl", blurb: "Im Herbst gepresst.", category: { name: "Oil" } });
    // Other languages, and pages that send no language, are untouched.
    expect((await shop.gql<{ product: { name: string } }>(NAME, undefined, page("fr-fr"))).data?.product.name).toBe("Test Oil");
    expect((await shop.gql<{ product: { name: string } }>(NAME)).data?.product.name).toBe("Test Oil");
    expect((await shop.gql<{ product: { name: string } }>(NAME, undefined, page("xx-yy"))).data?.product.name).toBe("Test Oil");

    // A later draft waits for its own publication.
    await saveTranslationDraft(editor, "product", productId, "de", { name: "Testöl NEU" });
    expect((await german())?.name).toBe("Testöl");
    expect((await getTranslation(editor, "product", productId, "de")).state).toBe("changed");

    await unpublishTranslation(manager, "product", productId, "de");
    expect((await german())?.name).toBe("Test Oil");
    expect((await getTranslation(editor, "product", productId, "de")).draft.name).toBe("Testöl NEU"); // the work is kept
  });

  it("refuses to publish without a name, in English, or for a record that is gone", async () => {
    const manager = await staff("MANAGER");
    await saveTranslationDraft(manager, "product", productId, "nl", { blurb: "Alleen een ondertitel." });
    await refused(publishTranslation(manager, "product", productId, "nl"), "BAD_INPUT");
    await refused(publishTranslation(manager, "product", productId, "it"), "BAD_INPUT"); // nothing saved yet
    await refused(saveTranslationDraft(manager, "product", productId, "en", { name: "x" }), "BAD_INPUT");
    await refused(saveTranslationDraft(manager, "product", productId, "tlh", { name: "x" }), "BAD_INPUT");
    await refused(saveTranslationDraft(manager, "order", productId, "de", { name: "x" }), "NOT_FOUND");
    await refused(saveTranslationDraft(manager, "product", "missing", "de", { name: "x" }), "NOT_FOUND");
    await refused(saveTranslationDraft(manager, "product", productId, "de", { name: "x".repeat(121) }), "BAD_INPUT");
    await refused(translationOverview({ ...manager, admin: null }), "UNAUTHENTICATED");
    expect(await db.translation.count({ where: { NOT: { publishedAt: null } } })).toBe(0);
  });

  it("flags a translation when the English it was made from changes", async () => {
    const manager = await staff("MANAGER");
    await saveTranslationDraft(manager, "product", productId, "fr", { name: "Huile d’essai" });
    await publishTranslation(manager, "product", productId, "fr");
    expect((await getTranslation(manager, "product", productId, "fr")).state).toBe("published");

    await db.product.update({ where: { id: productId }, data: { blurb: "Pressed in early autumn, unfiltered." } });
    expect((await getTranslation(manager, "product", productId, "fr")).state).toBe("outdated");

    const overview = await translationOverview(manager);
    const products = overview.groups.find((group) => group.entity === "product")?.records ?? [];
    expect(products.find((record) => record.id === productId)?.states).toMatchObject({ fr: "outdated", de: "missing" });
    expect(overview.totals.fr).toMatchObject({ live: 1, attention: 1 });
    expect(overview.totals.de.live).toBe(0);
    expect((await publishedLanguages(db, "product")).get(productId)).toEqual(["en", "fr"]);
  });

  it("keeps a history of who saved and published what", async () => {
    const [editor, manager] = [await staff("STAFF"), await staff("MANAGER")];
    await saveTranslationDraft(editor, "category", (await db.category.findFirstOrThrow()).id, "es", { name: "Aceite" });
    const categoryId = (await db.category.findFirstOrThrow()).id;
    await publishTranslation(manager, "category", categoryId, "es");
    const { history } = await getTranslation(manager, "category", categoryId, "es");
    expect(history.map((entry) => [entry.action, entry.by, entry.fields.name]).reverse()).toEqual([["draft", "STAFF", "Aceite"], ["publish", "MANAGER", "Aceite"]]);
    expect((await db.auditLog.findMany({ where: { entity: "Translation" }, orderBy: { createdAt: "asc" } })).map((log) => log.action)).toEqual(["translation.draft", "translation.publish"]);
    const shop = createClient(server);
    expect((await shop.gql<{ product: { category: { name: string } } }>(NAME, undefined, page("es-es"))).data?.product.category.name).toBe("Aceite");
  });
});

describe("the customer's language", () => {
  it("remembers an explicit choice on the device and on the account", async () => {
    const c = createClient(server);
    const chosen = await c.gql(`mutation { setLanguage(locale: "nl-be") }`);
    expect(chosen.setCookies.join()).toMatch(/azz_locale=nl-be; Path=\/; SameSite=Lax; Max-Age=31536000/);
    expect(chosen.setCookies.join()).not.toMatch(/azz_locale=[^;]+;[^,]*HttpOnly/); // the page must be able to see that a choice exists
    expect(code(await c.gql(`mutation { setLanguage(locale: "pirate") }`))).toBe("BAD_INPUT");

    await c.gql(`mutation ($i: RegisterInput!) { register(input: $i) { id } }`, { i: { email: "greta@example.com", password: "a long enough password", firstName: "Greta", lastName: "Kunde" } }, page("de-de"));
    expect((await db.customer.findFirstOrThrow()).locale).toBe("de-de"); // the language she registered in
    await c.gql(`mutation { setLanguage(locale: "fr-be") }`);
    expect((await db.customer.findFirstOrThrow()).locale).toBe("fr-be");

    // On a new device with no choice yet, signing in brings the saved language along; an existing choice is respected.
    const fresh = createClient(server);
    const signedIn = await fresh.gql(`mutation { login(email: "greta@example.com", password: "a long enough password") { id } }`);
    expect(signedIn.setCookies.join()).toContain("azz_locale=fr-be");
    const decided = createClient(server);
    await decided.gql(`mutation { setLanguage(locale: "it-it") }`);
    const again = await decided.gql(`mutation { login(email: "greta@example.com", password: "a long enough password") { id } }`);
    expect(again.setCookies.join()).not.toContain("azz_locale=");
  });

  it("stores the language with the order and writes every email in it", async () => {
    const c = createClient(server);
    await c.gql(`mutation { cartAdd(sku: "t-500", quantity: 2) { itemCount } }`, undefined, page("de-de"));
    const placed = await c.gql<{ checkout: { number: string } }>(`mutation ($input: CheckoutInput!) { checkout(input: $input) { number } }`, { input: { email: "greta@example.com", shippingRateId: standardRateId, address: ADDRESS } }, page("de-de"));
    expect(placed.errors).toBeUndefined();
    const order = await db.order.findFirstOrThrow({ include: { items: true } });
    expect(order.locale).toBe("de-de");

    const confirmation = customerConfirmationEmail(order);
    expect(confirmation.subject).toBe(`Ihre Azzopardi-Bestellung ${order.number}`);
    expect(confirmation.text).toContain(`Vielen Dank, Greta. Wir haben Ihre Zahlung für die Bestellung ${order.number} erhalten.`);
    expect(confirmation.text).toContain("Belgien"); // country names too
    expect(confirmation.text).toContain("http://localhost:3000/de-de/order-tracking");
    expect(confirmation.text.replace(/\s/g, " ")).toContain("Gesamt: 42,95 €");
    expect(confirmation.html).toContain(`<strong>${order.number}</strong>`);

    const shipped = customerShippedEmail({ ...order, locale: "nl-be" }, { carrier: "bpost", trackingNumber: "3232", trackingUrl: null } as never);
    expect(shipped.subject).toBe(`Uw Azzopardi-bestelling ${order.number} is onderweg`);
    expect(shipped.text).toContain("Trackingnummer: 3232");

    expect(customerRefundEmail({ ...order, locale: "fr-fr" }, 1000, false).text.replace(/\s/g, " ")).toContain(`Nous avons remboursé 10,00 € sur votre commande ${order.number}.`);
    expect(customerRefundEmail({ ...order, locale: "es-es" }, order.totalCents, true).subject).toBe(`Reembolso de su pedido ${order.number}`);

    // Orders from before languages existed, and nonsense, fall back to English.
    for (const legacy of ["en", "", "zz"]) expect(customerConfirmationEmail({ ...order, locale: legacy }).subject).toBe(`Your Azzopardi order ${order.number}`);
  });

  it("writes account and newsletter emails in the saved language, with links into that language", async () => {
    process.env.APP_SECRET = "test-only-secret-test-only-secret-1234";
    const c = createClient(server);
    await c.gql(`mutation { subscribeNewsletter(email: "lettore@example.com") }`, undefined, page("it-it"));
    const subscriber = await db.newsletterSubscriber.findFirstOrThrow();
    expect(subscriber.locale).toBe("it-it");
    const confirm = newsletterConfirmEmail(subscriber);
    expect(confirm?.subject).toBe("Conferma l’iscrizione alle nostre lettere");
    expect(confirm?.text).toContain("http://localhost:3000/it-it/newsletter?action=confirm");

    const reset = passwordResetEmail({ id: "c1", email: "a@b.co", firstName: "Ana", passwordHash: "hash", locale: "es-es" });
    expect(reset?.subject).toBe("Restablezca su contraseña de Azzopardi");
    expect(reset?.text).toContain("http://localhost:3000/es-es/account/reset?id=c1");
    expect(passwordResetEmail({ id: "c1", email: "a@b.co", firstName: "Ann", passwordHash: "hash" })?.subject).toBe("Reset your Azzopardi password");
  });
});
