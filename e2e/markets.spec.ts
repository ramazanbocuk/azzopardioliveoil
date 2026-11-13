import { expect, test } from "@playwright/test";
import { totpCode } from "../src/server/totp";
import { E2E_ADMIN } from "./fixtures";

/**
 * Compulsory two-factor sign-in and a second currency, end to end in a real
 * browser against a production build. One test, because it is one story:
 * staff cannot use the panel until they enrol; then they open a dollar
 * market; then a customer who has parcels sent to the United States is shown
 * dollars, and only for the size that has a dollar price.
 */
test("staff must set up two-factor sign-in, then open a dollar market that customers are priced in", async ({ page }) => {
  test.setTimeout(120_000);

  // ── Sign in for the first time: nothing of the panel is shown until a second factor exists.
  await page.goto("/admin/orders");
  await page.getByLabel("Email address").fill(E2E_ADMIN.email);
  await page.getByLabel("Password").fill(E2E_ADMIN.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Set up two-factor sign-in" })).toBeVisible();
  await page.goto("/admin/orders");
  await expect(page.getByRole("heading", { name: "Set up two-factor sign-in" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Admin" })).toHaveCount(0);

  await page.getByRole("button", { name: "Start" }).click();
  const key = (await page.locator("code").innerText()).replace(/\s/g, "");
  expect(key).toMatch(/^[A-Z2-7]{32}$/);
  // A wrong code is refused, with the reason on the same screen.
  await page.getByLabel("Code from the app").fill("000000");
  await page.getByRole("button", { name: "Finish" }).click();
  await expect(page.getByText("That code is not right")).toBeVisible();
  await page.getByLabel("Code from the app").fill(totpCode(key, Date.now()));
  await page.getByRole("button", { name: "Finish" }).click();
  await expect(page.getByRole("navigation", { name: "Admin" })).toBeVisible();
  await expect(page.getByText("Two-factor sign-in is on for you")).toBeVisible();

  // ── A dollar price for one size only.
  await page.goto("/admin/products");
  await page.getByRole("link", { name: "Extra Virgin Olive Oil" }).first().click();
  const firstSize = page.locator("form", { has: page.getByLabel("Price (USD)") }).first();
  const sku = await firstSize.getByLabel("SKU").inputValue();
  await firstSize.getByLabel("Price (USD)").fill("21.00");
  await firstSize.getByRole("button", { name: "Save" }).click();
  await expect(page.locator("form", { has: page.getByLabel("Price (USD)") }).first().getByLabel("Price (USD)")).toHaveValue("21.00");

  // ── A shipping zone whose rates are dollar amounts.
  await page.goto("/admin/shipping");
  const newZone = page.locator("form", { has: page.getByRole("button", { name: "Create zone" }) });
  await newZone.getByLabel("Zone name").fill("United States");
  await newZone.getByLabel("Countries").fill("US");
  await newZone.getByLabel("Rates are in").selectOption("USD");
  await newZone.getByRole("button", { name: "Create zone" }).click();
  const newRate = page.locator("form", { has: page.getByLabel("Price (USD)") }).last();
  await newRate.getByLabel("New rate").fill("Airmail");
  await newRate.getByLabel("Price (USD)").fill("15.00");
  await newRate.getByRole("button", { name: "Add" }).click();
  await expect(page.getByLabel("Rate name").last()).toHaveValue("Airmail");

  // ── The market itself.
  await page.goto("/admin/markets");
  await expect(page.getByText("Euro (base)")).toBeVisible();
  const newMarket = page.locator("form", { has: page.getByRole("button", { name: "Add market" }) });
  await newMarket.locator("[name=name]").fill("United States");
  await newMarket.locator("[name=code]").fill("us");
  await newMarket.locator("[name=currency]").selectOption("USD");
  await newMarket.locator("[name=countries]").fill("US");
  await newMarket.getByRole("button", { name: "Add market" }).click();
  await expect(page.getByRole("heading", { name: "United States · USD" })).toBeVisible();
  await expect(page.getByText(/cannot be bought in this market: no price in USD/)).toBeVisible(); // the sizes with no dollar price are named
  await expect(page.getByText(/No shipping zone in USD/)).toHaveCount(0);

  // ── A customer. Euro until they say where the parcel goes.
  await page.goto("/en/shop");
  await expect(page.getByText("€18.00").first()).toBeVisible();
  await page.getByRole("contentinfo").getByRole("button", { name: /English \(International\)/ }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Deliver to").selectOption("US");
  await dialog.getByRole("button", { name: "Apply" }).click();
  await expect(page.getByText("$21.00").first()).toBeVisible();
  await expect(page.getByText("€18.00")).toHaveCount(0);
  await expect(page.getByText("Not available for delivery to your country.").first()).toBeVisible(); // the sizes with no dollar price

  // The cart and the checkout are in dollars, with the dollar shipping rate.
  await page.goto("/en/products/extra-virgin-olive-oil");
  await expect(page.locator("p[aria-live=polite]").first()).toHaveText("$21.00");
  // Wait for the server to answer before leaving the page: the cart lives there, not in the browser.
  const [answer] = await Promise.all([page.waitForResponse((response) => response.url().includes("/api/graphql") && (response.request().postData() ?? "").includes("cartAdd")), page.getByRole("button", { name: "Add to cart" }).click()]);
  expect((await answer.json()).data.cartAdd.currency).toBe("USD");
  await page.goto("/en/cart");
  await expect(page.getByText("$21.00").first()).toBeVisible();
  await page.goto("/en/checkout");
  await expect(page.getByText("Airmail")).toBeVisible();
  await expect(page.getByText("$15.00").first()).toBeVisible();
  await expect(page.getByText("$36.00")).toBeVisible();
  expect(sku).not.toBe("");
});
