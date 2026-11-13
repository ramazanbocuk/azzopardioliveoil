import { expect, test, type Page } from "@playwright/test";

/**
 * Acceptance tests 1 and 2 of the platform brief: language by country and
 * browser, the visitor's own choice, and the delivery country kept separate.
 * The visitor's country is what the host reports in a request header.
 */

const from = (country: string) => ({ "x-vercel-ip-country": country });

async function chooseInSelector(page: Page, open: string, language: { label: string; value: string }, apply: string, shipTo?: { label: string; value: string }) {
  // The footer's selector: the header tucks away once a page has been scrolled.
  await page.getByRole("contentinfo").getByRole("button", { name: open }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByLabel(language.label, { exact: true }).selectOption(language.value);
  if (shipTo) await dialog.getByLabel(shipTo.label).selectOption(shipTo.value);
  await dialog.getByRole("button", { name: apply }).click();
}

test.describe("a visitor from Germany", () => {
  test.use({ locale: "de-DE", extraHTTPHeaders: from("DE") });

  test("sees German, can switch to English, keeps that choice, and picks a delivery country separately", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/de-de$/);
    await expect(page.locator("html")).toHaveAttribute("lang", "de-DE");
    await expect(page.getByRole("link", { name: "Warenkorb, 0 Artikel" })).toBeVisible();

    // The shop itself is German: buttons, prices, and the address of every link.
    await page.goto("/de-de/products/extra-virgin-olive-oil");
    await expect(page.locator('p[aria-live="polite"]')).toHaveText(/18,00\s€/);
    await page.getByRole("button", { name: "In den Warenkorb" }).click();
    await expect(page.getByRole("link", { name: "Warenkorb, 1 Artikel" })).toHaveAttribute("href", "/de-de/cart");

    // Switch to English and choose France for delivery, in one step.
    await chooseInSelector(page, "Sprache und Lieferland", { label: "Sprache", value: "en" }, "Übernehmen", { label: "Lieferung nach", value: "FR" });
    await expect(page).toHaveURL(/\/en\/products\/extra-virgin-olive-oil/);
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.getByRole("button", { name: "Add to cart" })).toBeVisible();

    // The choice outlives the page: an address without a language now opens in English, although the browser and the country say German.
    await page.goto("/shop");
    await expect(page).toHaveURL(/\/en\/shop$/);
    await expect(page.getByRole("heading", { level: 1, name: "Every bottle" })).toBeVisible();

    // Delivery country is its own setting: France was chosen while the page is English, and it can be changed again without touching the language.
    await page.goto("/checkout");
    await expect(page).toHaveURL(/\/en\/checkout$/);
    const country = page.getByLabel("Country", { exact: true });
    await expect(country).toHaveValue("FR");
    await country.selectOption("DE");
    await expect(country).toHaveValue("DE");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.getByRole("group", { name: /Delivery address/ })).toBeVisible();

    // A German address typed by hand is still honoured, never bounced back.
    await page.goto("/de-de/cart");
    await expect(page).toHaveURL(/\/de-de\/cart$/);
    await expect(page.getByRole("heading", { level: 1, name: "Ihr Warenkorb" })).toBeVisible();
  });
});

