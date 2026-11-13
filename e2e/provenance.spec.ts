import { expect, test } from "@playwright/test";

/**
 * Half of acceptance test 3 of the platform brief, without the assistant:
 * where no laboratory value has been verified, the shop says so and shows
 * no figure. (The verification rules themselves are integration-tested.)
 */
test("a product with no verified laboratory result says so and shows no figure", async ({ page }) => {
  await page.goto("/en/products/extra-virgin-olive-oil");
  const lab = page.getByRole("region", { name: "Measured, lot by lot." });
  await expect(lab.getByText("No verified laboratory results have been published for the current lot yet.")).toBeVisible();
  await expect(lab.getByRole("table")).toHaveCount(0);
  await expect(lab).not.toContainText("mg/kg");

  // Origin and tasting fields nobody has entered are dashes, not guesses.
  await page.getByText("Origin & harvest").click();
  const origin = page.locator("details", { hasText: "Origin & harvest" });
  for (const label of ["Country of origin", "Region", "Producer", "Harvest year", "Extraction"]) {
    await expect(origin.locator("div", { has: page.getByText(label, { exact: true }) }).last().locator("dd")).toHaveText("—");
  }

  await page.goto("/de-de/products/extra-virgin-olive-oil");
  await expect(page.getByRole("region", { name: "Gemessen, Charge für Charge." }).getByText("Für die aktuelle Charge sind noch keine geprüften Laborergebnisse veröffentlicht.")).toBeVisible();
});

test("a certificate that does not exist, or is not verified, is not served", async ({ request }) => {
  expect((await request.get("/media/certificate/cmwc55wop0001fu8odswef46d")).status()).toBe(404);
  expect((await request.get("/media/certificate/not-an-id")).status()).toBe(404);
});
