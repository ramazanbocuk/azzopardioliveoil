import type { MetadataRoute } from "next";
import { siteUrl } from "@/components/ui/JsonLd";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/admin", "/api", "/cart", "/checkout", "/account", "/order-confirmation", "/order-tracking", "/search", "/newsletter", "/design-system"] }],
    sitemap: `${siteUrl()}/sitemap.xml`,
  };
}
