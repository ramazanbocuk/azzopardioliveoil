import { ENGLISH_ONLY } from "@/i18n/seo";
import { getI18n, localizedMetadata } from "@/i18n/server";
import { countryName } from "@/i18n/format";
import { DraftBand, LeadPlate, NextPage, Split, Statement } from "@/components/ui/Editorial";
import { GroveScene } from "@/components/ui/GroveScene";
import { Link } from "@/components/ui/Link";
import { FactList, PageHeader } from "@/components/ui/Page";
import { Plate } from "@/components/ui/Plate";
import { Reveal } from "@/motion/Reveal";
import { SplitHeading } from "@/motion/SplitHeading";
import { getCatalogData } from "@/server/storefrontData";

// The text of this page exists in English only for now, so it is not announced as translated.
export const generateMetadata = localizedMetadata("/olive-groves", {
  title: "Where the oils come from",
  description: "The countries, regions and producers behind the high-polyphenol olive oils Azzopardi sells.",
}, ENGLISH_ONLY);

type Origin = { country: string; oils: { slug: string; name: string; region: string | null; producer: string | null; place: string | null }[] };

/**
 * What is on sale now, grouped by the country recorded for each oil. Only
 * what the catalogue holds is shown: an oil with no country recorded is
 * listed apart, and a producer appears only when the owner has made it public.
 */
function originsOf(products: Awaited<ReturnType<typeof getCatalogData>>["products"], tag: string): { known: Origin[]; unrecorded: { slug: string; name: string }[] } {
  const byCountry = new Map<string, Origin>();
  const unrecorded: { slug: string; name: string }[] = [];
  for (const product of products) {
    const code = product.profile.country;
    if (!code) {
      unrecorded.push({ slug: product.slug, name: product.name });
      continue;
    }
    const origin = byCountry.get(code) ?? { country: countryName(tag, code), oils: [] };
    origin.oils.push({ slug: product.slug, name: product.name, region: product.profile.region, producer: product.profile.producer?.name ?? null, place: product.profile.producer?.place ?? null });
    byCountry.set(code, origin);
  }
  return { known: [...byCountry.values()].sort((a, b) => a.country.localeCompare(b.country)), unrecorded };
}

