/**
 * Outbound channels: email (Resend), WhatsApp (Meta's official Cloud API)
 * and SMS (Twilio). Each talks to the provider's HTTPS API directly with
 * credentials read from the server environment — never from the database,
 * never sent to a browser.
 *
 * A channel that has no credentials throws `NotConfigured`; the job worker
 * records that as "skipped" instead of pretending something was sent.
 */

export type Transport = (url: string, init: { method: "POST"; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

export class NotConfigured extends Error {
  constructor(what: string) {
    super(`${what} is not configured.`);
    this.name = "NotConfigured";
  }
}

/** The provider refused the request. `retryable` is false when trying again cannot help (bad address, rejected template). */
export class ChannelError extends Error {
  constructor(
    message: string,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = "ChannelError";
  }
}

const defaultTransport: Transport = (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(15_000) });

async function post(transport: Transport, channel: string, url: string, headers: Record<string, string>, body: string): Promise<void> {
  let response;
  try {
    response = await transport(url, { method: "POST", headers, body });
  } catch (error) {
    throw new ChannelError(`${channel}: network error (${error instanceof Error ? error.message : "unknown"})`, true);
  }
  if (response.ok) return;
  const detail = (await response.text().catch(() => "")).slice(0, 300);
  // 408, 429 and 5xx are worth another attempt; other 4xx mean the request itself is wrong.
  const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
  throw new ChannelError(`${channel}: HTTP ${response.status} ${detail}`, retryable);
}

export type Env = Record<string, string | undefined>;

export type Email = { to: string; subject: string; html: string; text: string; replyTo?: string };

/** Resend. `idempotencyKey` lets a retried job be sent at most once by the provider. */
export async function sendEmail(email: Email, idempotencyKey: string, env: Env = process.env, transport: Transport = defaultTransport): Promise<void> {
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM) throw new NotConfigured("Email (RESEND_API_KEY and EMAIL_FROM)");
  await post(
    transport,
    "Email",
    "https://api.resend.com/emails",
    { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json", "idempotency-key": idempotencyKey },
    JSON.stringify({ from: env.EMAIL_FROM, to: [email.to], subject: email.subject, html: email.html, text: email.text, ...(email.replyTo ? { reply_to: email.replyTo } : {}) }),
  );
}

/**
 * WhatsApp Business Platform (Cloud API). A message the business starts must
 * use a template Meta has approved, so this sends a template by name with its
 * body parameters. Parameters may not contain line breaks or tabs.
 */
export async function sendWhatsAppTemplate(to: string, parameters: string[], env: Env = process.env, transport: Transport = defaultTransport): Promise<void> {
  const { WHATSAPP_ACCESS_TOKEN: token, WHATSAPP_PHONE_NUMBER_ID: phoneId, WHATSAPP_API_VERSION: version, WHATSAPP_TEMPLATE_NAME: template } = env;
  if (!token || !phoneId || !version || !template) throw new NotConfigured("WhatsApp (access token, phone number id, API version and template name)");
  await post(
    transport,
    "WhatsApp",
    `https://graph.facebook.com/${version}/${phoneId}/messages`,
    { authorization: `Bearer ${token}`, "content-type": "application/json" },
    JSON.stringify({
      messaging_product: "whatsapp",
      to: to.replace(/[^\d]/g, ""),
      type: "template",
      template: {
        name: template,
        language: { code: env.WHATSAPP_TEMPLATE_LANG || "en" },
        components: [{ type: "body", parameters: parameters.map((text) => ({ type: "text", text: text.replace(/\s+/g, " ").trim().slice(0, 900) || "-" })) }],
      },
    }),
  );
}

/** Twilio Programmable Messaging. */
export async function sendSms(to: string, body: string, env: Env = process.env, transport: Transport = defaultTransport): Promise<void> {
  const { TWILIO_ACCOUNT_SID: sid, TWILIO_AUTH_TOKEN: token, TWILIO_FROM: from } = env;
  if (!sid || !token || !from) throw new NotConfigured("SMS (Twilio account SID, auth token and sender number)");
  await post(
    transport,
    "SMS",
    `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`,
    { authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`, "content-type": "application/x-www-form-urlencoded" },
    new URLSearchParams({ To: to, From: from, Body: body.slice(0, 600) }).toString(),
  );
}
