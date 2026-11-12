import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { Order, OrderItem, Shipment } from "@/generated/prisma/client";
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

function itemsTable(order: FullOrder): string {
  const rows = order.items
    .map((item) => `<tr><td style="padding:8px 0;border-bottom:1px solid #d2cbbd">${escape(item.productName)} ${escape(item.variantLabel)} &times; ${item.quantity}${item.lotNumber ? `<br><span style="color:#6b6558;font-size:13px">Lot ${escape(item.lotNumber)}</span>` : ""}</td><td align="right" style="padding:8px 0;border-bottom:1px solid #d2cbbd">${money(item.lineTotalCents)}</td></tr>`)
    .join("");
  return `<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:16px 0">${rows}
<tr><td style="padding:8px 0">Shipping (${escape(order.shippingRateName)})</td><td align="right">${order.shippingCents === 0 ? "Free" : money(order.shippingCents)}</td></tr>
${order.discountCents ? `<tr><td style="padding:8px 0">Discount</td><td align="right">&minus;${money(order.discountCents)}</td></tr>` : ""}
<tr><td style="padding:8px 0;font-weight:bold">Total</td><td align="right" style="font-weight:bold">${money(order.totalCents)}</td></tr></table>`;
}

const address = (order: Order) => [`${order.shipFirstName} ${order.shipLastName}`, order.shipLine1, order.shipLine2, `${order.shipPostalCode} ${order.shipCity}`, country(order.shipCountryCode)].filter(Boolean) as string[];

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
  return {
    to: order.email,
    subject: `Your Azzopardi order ${order.number}`,
    text: [`Thank you, ${order.shipFirstName}. We have received your payment for order ${order.number}.`, "", ...order.items.map((item) => `- ${itemLine(item)}`), `Total: ${money(order.totalCents)}`, "", "Deliver to:", ...address(order), "", "We will email you a tracking link when your parcel leaves.", `Track your order: ${appUrl()}/order-tracking`].join("\n"),
    html: layout(
      `Thank you, ${order.shipFirstName}.`,
      `<p>We have received your payment for order <strong>${escape(order.number ?? "")}</strong>. We will email you a tracking link when your parcel leaves.</p>${itemsTable(order)}
<p><strong>Deliver to</strong><br>${address(order).map(escape).join("<br>")}</p>
<p>You can follow your order at <a href="${appUrl()}/order-tracking" style="color:#2f3a22">${appUrl()}/order-tracking</a> with your order number and this email address.</p>`,
    ),
  };
}

export function customerShippedEmail(order: FullOrder, shipment: Shipment | null): Email {
  const tracking = shipment?.trackingUrl ? `Track it here: ${shipment.trackingUrl}` : shipment?.trackingNumber ? `Tracking number: ${shipment.trackingNumber}` : "";
  return {
    to: order.email,
    subject: `Your Azzopardi order ${order.number} is on its way`,
    text: [`Good news, ${order.shipFirstName}: order ${order.number} has left with ${shipment?.carrier ?? "our carrier"}.`, tracking, "", ...order.items.map((item) => `- ${itemLine(item)}${item.lotNumber ? ` (lot ${item.lotNumber})` : ""}`)].filter((line) => line !== undefined).join("\n"),
    html: layout(
      "Your order is on its way.",
      `<p>Order <strong>${escape(order.number ?? "")}</strong> has left with ${escape(shipment?.carrier ?? "our carrier")}.</p>
${shipment?.trackingUrl ? `<p><a href="${escape(shipment.trackingUrl)}" style="color:#2f3a22">Track your parcel</a></p>` : shipment?.trackingNumber ? `<p>Tracking number: ${escape(shipment.trackingNumber)}</p>` : ""}${itemsTable(order)}`,
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

export function newsletterConfirmEmail(subscriber: { id: string; email: string }): Email | null {
  const confirm = signLink("newsletter-confirm", subscriber.id);
  const leave = signLink("newsletter-unsubscribe", subscriber.id);
  if (!confirm || !leave) return null;
  const link = `${appUrl()}/newsletter?action=confirm&id=${subscriber.id}&sig=${confirm}`;
  const out = `${appUrl()}/newsletter?action=unsubscribe&id=${subscriber.id}&sig=${leave}`;
  return {
    to: subscriber.email,
    subject: "Confirm your subscription to letters from the grove",
    text: `Please confirm that you would like to receive letters from Azzopardi Olive Oil:\n${link}\n\nIf you did not ask for this, ignore this email and you will hear nothing more.\nUnsubscribe at any time: ${out}`,
    html: layout(
      "One step left.",
      `<p>Please confirm that you would like to receive letters from Azzopardi Olive Oil, a few times a year.</p>
<p><a href="${link}" style="display:inline-block;background:#2f3a22;color:#f4efe4;padding:14px 24px;text-decoration:none;letter-spacing:1px;text-transform:uppercase;font-size:13px">Confirm subscription</a></p>
<p style="color:#6b6558;font-size:13px">If you did not ask for this, ignore this email and you will hear nothing more. <a href="${out}" style="color:#6b6558">Unsubscribe</a></p>`,
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

export function passwordResetEmail(customer: { id: string; email: string; firstName: string; passwordHash: string }, now = new Date()): Email | null {
  const expiresAt = now.getTime() + RESET_MINUTES * 60_000;
  const signature = signLink(resetPurpose(expiresAt, customer.passwordHash), customer.id);
  if (!signature) return null;
  const link = `${appUrl()}/account/reset?id=${customer.id}&exp=${expiresAt}&sig=${signature}`;
  return {
    to: customer.email,
    subject: "Reset your Azzopardi password",
    text: `Hello ${customer.firstName},\n\nUse this link within ${RESET_MINUTES} minutes to choose a new password:\n${link}\n\nIf you did not ask for this, ignore this email. Your password has not changed.`,
    html: layout(
      "Choose a new password.",
      `<p>Hello ${escape(customer.firstName)}, use the button below within ${RESET_MINUTES} minutes to choose a new password.</p>
<p><a href="${link}" style="display:inline-block;background:#2f3a22;color:#f4efe4;padding:14px 24px;text-decoration:none;letter-spacing:1px;text-transform:uppercase;font-size:13px">Reset password</a></p>
<p style="color:#6b6558;font-size:13px">If you did not ask for this, ignore this email. Your password has not changed.</p>`,
    ),
  };
}
