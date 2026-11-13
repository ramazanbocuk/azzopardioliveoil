"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useI18n } from "@/i18n/client";
import { splitLocale } from "@/i18n/config";

/** Pages whose own text exists in English only for now. Everything around them (menu, footer, shop, checkout) is translated. */
const ENGLISH_ONLY_PAGES = ["/", "/our-story", "/olive-groves", "/harvest-production", "/quality-traceability", "/faq", "/shipping-returns", "/privacy-policy", "/cookie-policy", "/terms-conditions", "/journal", "/design-system"];

export function isEnglishOnly(path: string): boolean {
  return ENGLISH_ONLY_PAGES.includes(path) || path.startsWith("/journal/");
}

/**
 * The page's main region. On a page that is still English inside another
 * language's address it says so, and marks the region as English so screen
 * readers pronounce it correctly; it never passes English off as a translation.
 */
export function MainRegion({ children }: { children: ReactNode }) {
  const { m, language, tag } = useI18n();
  const pathname = usePathname();
  const english = language !== "en" && isEnglishOnly(splitLocale(pathname).path);
  return (
    <main id="main" className="flex-1" lang={english ? "en" : undefined}>
      {children}
      {english && (
        <p lang={tag} role="note" data-english-only className="border-t border-ink/15 bg-paper px-5 py-4 text-center text-small text-stone-700">
          {m.common.englishOnly}
        </p>
      )}
    </main>
  );
}
