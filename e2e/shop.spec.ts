import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/** Serious and critical WCAG 2.2 A/AA problems on the current page. */
async function accessibilityProblems(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  return results.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.help} (${v.nodes.length}) e.g. ${v.nodes[0]?.target.join(" ")}`);
}

const address = async (page: Page) => {
  await page.getByLabel("Email address").fill("e2e@example.com");
  await page.getByLabel("First name").fill("End");
  await page.getByLabel("Last name").fill("Toend");
  await page.getByLabel("Street and number").fill("Teststraat 1");
  await page.getByLabel("Postal code").fill("1000");
  await page.getByLabel("City").fill("Brussels");
};

test("a visitor can buy a bottle as a guest, up to the payment step", async ({ page }) => {
  await page.goto("/products/extra-virgin-olive-oil");
  await page.getByText("1000 ml", { exact: true }).first().click();
  await expect(page.locator('p[aria-live="polite"]')).toHaveText("€32.00");
  await page.getByRole("button", { name: "Add to cart" }).click();
  await expect(page.getByRole("link", { name: "Cart, 1 item" })).toBeVisible();

  await page.goto("/cart");
  await expect(page.getByRole("heading", { name: "Extra Virgin Olive Oil" })).toBeVisible();
  await page.getByRole("button", { name: "Increase quantity" }).click();
  await expect(page.getByText("Subtotal (2 bottles)")).toBeVisible();

  await page.getByRole("link", { name: "Checkout" }).click();
  await address(page);
  await expect(page.getByText("Standard (placeholder rate)")).toBeVisible();
  await expect(page.getByText("€70.95")).toBeVisible(); // 2 × 32.00 + 6.95 shipping, computed by the server
  await page.getByLabel(/I have read the terms/).check();
  await page.getByRole("button", { name: /Place order/ }).click();

  await expect(page).toHaveURL(/\/order-confirmation\?order=AZZ-\d+&token=/);
  await expect(page.getByRole("heading", { name: "Your order is waiting for payment." })).toBeVisible();
  await expect(page.getByText("Nothing has been charged.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Cart, 0 items" })).toBeVisible();

  // The same order can be found again with its number and the right email only.
  const number = new URL(page.url()).searchParams.get("order") ?? "";
  await page.goto("/order-tracking");
  await page.getByLabel("Order number").fill(number);
  await page.getByLabel("Email address").fill("someone-else@example.com");
  await page.getByRole("button", { name: "Track order" }).click();
  await expect(page.getByText("No order matches")).toBeVisible();
  await page.getByLabel("Email address").fill("e2e@example.com");
  await page.getByRole("button", { name: "Track order" }).click();
  await expect(page.getByText("Awaiting payment", { exact: true })).toBeVisible();
});

test("a customer can register, sign out and sign back in", async ({ page }) => {
  const email = `customer-${Date.now()}@example.com`;
  await page.goto("/account");
  await page.getByRole("tab", { name: "Create account" }).click();
  await page.getByLabel("First name").fill("Ada");
  await page.getByLabel("Last name").fill("Lovelace");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill("a long enough e2e password");
  await page.getByLabel("I have read the privacy policy").check();
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByText("Ada Lovelace")).toBeVisible();
  await expect(page.getByText("No orders yet.")).toBeVisible();

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("tab", { name: "Sign in" })).toBeVisible();
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill("the wrong password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("The email address or password is incorrect.")).toBeVisible();
  await page.getByLabel("Password").fill("a long enough e2e password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Ada Lovelace")).toBeVisible();
});

test("the shop can be searched and filtered", async ({ page }) => {
  await page.goto("/shop");
  await expect(page.getByText("3 bottles")).toBeVisible();
  await page.getByRole("button", { name: "750 ml", exact: true }).click();
  await expect(page.getByText("1 bottle", { exact: true })).toBeVisible();
  await page.getByRole("searchbox", { name: "Search" }).fill("no such thing");
  await expect(page.getByText("Nothing matches those filters.")).toBeVisible();
});

test("the admin panel is closed to visitors", async ({ page, request }) => {
  await page.goto("/admin/orders");
  await expect(page.getByRole("heading", { name: "Staff sign-in" })).toBeVisible();
  await page.getByLabel("Email address").fill("intruder@example.com");
  await page.getByLabel("Password").fill("definitely-not-the-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Staff sign-in" })).toBeVisible();
  await expect(page.getByText("Dashboard")).toHaveCount(0);

  expect((await request.get("/admin/export/customers")).status()).toBe(401);
  expect((await request.get("/api/cron/jobs")).status()).toBe(401);
  const api = await request.post("/api/admin/graphql", { data: { query: "{ products { name } }" } });
  expect((await api.json()).errors[0].extensions.code).toBe("UNAUTHENTICATED");
});

test("security headers are sent and the API rejects cross-site calls", async ({ request }) => {
  const home = await request.get("/");
  const headers = home.headers();
  expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["x-frame-options"]).toBe("DENY");
  expect(headers["x-powered-by"]).toBeUndefined();
  expect((await request.get("/order-confirmation")).headers()["referrer-policy"]).toBe("no-referrer");

  const crossSite = await request.post("/api/graphql", { data: { query: "{ me { id } }" }, headers: { origin: "https://evil.example" } });
  expect(crossSite.status()).toBe(403);
});

for (const path of ["/", "/shop", "/products/extra-virgin-olive-oil", "/cart", "/account", "/contact", "/faq"]) {
  test(`accessibility: ${path} has no serious WCAG problems`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" }); // everything visible, as for a visitor who asks for no motion
    await page.goto(path);
    await expect(page.locator("h1").first()).toBeVisible();
    expect(await accessibilityProblems(page)).toEqual([]);
  });
}

test("with reduced motion, the homepage shows its content without animation", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(page.locator("html")).not.toHaveClass(/js-motion/);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Every bottle answers for itself." })).toBeVisible();
});

test("@mobile pages fit a phone screen without sideways scrolling", async ({ page }) => {
  for (const path of ["/", "/shop", "/products/extra-virgin-olive-oil", "/checkout", "/account", "/our-story"]) {
    await page.goto(path);
    await expect(page.locator("h1").first()).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `${path} overflows by ${overflow}px`).toBeLessThanOrEqual(0);
  }
});

test("@mobile the menu opens, lists every section and closes with Escape", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Menu" }).click();
  await expect(page.getByRole("navigation", { name: "Mobile" }).getByRole("link", { name: "Traceability" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("navigation", { name: "Mobile" }).getByRole("link", { name: "Traceability" })).toBeHidden();
});
