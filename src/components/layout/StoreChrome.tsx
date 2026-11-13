import { Link } from "@/components/ui/Link";
import { getI18n } from "@/i18n/server";
import { Suspense, ViewTransition, type ReactNode } from "react";
import { CookieNotice } from "@/components/account/PrivacyViews";
import { ApolloWrapper } from "@/lib/apollo";
import { getAnnouncement, getShippingCountries } from "@/server/storefrontData";
import { SmoothScroll } from "@/motion/SmoothScroll";
import { ToneShift } from "@/motion/ToneShift";
import { Footer } from "./Footer";
import { Header } from "./Header";
import { LanguagePrompt } from "./LocaleSelector";
import { MainRegion } from "./MainRegion";
import "lenis/dist/lenis.css";

/** The line set under Website content in the admin panel. It sits above the footer so it never covers the header or a hero. */
async function Announcement() {
  const [announcement, { m }] = await Promise.all([getAnnouncement(), getI18n()]);
  if (!announcement) return null;
  return (
    <aside aria-label={m.common.announcement} className="bg-olive-900 px-5 py-3 text-center text-ivory">
      <p className="text-small">
        {announcement.link ? (
          <Link href={announcement.link} className="underline underline-offset-4">
            {announcement.text}
          </Link>
        ) : (
          announcement.text
        )}
      </p>
    </aside>
  );
}

/** Everything that surrounds a storefront page. The admin panel has its own shell. */
export async function StoreChrome({ children }: { children: ReactNode }) {
  const [{ m }, countries] = await Promise.all([getI18n(), getShippingCountries()]);
  const codes = countries.map((country) => country.code);
  return (
    <ApolloWrapper>
      <a href="#main" className="text-label fixed left-4 top-4 z-[60] -translate-y-24 bg-olive-900 px-5 py-3 text-ivory transition-transform focus:translate-y-0">
        {m.common.skip}
      </a>
      <Header countries={codes} />
      <LanguagePrompt />
      {/* The address is only known per request, so anything that reads it sits behind Suspense; the fallback is the same region without the English-only marker. */}
      <Suspense
        fallback={
          <main id="main" className="flex-1">
            <ViewTransition>{children}</ViewTransition>
          </main>
        }
      >
        <MainRegion>
          <ViewTransition>{children}</ViewTransition>
        </MainRegion>
      </Suspense>
      <Suspense>
        <Announcement />
      </Suspense>
      <Footer />
      <CookieNotice />
      <Suspense>
        <SmoothScroll />
        <ToneShift />
      </Suspense>
    </ApolloWrapper>
  );
}