export default async function OriginsPage() {
  const { language, tag } = await getI18n();
  const { products } = await getCatalogData(language);
  const { known, unrecorded } = originsOf(products, tag);

  return (
    <>
      <PageHeader eyebrow="Where the oils come from" title="We follow the harvest season, country by country." tone="#dddad1" lead="We look for high-polyphenol olive oils wherever they are made, and follow the harvest season in each country we buy from: Morocco, Turkey, Italy, Greece and Spain. This page shows where each oil on sale today comes from, as it is recorded for that oil." />
      <DraftBand>Draft copy. Each producer’s own page (who they are, where they farm, which olives they grow) will be written with the owner and the producer. The list below is not draft: it is read from the catalogue.</DraftBand>
      <LeadPlate label="a grove at midday" tone="dawn">
        <GroveScene id="groves-lead" tone="noon" seed={7} className="absolute inset-0 h-full w-full" />
      </LeadPlate>

      <section data-tone="#f7f3ea" className="py-section">
        <div className="container-page grid gap-x-8 gap-y-10 lg:grid-cols-12">
          <div className="lg:col-span-5">
            <Reveal>
              <p className="text-label text-stone-700">On sale today</p>
            </Reveal>
            <SplitHeading className="text-h2 mt-5 max-w-[14ch]">Each oil, and where it is from.</SplitHeading>
            <Reveal delay={0.1}>
              <p className="mt-6 max-w-[44ch] text-ink/80">Country, region and producer are shown as they have been recorded for each oil. A dash means that detail has not been recorded yet. We leave it empty rather than guess.</p>
            </Reveal>
          </div>
          <Reveal className="lg:col-span-6 lg:col-start-7">
            {known.length === 0 && unrecorded.length === 0 && <p className="text-lead text-ink/80">No oil is on sale at the moment.</p>}
            <div className="space-y-12">
              {known.map((origin) => (
                <div key={origin.country}>
                  <h2 className="text-h3">{origin.country}</h2>
                  <ul className="mt-4 divide-y divide-ink/10 border-t border-ink/10">
                    {origin.oils.map((oil) => (
                      <li key={oil.slug} className="py-4">
                        <Link href={`/products/${oil.slug}`} className="link-underline font-medium">
                          {oil.name}
                        </Link>
                        <p className="text-small mt-1 text-stone-700">
                          Region: {oil.region ?? "—"} · Producer: {oil.producer ? `${oil.producer}${oil.place ? `, ${oil.place}` : ""}` : "—"}
                        </p>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
              {unrecorded.length > 0 && (
                <div>
                  <h2 className="text-h3">Origin not recorded yet</h2>
                  <ul className="mt-4 divide-y divide-ink/10 border-t border-ink/10">
                    {unrecorded.map((oil) => (
                      <li key={oil.slug} className="py-4">
                        <Link href={`/products/${oil.slug}`} className="link-underline font-medium">
                          {oil.name}
                        </Link>
                        <p className="text-small mt-1 text-stone-700">Country: — · Region: — · Producer: —</p>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </Reveal>
        </div>
      </section>

      <section data-tone="#f4efe4" className="py-section">
        <div className="container-page grid gap-x-8 gap-y-10 lg:grid-cols-12">
          <div className="lg:col-span-5">
            <Reveal>
              <p className="text-label text-stone-700">The producer record</p>
            </Reveal>
            <SplitHeading className="text-h2 mt-5 max-w-[14ch]">What we record about each producer.</SplitHeading>
            <Reveal delay={0.1}>
              <p className="mt-6 max-w-[44ch] text-ink/80">These are the facts a lot number leads back to. They appear on an oil’s page once they have been entered and confirmed.</p>
            </Reveal>
          </div>
          <Reveal className="lg:col-span-6 lg:col-start-7">
            <FactList
              rows={[
                { label: "Producer and town", value: null },
                { label: "Country and region", value: null },
                { label: "Olive varieties", value: null },
                { label: "Harvest year and method", value: null },
                { label: "Mill and extraction", value: null },
                { label: "Laboratory report for the lot", value: null },
              ]}
            />
          </Reveal>
        </div>
      </section>

      <Split
        tone="#f7f3ea"
        eyebrow="Why more than one country"
        title="Different ground, different olives, different oil."
        paragraphs={[
          "An oil from one shore of the Mediterranean does not taste like an oil from another. The varieties differ, and so do the soil, the weather and the day the fruit is picked.",
          "Choosing across five countries lets us offer oils that are unlike each other, and lets us pass over a harvest that did not turn out well.",
        ]}
        plate={{ label: "olives of different varieties", tone: "stone" }}
        cta={{ href: "/shop", label: "See the oils" }}
      />

      <section data-tone="#eae3d3" className="py-section-sm">
        <div className="container-page grid grid-cols-2 gap-4 sm:gap-8 lg:grid-cols-4">
          {[
            { label: "blossom in spring", tone: "dawn" as const },
            { label: "green fruit in summer", tone: "olive" as const },
            { label: "nets laid for harvest", tone: "gold" as const },
            { label: "a grove after rain", tone: "terracotta" as const },
          ].map((plate, index) => (
            <Reveal key={plate.label} delay={index * 0.08} className={index % 2 ? "lg:pt-16" : undefined}>
              <div className="relative aspect-[3/4]">
                <Plate tone={plate.tone} label={plate.label} />
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      <Statement tone="#eae3d3">The producer makes the oil. We choose it, and we tell you who made it.</Statement>
      <NextPage title="From the producer to your door." href="/harvest-production" label="Harvest & production" />
    </>
  );
}
