import type { AdminUser, Customer } from "@/generated/prisma/client";
import { hashToken } from "./crypto";
import type { Db } from "./db";

export const COOKIE = { session: "azz_session", cart: "azz_cart", admin: "azz_admin" } as const;

const DAY = 60 * 60 * 24;
export const TTL = { session: 30 * DAY, cart: 60 * DAY, admin: 12 * 60 * 60 } as const;

/** Everything a resolver may know about the request. Built once per request. */
export type Ctx = {
  db: Db;
  ip: string;
  userAgent: string | null;
  cookies: Record<string, string>;
  /** Set-Cookie header values to send with the response. */
  setCookies: string[];
  customer: Customer | null;
  admin: AdminUser | null;
};

export function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? "").split(";")) {
    const index = part.indexOf("=");
    if (index > 0) out[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return out;
}

/** HttpOnly always; Secure outside development; never readable by scripts. */
export function setCookie(ctx: Ctx, name: string, value: string, maxAgeSeconds: number, sameSite: "Lax" | "Strict" = "Lax") {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  ctx.setCookies.push(`${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=${sameSite}; Max-Age=${maxAgeSeconds}${secure}`);
  ctx.cookies[name] = value;
}

export function clearCookie(ctx: Ctx, name: string) {
  setCookie(ctx, name, "", 0);
  delete ctx.cookies[name];
}

export async function buildContext(db: Db, request: { headers: Headers }): Promise<Ctx> {
  const cookies = parseCookies(request.headers.get("cookie"));
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const now = new Date();

  const [session, adminSession] = await Promise.all([
    cookies[COOKIE.session]
      ? db.customerSession.findUnique({ where: { tokenHash: hashToken(cookies[COOKIE.session]) }, include: { customer: true } })
      : null,
    cookies[COOKIE.admin]
      ? db.adminSession.findUnique({ where: { tokenHash: hashToken(cookies[COOKIE.admin]) }, include: { adminUser: true } })
      : null,
  ]);

  return {
    db,
    ip,
    userAgent: request.headers.get("user-agent"),
    cookies,
    setCookies: [],
    customer: session && session.expiresAt > now && !session.customer.erasedAt ? session.customer : null,
    admin: adminSession && adminSession.expiresAt > now && adminSession.adminUser.isActive ? adminSession.adminUser : null,
  };
}
