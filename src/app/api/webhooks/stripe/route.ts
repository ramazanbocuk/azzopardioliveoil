import { afterResponse } from "@/server/afterResponse";
import { getPrisma } from "@/server/db";
import { processJobs } from "@/server/jobs";
import { applyPaymentEvent, getPaymentProvider } from "@/server/payments";
import { linkIntent } from "@/server/paymentSync";

/**
 * Stripe webhook. The raw body is verified against the signing secret before
 * anything is read from it; an unsigned or tampered request gets a 400 and
 * changes nothing. Stripe retries on any non-2xx answer.
 */
export async function POST(request: Request) {
  const provider = getPaymentProvider();
  if (!provider || provider.name !== "STRIPE") return new Response("Stripe is not configured.", { status: 503 });

  const rawBody = await request.text();
  let event;
  try {
    event = provider.parseWebhook(rawBody, request.headers.get("stripe-signature"));
  } catch {
    return new Response("Invalid signature.", { status: 400 });
  }

  // Refunds and disputes name the payment, not the checkout. A lookup failure here answers 500, so Stripe sends the event again.
  if (event.outcome === "refund" || event.outcome === "dispute") await linkIntent(getPrisma(), provider, event.intentRef);
  const result = await applyPaymentEvent(getPrisma(), "STRIPE", event);
  // Notifications were queued in the same transaction; send them once the response is out.
  // If this never runs, the scheduler picks the jobs up within minutes.
  if (result !== "duplicate" && result !== "ignored" && result !== "unknown-payment") afterResponse(() => processJobs(getPrisma()), "run after webhook");
  return Response.json({ received: true, result });
}
