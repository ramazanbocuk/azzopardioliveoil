import Link from "next/link";
import { Suspense, ViewTransition, type ReactNode } from "react";
import { CookieNotice } from "@/components/account/PrivacyViews";
import { ApolloWrapper } from "@/lib/apollo";
import { getAnnouncement } from "@/server/storefrontData";
import { SmoothScroll } from "@/motion/SmoothScroll";
import { ToneShift } from "@/motion/ToneShift";
import { Footer } from "./Footer";
import { Header } from "./Header";
import "lenis/dist/lenis.css";

/** The line set under Website content in the admin panel. It sits above the footer so it never covers the header or a hero. */
async function Announcement() {
  const announcement = await getAnnouncement();
  if (!announcement) return null;
  return (
    <aside aria-label="Announcement" className="bg-olive-900 px-5 py-3 text-center text-ivory">
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
export function StoreChrome({ children }: { children: ReactNode }) {
  return (
    <ApolloWrapper>
      <a href="#main" className="text-label fixed left-4 top-4 z-[60] -translate-y-24 bg-olive-900 px-5 py-3 text-ivory transition-transform focus:translate-y-0">
        Skip to content
      </a>
      <Header />
      <main id="main" className="flex-1">
        <ViewTransition>{children}</ViewTransition>
      </main>
      <Suspense>
        <Announcement />
      </Suspense>
      <Footer />
      <CookieNotice />
      <SmoothScroll />
      <ToneShift />
    </ApolloWrapper>
  );
}
