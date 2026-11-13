import type { MetadataRoute } from "next";
import { siteUrl } from "@/components/ui/JsonLd";

export default function robots(): MetadataRoute.Robots {
  // A staging copy must never appear in search results.
  if (process.env.APP_ENV === "staging") return { rules: [{ userAgent: "*", disallow: "/" }] };
  return {
    rules: [{ userAgent: "*", allow: "/", // Storefront pages sit under a locale (/de-de/cart), hence the wildcard.
      disallow: ["/admin", "/api", ...["cart", "checkout", "account", "order-confirmation", "order-tracking", "search", "newsletter", "design-system"].map((page) => `/*/${page}`)] }],
    sitemap: `${siteUrl()}/sitemap.xml`,
  };
}
