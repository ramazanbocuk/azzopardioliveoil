import { NextResponse, type NextRequest } from "next/server";
import { COUNTRY_COOKIE, LOCALE_COOKIE, ONE_YEAR, detectLocale, splitLocale } from "@/i18n/config";
import { adminHostRule } from "@/server/environment";

/** Everything that is not a storefront page: the admin panel, APIs, uploaded media, and files such as robots.txt. */
const NOT_A_PAGE = /^\/(?:admin|api|media)(?:\/|$)|\.[a-zA-Z0-9]+$/;

/**
 * Sends a visitor who arrives without a locale in the address to the one
 * that suits them (/shop → /de-de/shop). An address that already has a
 * locale is never redirected, so choosing a language is always respected
 * and nobody is bounced back and forth.
 */
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  // When the admin panel has a host of its own, it answers only there, and that host shows nothing else.
  const rule = adminHostRule(request.headers.get("host"), pathname, process.env.ADMIN_HOST);
  if (rule === "not-found") return new NextResponse("Not found", { status: 404, headers: { "cache-control": "no-store", "x-robots-tag": "noindex" } });
  if (rule === "to-admin") return NextResponse.redirect(new URL("/admin", request.url), 307);
  if (NOT_A_PAGE.test(pathname)) return NextResponse.next();
  // The host tells us the visitor's country; without such a header (local development) it is unknown.
  const country = (request.headers.get("x-vercel-ip-country") ?? request.headers.get("cf-ipcountry") ?? "").toUpperCase().slice(0, 2) || null;

  if (splitLocale(pathname).locale) {
    const response = NextResponse.next();
    if (country && request.cookies.get(COUNTRY_COOKIE)?.value !== country) response.cookies.set(COUNTRY_COOKIE, country, { path: "/", maxAge: ONE_YEAR, sameSite: "lax" });
    return response;
  }

  const locale = detectLocale({ saved: request.cookies.get(LOCALE_COOKIE)?.value, acceptLanguage: request.headers.get("accept-language"), country });
  const target = new URL(`/${locale}${pathname === "/" ? "" : pathname}${search}`, request.url);
  // 307: the choice depends on the visitor, so it must not be remembered by browsers or shared caches.
  const response = NextResponse.redirect(target, 307);
  response.headers.set("Vary", "Accept-Language, Cookie");
  response.headers.set("Cache-Control", "private, no-store");
  if (country) response.cookies.set(COUNTRY_COOKIE, country, { path: "/", maxAge: ONE_YEAR, sameSite: "lax" });
  return response;
}

export const config = {
  // Everything except Next.js internals. The admin panel and APIs pass straight through unless ADMIN_HOST says otherwise.
  matcher: ["/((?!_next).*)"],
};
