import type { Metadata, Viewport } from "next";
import { switzer, zodiak } from "@/lib/fonts";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.APP_URL ?? "http://localhost:3000"),
  title: {
    default: "Azzopardi Olive Oil — Sicilian extra virgin olive oil",
    template: "%s — Azzopardi Olive Oil",
  },
  description: "Sicilian extra virgin olive oil, bottled by the lot and sent from Belgium.",
  alternates: { canonical: "/" },
  openGraph: { type: "website", siteName: "Azzopardi Olive Oil", locale: "en_BE", title: "Azzopardi Olive Oil", description: "Sicilian extra virgin olive oil, bottled by the lot and sent from Belgium." },
  twitter: { card: "summary" },
};

export const viewport: Viewport = {
  themeColor: "#f4efe4",
};

/**
 * Runs before first paint. Enables reveal animations only for visitors who
 * have not asked for reduced motion, and removes the flag again if the motion
 * bundle never arrives, so content can never stay hidden.
 */
const motionGate = `(function(){try{if(matchMedia('(prefers-reduced-motion: no-preference)').matches){var d=document.documentElement;d.classList.add('js-motion');setTimeout(function(){if(!window.__motionReady)d.classList.remove('js-motion')},4000)}}catch(e){}})()`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${zodiak.variable} ${switzer.variable} antialiased`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: motionGate }} />
      </head>
      <body className="flex min-h-svh flex-col">{children}</body>
    </html>
  );
}
