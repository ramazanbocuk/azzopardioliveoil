import { expect, test } from "@playwright/test";

/**
 * The assistant without a connection. The browser tests never call a model,
 * so what can be proven here is the off state: no button, and an endpoint
 * that says "unavailable" without saying why.
 */

test("with no API key the shop shows no assistant and the endpoint is unavailable", async ({ page, request }) => {
  await page.goto("/en/shop");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByRole("button", { name: "Ask our assistant" })).toHaveCount(0);

  const reply = await request.post("/api/assistant", { data: { message: "Hello" } });
  expect(reply.status()).toBe(200);
  expect(await reply.json()).toEqual({ conversationId: null, status: "unavailable", text: "", actions: { products: [], cart: [], handover: null } });
});
