import { expect, test } from "@playwright/test";

/**
 * What a monitor and a stranger see of the system endpoints on a production
 * build: health is public and says only up or down; the detailed status
 * needs the scheduler's secret; the request proxy still lets the admin
 * panel, the APIs and files through.
 */
test("health is public, detailed status is not, and the proxy leaves the panel and files alone", async ({ request, page }) => {
  const health = await request.get("/api/health");
  expect(health.status()).toBe(200);
  expect(await health.json()).toEqual({ status: "ok" });

  expect((await request.get("/api/status")).status()).toBe(401);
  expect((await request.get("/api/status", { headers: { authorization: "Bearer not-the-secret-not-the-secret-00" } })).status()).toBe(401);

  // This build is not a staging copy: search engines may index the shop, and no test-site notice is shown.
  const robots = await (await request.get("/robots.txt")).text();
  expect(robots).toContain("Allow: /");
  expect(robots).toContain("Sitemap:");
  expect((await request.get("/sitemap.xml")).status()).toBe(200);
  const shop = await request.get("/en/shop");
  expect(shop.headers()["x-robots-tag"]).toBeUndefined();
  await page.goto("/en/shop");
  await expect(page.getByRole("note")).toHaveCount(0);

  // No admin host is configured, so the panel answers here, behind its sign-in.
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "Staff sign-in" })).toBeVisible();
  // A page without a language still goes to one; an address with a language is left alone.
  const bare = await request.get("/shop", { maxRedirects: 0 });
  expect(bare.status()).toBe(307);
  expect(bare.headers().location).toMatch(/\/en\/shop$/);
});
