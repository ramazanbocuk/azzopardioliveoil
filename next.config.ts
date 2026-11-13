import type { NextConfig } from "next";

const dev = process.env.NODE_ENV !== "production";
// A production build served over plain http on localhost (the end-to-end tests) must not force https.
const local = (process.env.APP_URL ?? "").startsWith("http://localhost");

/**
 * Content Security Policy.
 * Everything is same-origin: fonts are self-hosted, payment happens on the
 * provider's own page (a navigation, not an embed), and there are no
 * third-party scripts. Inline scripts are allowed because Next.js bootstraps
 * with them on statically rendered pages, where a per-request nonce is not
 * possible; that is the one known weakness of this policy.
 */
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  `connect-src 'self'${dev ? " ws: wss:" : ""}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  ...(dev || local ? [] : ["upgrade-insecure-requests"]),
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  // A staging copy is never to be indexed, whatever links to it.
  ...(process.env.APP_ENV === "staging" ? [{ key: "X-Robots-Tag", value: "noindex, nofollow" }] : []),
  // Two years, as required for browser preload lists. Only sent over HTTPS in production.
  ...(dev ? [] : [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" }]),
];

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  poweredByHeader: false,
  // Product photos are uploaded through a server action; the default 1 MB cap is too small for a photo.
  experimental: { serverActions: { bodySizeLimit: "5mb" } },
  // The end-to-end tests build into their own folder, so they never disturb a running dev server.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // These pages carry a private token in the address; never pass it on in a Referer header.
      { source: "/:locale/order-confirmation", headers: [{ key: "Referrer-Policy", value: "no-referrer" }] },
      { source: "/:locale/account/reset", headers: [{ key: "Referrer-Policy", value: "no-referrer" }] },
      { source: "/:locale/newsletter", headers: [{ key: "Referrer-Policy", value: "no-referrer" }] },
      // Staff screens and APIs must never be cached by a shared proxy or indexed.
      { source: "/admin/:path*", headers: [{ key: "Cache-Control", value: "private, no-store" }, { key: "X-Robots-Tag", value: "noindex, nofollow" }] },
      { source: "/api/:path*", headers: [{ key: "X-Robots-Tag", value: "noindex" }] },
    ];
  },
};

export default nextConfig;
