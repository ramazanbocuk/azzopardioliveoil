import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { Order, OrderItem, Shipment } from "@/generated/prisma/client";
import { languageOf, localizePath, tagOf, toLocale, type Locale } from "@/i18n/config";
import { EMAIL_TEXT, type EmailText } from "@/i18n/emails";
import { countryName, fill, formatMoney } from "@/i18n/format";
import type { Email } from "./channels";

/** Message content. Pure functions of the order, so the exact wording is unit-tested. */

type FullOrder = Order & { items: OrderItem[] };

const money = (cents: number) => new Intl.NumberFormat("en-BE", { style: "currency", currency: "EUR" }).format(cents / 100);
const escape = (text: string) => text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);
const appUrl = () => (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");

const COUNTRIES: Record<string, string> = { BE: "Belgium", LU: "Luxembourg", NL: "Netherlands", FR: "France", DE: "Germany", IT: "Italy" };
const country = (code: string) => COUNTRIES[code] ?? code;
const itemLine = (item: OrderItem) => `${item.productName} ${item.variantLabel} x ${item.quantity}`;
const paymentLabel = (order: Order) => (order.paymentStatus === "PAID" ? "Paid" : order.paymentStatus.replaceAll("_", " ").toLowerCase());

function layout(title: string, body: string): string {
  return `<!doctype html><html><body style="margin:0;background:#f4efe4;font-family:Helvetica,Arial,sans-serif;color:#1a1c16;line-height:1.55">
<div style="max-width:560px;margin:0 auto;padding:32px 24px">
<p style="font-family:Georgia,serif;letter-spacing:4px;text-transform:uppercase;font-size:18px;margin:0 0 28px">Azzopardi</p>
<h1 style="font-family:Georgia,serif;font-weight:400;font-size:26px;margin:0 0 20px">${escape(title)}</h1>
${body}
</div></body></html>`;
}

/**
 * Everything an email to a customer needs to speak their language: the
 * wording, money and country names in their format, and links that open the
 * shop in the same language. `stored` is what was saved with the order,
 * account or subscription ("de-de", or a bare "en" from before languages existed).
 */
function speak(stored: string | null | undefined): { locale: Locale; t: EmailText; cash: (cents: number) => string; land: (code: string) => string; link: (path: string) => string } {
  const locale = toLocale(stored);
  const tag = tagOf(locale);
  return { locale, t: EMAIL_TEXT[languageOf(locale)], cash: (cents) => formatMoney(tag, cents), land: (code) => countryName(tag, code), link: (path) => `${appUrl()}${localizePath(locale, path)}` };
}

/** Escapes a sentence for HTML and sets one value inside it in bold. */
const bold = (sentence: string, value: string) => escape(sentence).replace(escape(value), `<strong>${escape(value)}</strong>`);

function itemsTable(order: FullOrder): string {
  const { t, cash } = speak(order.locale);
  const rows = order.items
    .map((item) => `<tr><td style="padding:8px 0;border-bottom:1px solid #d2cbbd">${escape(item.productName)} ${escape(item.variantLabel)} &times; ${item.quantity}${item.lotNumber ? `<br><span style="color:#6b6558;font-size:13px">${escape(fill(t.lot, { lot: item.lotNumber }))}</span>` : ""}</td><td align="right" style="padding:8px 0;border-bottom:1px solid #d2cbbd">${cash(item.lineTotalCents)}</td></tr>`)
    .join("");
  return `<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:16px 0">${rows}
<tr><td style="padding:8px 0">${escape(fill(t.shipping, { name: order.shippingRateName }))}</td><td align="right">${order.shippingCents === 0 ? escape(t.free) : cash(order.shippingCents)}</td></tr>
${order.discountCents ? `<tr><td style="padding:8px 0">${escape(t.discount)}</td><td align="right">&minus;${cash(order.discountCents)}</td></tr>` : ""}
<tr><td style="padding:8px 0;font-weight:bold">${escape(t.total)}</td><td align="right" style="font-weight:bold">${cash(order.totalCents)}</td></tr></table>`;
}

const address = (order: Order, land: (code: string) => string = country) => [`${order.shipFirstName} ${order.shipLastName}`, order.shipLine1, order.shipLine2, `${order.shipPostalCode} ${order.shipCity}`, land(order.shipCountryCode)].filter(Boolean) as string[];

/**
 * The owner's WhatsApp alert, as the six body parameters of the approved
 * template (see docs/notifications.md for the template text to register):
 * order number, customer, products, total, destination, payment status.
 */
export function ownerWhatsAppParameters(order: FullOrder): string[] {
  return [`#${order.number}`, `${order.shipFirstName} ${order.shipLastName}`, order.items.map(itemLine).join("; "), money(order.totalCents), country(order.shipCountryCode), paymentLabel(order)];
}

/** Plain-text version of the same alert, used for SMS and as the email's text part. */
export function ownerText(order: FullOrder): string {
  return [
    "NEW ORDER RECEIVED",
    `Order: #${order.number}`,
    `Customer: ${order.shipFirstName} ${order.shipLastName}`,
    "Products:",
    ...order.items.map((item) => `- ${itemLine(item)}`),
    `Total: ${money(order.totalCents)}`,
    `Shipping: ${country(order.shipCountryCode)}`,
    `Payment: ${paymentLabel(order)}`,
    `View order: ${appUrl()}/admin/orders/${order.id}`,
  ].join("\n");
}

export function ownerEmail(order: FullOrder, to: string): Email {
  return {
    to,
    subject: `New order ${order.number} — ${money(order.totalCents)}`,
    text: ownerText(order),
    replyTo: order.email,
    html: layout(
      `New order ${order.number}`,
      `<p>${escape(order.shipFirstName)} ${escape(order.shipLastName)} &lt;${escape(order.email)}&gt;<br>Payment: ${escape(paymentLabel(order))}</p>${itemsTable(order)}
<p><strong>Deliver to</strong><br>${address(order).map(escape).join("<br>")}</p>${order.customerNote ? `<p><strong>Note</strong><br>${escape(order.customerNote)}</p>` : ""}
<p><a href="${appUrl()}/admin/orders/${order.id}" style="color:#2f3a22">View order in the admin dashboard</a></p>`,
    ),
  };
}

export function customerConfirmationEmail(order: FullOrder): Email {
  const { t, cash, land, link } = speak(order.locale);
  const c = t.confirmation;
  const number = order.number ?? "";
  const title = fill(c.title, { name: order.shipFirstName });
  const received = fill(c.received, { number });
  const tracking = link("/order-tracking");
  return {
    to: order.email,
    subject: fill(c.subject, { number }),
    text: [`${title} ${received}`, "", ...order.items.map((item) => `- ${itemLine(item)}`), `${t.total}: ${cash(order.totalCents)}`, "", `${c.deliverTo}:`, ...address(order, land), "", c.trackingLater, fill(c.trackText, { url: tracking })].join("\n"),
    html: layout(
      title,
      `<p>${bold(received, number)} ${escape(c.trackingLater)}</p>${itemsTable(order)}
<p><strong>${escape(c.deliverTo)}</strong><br>${address(order, land).map(escape).join("<br>")}</p>
<p>${escape(c.follow).replace("{url}", `<a href="${tracking}" style="color:#2f3a22">${tracking}</a>`)}</p>`,
    ),
  };
}

/** What one shipment carried, and what the order still owes after it. The job fills this in; without it the email covers the whole order. */
export type ShipmentContents = { lines: { name: string; quantity: number; lotNumber: string | null }[]; toFollow: { name: string; quantity: number }[]; first: boolean };

/**
 * One email per shipment. It lists what is in that parcel, with its own
 * tracking, and says plainly whether more is to come. An order sent in two
 * parcels produces two of these, each in the customer's language.
 */
export function customerShippedEmail(order: FullOrder, shipment: Shipment | null, contents?: ShipmentContents): Email {
  const { t } = speak(order.locale);
  const sh = t.shipped;
  const number = order.number ?? "";
  const carrier = shipment?.carrier ?? sh.ourCarrier;
  const tracking = shipment?.trackingUrl ? fill(sh.trackHere, { url: shipment.trackingUrl }) : shipment?.trackingNumber ? fill(sh.trackingNumber, { number: shipment.trackingNumber }) : "";
  const lines = contents?.lines ?? order.items.map((item) => ({ name: `${item.productName} ${item.variantLabel}`, quantity: item.quantity, lotNumber: item.lotNumber }));
  const toFollow = contents?.toFollow ?? [];
  // "Part of your order" whenever this parcel is not the whole of it: more is to come, or something went before.
  const part = toFollow.length > 0 || contents?.first === false;
  const closing = toFollow.length > 0 ? sh.followNote : part ? sh.completes : "";
  const lineText = (line: { name: string; quantity: number; lotNumber?: string | null }) => `- ${line.name} x ${line.quantity}${line.lotNumber ? ` (${fill(t.lot, { lot: line.lotNumber }).toLowerCase()})` : ""}`;
  const lineHtml = (line: { name: string; quantity: number; lotNumber?: string | null }) =>
    `<tr><td style="padding:8px 0;border-bottom:1px solid #d2cbbd">${escape(line.name)}${line.lotNumber ? `<br><span style="color:#6b6558;font-size:13px">${escape(fill(t.lot, { lot: line.lotNumber }))}</span>` : ""}</td><td align="right" style="padding:8px 0;border-bottom:1px solid #d2cbbd">&times; ${line.quantity}</td></tr>`;
  const table = (rows: { name: string; quantity: number; lotNumber?: string | null }[]) => `<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:8px 0 16px">${rows.map(lineHtml).join("")}</table>`;

  return {
    to: order.email,
    subject: fill(part ? sh.partSubject : sh.subject, { number }),
    text: [
      fill(sh.left, { name: order.shipFirstName, number, carrier }),
      tracking,
      "",
      ...(part ? [`${sh.inParcel}:`] : []),
      ...lines.map(lineText),
      ...(toFollow.length > 0 ? ["", `${sh.toFollow}:`, ...toFollow.map(lineText)] : []),
      ...(closing ? ["", closing] : []),
    ].join("\n"),
    html: layout(
      part ? sh.partTitle : sh.title,
      `<p>${bold(fill(sh.leftShort, { number, carrier }), number)}</p>
${shipment?.trackingUrl ? `<p><a href="${escape(shipment.trackingUrl)}" style="color:#2f3a22">${escape(sh.trackParcel)}</a></p>` : shipment?.trackingNumber ? `<p>${escape(fill(sh.trackingNumber, { number: shipment.trackingNumber }))}</p>` : ""}
${part ? `<p style="margin:16px 0 0"><strong>${escape(sh.inParcel)}</strong></p>` : ""}${table(lines)}
${toFollow.length > 0 ? `<p style="margin:16px 0 0"><strong>${escape(sh.toFollow)}</strong></p>${table(toFollow)}` : ""}${closing ? `<p>${escape(closing)}</p>` : ""}`,
    ),
  };
}

// ── Signed links (newsletter confirm / unsubscribe) ──

/** Links are signed with APP_SECRET, so no token needs storing and a link cannot be forged for another address. */
export function signLink(purpose: string, id: string, secret = process.env.APP_SECRET): string | null {
  if (!secret || secret.length < 32) return null;
  return createHmac("sha256", secret).update(`${purpose}:${id}`).digest("base64url");
}

export function verifyLink(purpose: string, id: string, signature: string, secret = process.env.APP_SECRET): boolean {
  const expected = signLink(purpose, id, secret);
  if (!expected) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function newsletterConfirmEmail(subscriber: { id: string; email: string; locale?: string | null }): Email | null {
  const confirm = signLink("newsletter-confirm", subscriber.id);
  const leave = signLink("newsletter-unsubscribe", subscriber.id);
  if (!confirm || !leave) return null;
  const { t, link: local } = speak(subscriber.locale);
  const n = t.newsletter;
  const link = `${local("/newsletter")}?action=confirm&id=${subscriber.id}&sig=${confirm}`;
  const out = `${local("/newsletter")}?action=unsubscribe&id=${subscriber.id}&sig=${leave}`;
  return {
    to: subscriber.email,
    subject: n.subject,
    text: `${n.text}\n${link}\n\n${n.ignore}\n${fill(n.unsubscribeText, { url: out })}`,
    html: layout(
      n.title,
      `<p>${escape(n.body)}</p>
<p><a href="${link}" style="display:inline-block;background:#2f3a22;color:#f4efe4;padding:14px 24px;text-decoration:none;letter-spacing:1px;text-transform:uppercase;font-size:13px">${escape(n.button)}</a></p>
<p style="color:#6b6558;font-size:13px">${escape(n.ignore)} <a href="${out}" style="color:#6b6558">${escape(n.unsubscribe)}</a></p>`,
    ),
  };
}

export function contactEmail(message: { name: string; email: string; reference?: string | null; body: string }, to: string): Email {
  return {
    to,
    replyTo: message.email,
    subject: `Website message from ${message.name}`,
    text: `From: ${message.name} <${message.email}>\n${message.reference ? `Reference: ${message.reference}\n` : ""}\n${message.body}`,
    html: layout("Website message", `<p><strong>${escape(message.name)}</strong> &lt;${escape(message.email)}&gt;${message.reference ? `<br>Reference: ${escape(message.reference)}` : ""}</p><p style="white-space:pre-wrap">${escape(message.body)}</p>`),
  };
}

// ── Staff alerts and customer notices ──

/** A plain operational alert to the shop: something needs a person's attention. */
export function staffAlertEmail(to: string, alert: { subject: string; heading: string; lines: string[]; path?: string }): Email {
  const link = alert.path ? `${appUrl()}${alert.path}` : null;
  return {
    to,
    subject: alert.subject,
    text: [alert.heading, "", ...alert.lines, ...(link ? ["", link] : [])].join("\n"),
    html: layout(alert.heading, `${alert.lines.map((line) => `<p>${escape(line)}</p>`).join("")}${link ? `<p><a href="${link}">Open in the admin panel</a></p>` : ""}`),
  };
}

export function customerRefundEmail(order: Order, amountCents: number, full: boolean): Email {
  const { t, cash } = speak(order.locale);
  const r = t.refund;
  const number = order.number ?? "";
  const intro = full ? fill(r.full, { number }) : fill(r.partial, { amount: cash(amountCents), number });
  const amount = fill(r.amount, { amount: cash(amountCents) });
  const dear = fill(t.dear, { name: order.shipFirstName });
  return {
    to: order.email,
    subject: fill(r.subject, { number }),
    text: [dear, "", intro, amount, "", r.timing, "", t.signature].join("\n"),
    html: layout(r.title, `<p>${escape(dear)}</p><p>${escape(intro)}</p><p><strong>${escape(amount)}</strong></p><p>${escape(r.timing)}</p>`),
  };
}

export function wholesaleApprovedEmail(customer: { email: string; firstName: string; companyName: string | null; wholesaleDiscountBps: number; locale?: string | null }): Email {
  const { t, locale, link } = speak(customer.locale);
  const w = t.wholesale;
  const terms = `${(customer.wholesaleDiscountBps / 100).toLocaleString(tagOf(locale), { maximumFractionDigits: 2 })}%`;
  const lines = [customer.companyName ? fill(w.approvedFor, { company: customer.companyName }) : w.approved, fill(w.discount, { terms }), w.invoice];
  const dear = fill(t.dear, { name: customer.firstName });
  return {
    to: customer.email,
    subject: w.subject,
    text: [dear, "", ...lines, "", link("/account"), "", t.signature].join("\n"),
    html: layout(w.title, `<p>${escape(dear)}</p>${lines.map((line) => `<p>${escape(line)}</p>`).join("")}<p><a href="${link("/account")}">${escape(w.signIn)}</a></p>`),
  };
}

// ── Password reset ──

export const RESET_MINUTES = 60;

/**
 * The reset link is signed over the account, its expiry and a fingerprint of
 * the current password hash. Nothing is stored, the link dies after an hour,
 * and it stops working the moment the password changes — so it is single-use.
 */
export function resetPurpose(expiresAt: number, passwordHash: string): string {
  return `password-reset:${expiresAt}:${createHash("sha256").update(passwordHash).digest("hex").slice(0, 24)}`;
}

export function passwordResetEmail(customer: { id: string; email: string; firstName: string; passwordHash: string; locale?: string | null }, now = new Date()): Email | null {
  const expiresAt = now.getTime() + RESET_MINUTES * 60_000;
  const signature = signLink(resetPurpose(expiresAt, customer.passwordHash), customer.id);
  if (!signature) return null;
  const { t, link: local } = speak(customer.locale);
  const r = t.reset;
  const values = { name: customer.firstName, minutes: RESET_MINUTES };
  const link = `${local("/account/reset")}?id=${customer.id}&exp=${expiresAt}&sig=${signature}`;
  return {
    to: customer.email,
    subject: r.subject,
    text: `${fill(r.text, values)}\n${link}\n\n${r.ignore}`,
    html: layout(
      r.title,
      `<p>${escape(fill(r.body, values))}</p>
<p><a href="${link}" style="display:inline-block;background:#2f3a22;color:#f4efe4;padding:14px 24px;text-decoration:none;letter-spacing:1px;text-transform:uppercase;font-size:13px">${escape(r.button)}</a></p>
<p style="color:#6b6558;font-size:13px">${escape(r.ignore)}</p>`,
    ),
  };
}
