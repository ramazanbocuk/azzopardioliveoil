import { requireAdmin } from "./auth";
import type { Ctx } from "./context";
import { carrierStates } from "./shipping/registry";

/**
 * What is connected, read from the server environment. It reports whether
 * each credential is present, never its value, and it does not call the
 * provider: "Connected" means configured, not proven to work. The Messages
 * list on an order and the Notifications screen show what actually happened.
 */
export type Integration = { name: string; purpose: string; connected: boolean; detail: string; missing: string[] };

export function integrationStatus(ctx: Ctx, env: Record<string, string | undefined> = process.env): Integration[] {
  requireAdmin(ctx, "VIEW", "integrations");
  const missing = (...keys: string[]) => keys.filter((key) => !env[key]);
  const stripeMissing = missing("STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET");
  const stripeMode = /^(sk|rk)_live_/.test(env.STRIPE_SECRET_KEY ?? "") ? "Live mode: real money." : /^(sk|rk)_test_/.test(env.STRIPE_SECRET_KEY ?? "") ? "Test mode: no real money is taken." : "";
  const emailMissing = missing("RESEND_API_KEY", "EMAIL_FROM");
  const whatsappMissing = missing("WHATSAPP_ACCESS_TOKEN", "WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_API_VERSION", "WHATSAPP_TEMPLATE_NAME");
  const smsMissing = missing("TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM");
  const secretOk = (env.APP_SECRET ?? "").length >= 32;
  const cronOk = (env.CRON_SECRET ?? "").length >= 24;
  return [
    { name: "Stripe", purpose: "Card and local payment methods, refunds", connected: stripeMissing.length === 0, detail: stripeMissing.length ? "Orders are created unpaid and refunds cannot be sent." : stripeMode, missing: stripeMissing },
    { name: "Resend", purpose: "Order, shipping and password emails", connected: emailMissing.length === 0, detail: emailMissing.length ? "No email is sent." : /@resend\.dev>?$/.test(env.EMAIL_FROM ?? "") ? "Using Resend's test sender: only your own address receives mail. Verify your domain for customers." : `Sending as ${env.EMAIL_FROM}.`, missing: emailMissing },
    { name: "WhatsApp Business", purpose: "New-order alerts to the shop", connected: whatsappMissing.length === 0, detail: whatsappMissing.length ? "No WhatsApp alert is sent." : `Template “${env.WHATSAPP_TEMPLATE_NAME}”.`, missing: whatsappMissing },
    { name: "Twilio SMS", purpose: "Optional SMS alerts to the shop", connected: smsMissing.length === 0, detail: smsMissing.length ? "No SMS is sent." : "", missing: smsMissing },
    ...carrierStates(env).map((carrier) => ({ name: carrier.name, purpose: "Shipping labels, tracking" + (carrier.hasRates ? ", live rates" : ""), connected: carrier.connected, detail: carrier.connected ? `Environment: ${carrier.environment}. Written from the carrier's documentation; confirm with a test booking.` : "Shipments are recorded by hand.", missing: carrier.missing })),
    { name: "Link signing (APP_SECRET)", purpose: "Password-reset and newsletter links, two-factor secrets", connected: secretOk, detail: secretOk ? "" : "Reset links cannot be signed and two-factor sign-in cannot be set up.", missing: secretOk ? [] : ["APP_SECRET (32+ characters)"] },
    { name: "Scheduler (CRON_SECRET)", purpose: "Message retries, stock release, tracking refresh, cleanup", connected: cronOk, detail: cronOk ? "The host must call /api/cron/jobs every few minutes." : "Background work only runs when triggered by a payment or a staff action.", missing: cronOk ? [] : ["CRON_SECRET (24+ characters)"] },
  ];
}
