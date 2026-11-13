import type { Metadata, Viewport } from "next";
import { StoreChrome } from "@/components/layout/StoreChrome";
import { I18nProvider } from "@/i18n/client";
import { LOCALE_CODES, tagOf } from "@/i18n/config";
import { getI18n } from "@/i18n/server";
import { switzer, zodiak } from "@/lib/fonts";
import "../globals.css";

/** Every locale is a root parameter; with Cache Components each must be listed here. */
export function generateStaticParams() {
  return LOCALE_CODES.map((locale) => ({ locale }));
}

export async function generateMetadata(): Promise<Metadata> {
  const { m, tag } = await getI18n();
  return {
    metadataBase: new URL(process.env.APP_URL ?? "http://localhost:3000"),
    title: { default: m.meta.title, template: "%s — Azzopardi" },
    description: m.meta.description,
    openGraph: { type: "website", siteName: "Azzopardi", locale: tag.replace("-", "_"), title: "Azzopardi", description: m.meta.description },
    twitter: { card: "summary" },
  };
}

export const viewport: Viewport = {
  themeColor: "#f4efe4",
};

/**
 * Runs before first paint. Enables reveal animations only for visitors who
 * have not asked for reduced motion, and removes the flag again if the motion
 * bundle never arrives, so content can never stay hidden.
 */
const motionGate = `(function(){try{if(matchMedia('(prefers-reduced-motion: no-preference)').matches){var d=document.documentElement;d.classList.add('js-motion');setTimeout(function(){if(!window.__motionReady)d.classList.remove('js-motion')},4000)}}catch(e){}})()`;

/** Root layout of the storefront. The admin panel has its own root layout and no locale. */
export default async function StoreRootLayout({ children }: LayoutProps<"/[locale]">) {
  const { locale, m } = await getI18n();
  return (
    <html lang={tagOf(locale)} className={`${zodiak.variable} ${switzer.variable} antialiased`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: motionGate }} />
      </head>
      <body className="flex min-h-svh flex-col">
        <I18nProvider locale={locale} messages={m}>
          <StoreChrome>{children}</StoreChrome>
        </I18nProvider>
      </body>
    </html>
  );
}
