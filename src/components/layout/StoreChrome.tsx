import { ViewTransition, type ReactNode } from "react";
import { CookieNotice } from "@/components/account/PrivacyViews";
import { ApolloWrapper } from "@/lib/apollo";
import { SmoothScroll } from "@/motion/SmoothScroll";
import { ToneShift } from "@/motion/ToneShift";
import { Footer } from "./Footer";
import { Header } from "./Header";
import "lenis/dist/lenis.css";

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
      <Footer />
      <CookieNotice />
      <SmoothScroll />
      <ToneShift />
    </ApolloWrapper>
  );
}