test.describe("a visitor from Belgium", () => {
  test.use({ locale: "pt-PT", extraHTTPHeaders: from("BE") });

  test("is offered French and Dutch, may choose English, and keeps the choice while shopping", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/en$/); // no language is picked for Belgium
    const prompt = page.getByRole("complementary", { name: "Choose your language" });
    await expect(prompt.getByRole("button", { name: "Français" })).toBeVisible();
    await expect(prompt.getByRole("button", { name: "Nederlands" })).toBeVisible();
    await expect(prompt.getByRole("button", { name: "Keep English" })).toBeVisible();

    await prompt.getByRole("button", { name: "Nederlands" }).click();
    await expect(page).toHaveURL(/\/nl-be$/);
    await expect(page.locator("html")).toHaveAttribute("lang", "nl-BE");
    await expect(page.getByRole("complementary", { name: "Kies uw taal" })).toHaveCount(0); // asked once

    // The choice holds through the shop, the cart and the checkout.
    await page.goto("/shop");
    await expect(page).toHaveURL(/\/nl-be\/shop$/);
    await page.getByRole("article").getByRole("link", { name: "Extra Virgin Olive Oil" }).first().click();
    await expect(page).toHaveURL(/\/nl-be\/products\/extra-virgin-olive-oil/);
    await page.getByRole("button", { name: "In winkelwagen" }).click();
    await expect(page.getByRole("button", { name: "Toegevoegd" })).toBeVisible();
    await page.goto("/cart"); // no language in the address: the remembered choice decides
    await expect(page).toHaveURL(/\/nl-be\/cart$/);
    await expect(page.getByRole("heading", { level: 1, name: "Uw winkelwagen" })).toBeVisible();
    await page.getByRole("link", { name: "Afrekenen" }).click();
    await expect(page).toHaveURL(/\/nl-be\/checkout$/);

    // The order is placed in Dutch and remembers it, which is what its emails follow.
    await page.getByLabel("E-mailadres").fill("klant@example.com");
    await page.getByLabel("Voornaam").fill("Kim");
    await page.getByLabel("Achternaam").fill("Peeters");
    await page.getByLabel("Straat en huisnummer").fill("Teststraat 1");
    await page.getByLabel("Postcode").fill("1000");
    await page.getByLabel("Plaats").fill("Brussel");
    await page.getByLabel(/Ik heb de algemene voorwaarden/).check();
    await page.getByRole("button", { name: /Bestelling plaatsen/ }).click();
    await expect(page).toHaveURL(/\/nl-be\/order-confirmation\?order=AZZ-\d+&token=/);
    await expect(page.getByRole("heading", { name: "Uw bestelling wacht op betaling." })).toBeVisible();
    await expect(page.getByText("Bestelling geplaatst, wacht op betaling.")).toBeVisible(); // the server's timeline entry, translated
  });

  test("can choose English, and a French browser is taken straight to French", async ({ page, browser }) => {
    await page.goto("/shop");
    await page.getByRole("complementary", { name: "Choose your language" }).getByRole("button", { name: "Keep English" }).click();
    await expect(page.getByRole("complementary", { name: "Choose your language" })).toHaveCount(0);
    await page.goto("/");
    await expect(page).toHaveURL(/\/en$/);
    await expect(page.getByRole("complementary", { name: "Choose your language" })).toHaveCount(0);

    const french = await browser.newContext({ locale: "fr-BE", extraHTTPHeaders: from("BE") });
    const other = await french.newPage();
    await other.goto("/cart");
    await expect(other).toHaveURL(/\/fr-be\/cart$/);
    await expect(other.getByRole("heading", { level: 1, name: "Votre panier" })).toBeVisible();
    await french.close();
  });
});

test("pages still in English say so, and are not announced as translations", async ({ page }) => {
  await page.goto("/de-de/faq");
  await expect(page.locator("main")).toHaveAttribute("lang", "en");
  await expect(page.getByRole("note")).toHaveText("Diese Seite ist derzeit nur auf Englisch verfügbar.");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", /\/en\/faq$/);
  await expect(page.locator('link[rel="alternate"][hreflang="de-DE"]')).toHaveCount(0);

  await page.goto("/de-de/shop");
  await expect(page.locator("main")).not.toHaveAttribute("lang", "en");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", /\/de-de\/shop$/);
  await expect(page.locator('link[rel="alternate"][hreflang="fr-BE"]')).toHaveAttribute("href", /\/fr-be\/shop$/);
  await expect(page.locator('link[rel="alternate"][hreflang="x-default"]')).toHaveAttribute("href", /\/en\/shop$/);

  const missing = await page.goto("/de-de/gibt-es-nicht");
  expect(missing?.status()).toBe(404);
  await expect(page.getByRole("heading", { level: 1, name: "Diese Seite hat sich verirrt." })).toBeVisible();
});

test("the sitemap lists each page once per language it exists in", async ({ request }) => {
  const xml = await (await request.get("/sitemap.xml")).text();
  expect(xml).toContain("<loc>http://localhost:3100/de-de/shop</loc>");
  expect(xml).toContain('hreflang="nl-BE" href="http://localhost:3100/nl-be/shop"');
  expect(xml).toContain("<loc>http://localhost:3100/en/faq</loc>");
  expect(xml).not.toContain("/de-de/faq"); // English only, so not offered as German
  expect(xml).not.toContain("/cart");
});
