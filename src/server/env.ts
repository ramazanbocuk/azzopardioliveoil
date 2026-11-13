/**
 * Configuration check, run once when the server starts.
 * Missing essentials stop a production server from starting with a clear
 * message; missing integrations are reported as warnings, since the shop is
 * designed to run without them (orders stay unpaid, messages are skipped).
 */

type Finding = { level: "error" | "warning"; message: string };

export function checkEnvironment(env: Record<string, string | undefined> = process.env): Finding[] {
  const findings: Finding[] = [];
  const error = (message: string) => findings.push({ level: "error", message });
  const warning = (message: string) => findings.push({ level: "warning", message });
  const production = env.NODE_ENV === "production";

  if (!env.DATABASE_URL) error("DATABASE_URL is not set.");
  if (!env.APP_URL) error("APP_URL is not set (the public address of the site).");
  else if (production && !env.APP_URL.startsWith("https://") && !env.APP_URL.startsWith("http://localhost")) error("APP_URL must start with https:// in production.");

  if (!env.APP_SECRET || env.APP_SECRET.length < 32) (production ? error : warning)("APP_SECRET is missing or shorter than 32 characters: password-reset and newsletter links cannot be signed.");
  if (!env.CRON_SECRET || env.CRON_SECRET.length < 24) warning("CRON_SECRET is missing or shorter than 24 characters: the scheduler cannot run, so retries, stock release and cleanup will not happen.");

  if (!env.STRIPE_SECRET_KEY || !env.STRIPE_WEBHOOK_SECRET) warning("Stripe is not connected: orders will be created unpaid and refunds cannot be sent.");
  else if (production && /^(sk|rk)_test_/.test(env.STRIPE_SECRET_KEY)) warning("Stripe is using a TEST key in production: no real money will be taken.");
  if (!(env.BPOST_ACCOUNT_ID && env.BPOST_PASSPHRASE) && !(env.DHL_EXPRESS_API_KEY && env.DHL_EXPRESS_API_SECRET && env.DHL_EXPRESS_ACCOUNT_NUMBER) && !(env.FEDEX_CLIENT_ID && env.FEDEX_CLIENT_SECRET && env.FEDEX_ACCOUNT_NUMBER) && !(env.UPS_CLIENT_ID && env.UPS_CLIENT_SECRET && env.UPS_ACCOUNT_NUMBER)) {
    warning("No carrier is connected (bpost, DHL Express, UPS, FedEx): labels cannot be booked and shipments are recorded by hand.");
  }
  if (!env.ANTHROPIC_API_KEY) warning("The assistant is not connected (ANTHROPIC_API_KEY): the shop shows no assistant.");
  else if (env.ASSISTANT_EFFORT && !["low", "medium", "high"].includes(env.ASSISTANT_EFFORT)) warning("ASSISTANT_EFFORT must be low, medium or high; low is used.");
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM) warning("Email (Resend) is not connected: no confirmation, shipping, reset or owner emails will be sent.");
  if (!env.WHATSAPP_ACCESS_TOKEN || !env.WHATSAPP_PHONE_NUMBER_ID || !env.WHATSAPP_API_VERSION || !env.WHATSAPP_TEMPLATE_NAME) warning("WhatsApp is not connected: no WhatsApp order alerts will be sent.");

  return findings;
}

export function assertEnvironment(): void {
  const findings = checkEnvironment();
  for (const finding of findings) console[finding.level === "error" ? "error" : "warn"](`[config] ${finding.level}: ${finding.message}`);
  if (process.env.NODE_ENV === "production" && findings.some((finding) => finding.level === "error")) {
    throw new Error("Server configuration is incomplete. See the [config] errors above.");
  }
}
