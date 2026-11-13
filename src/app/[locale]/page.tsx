import { Hero } from "@/components/home/Hero";
import { Process } from "@/components/home/Process";
import { Featured, Groves, Heritage, Intro, Journal, Newsletter, Philosophy, Testimonials, Traceability } from "@/components/home/Sections";
import { Showcase } from "@/components/home/Showcase";
import { GroveScene } from "@/components/ui/GroveScene";
import { JsonLd, siteUrl } from "@/components/ui/JsonLd";
import { ENGLISH_ONLY } from "@/i18n/seo";
import { getI18n, localizedMetadata } from "@/i18n/server";
import { getCatalogData } from "@/server/storefrontData";

// The home page's editorial text exists in English only for now.
export const generateMetadata = localizedMetadata("/", {}, ENGLISH_ONLY);

/**
 * Homepage — one harvest day, top to bottom:
 * dawn (hero, the house) → noon (heritage, groves) → afternoon (philosophy,
 * bottles) → dusk (production) → evening (traceability, table, letters).
 */
export default async function HomePage() {
  const { products, items } = await getCatalogData((await getI18n()).language);
  const featured = products[0];

  return (
    <>
      <JsonLd data={{ "@context": "https://schema.org", "@type": "Organization", name: "Azzopardi Olive Oil", url: siteUrl() }} />
      <Hero scene={<GroveScene id="hero" tone="dawn" seed={1} className="h-full w-full" />} />
      <Intro />
      {featured && <Showcase product={featured} />}
      <Heritage />
      <Groves />
      <Philosophy />
      <Featured items={items.slice(0, 3)} />
      <Process />
      <Traceability />
      <Testimonials />
      <Journal />
      <Newsletter />
    </>
  );
}
