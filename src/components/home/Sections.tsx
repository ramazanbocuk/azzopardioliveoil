import { Emblem } from "@/components/brand/Logo";
import { Link } from "@/components/ui/Link";
import { ButtonLink } from "@/components/ui/Button";
import { GroveScene } from "@/components/ui/GroveScene";
import { ArrowIcon } from "@/components/ui/icons";
import { Plate } from "@/components/ui/Plate";
import { ProductCard } from "@/components/ui/ProductCard";
import { journal, type CatalogItem } from "@/content/site";
import { Reveal } from "@/motion/Reveal";
import { SplitHeading } from "@/motion/SplitHeading";
import { NewsletterForm, TraceForm } from "./Forms";

/* All copy below is draft. See src/content/site.ts. */

export function Intro() {
  return (
    <section id="house" data-tone="#dddad1" aria-labelledby="intro-title" className="scroll-mt-(--header-h) py-section">
      <div className="container-page grid gap-x-8 gap-y-10 lg:grid-cols-12">
        <Reveal className="lg:col-span-3">
          <p className="text-label text-stone-700">The house</p>
        </Reveal>
        <div className="lg:col-span-9">
          <SplitHeading id="intro-title" className="text-h1 max-w-[19ch]">
            High-polyphenol extra virgin olive oils from producers around the Mediterranean, chosen lot by lot by a family business.
          </SplitHeading>
          <Reveal delay={0.15} className="mt-10 grid gap-8 sm:grid-cols-2 lg:max-w-[52rem]">
            <p className="text-lead text-ink/80">We look for oils high in polyphenols, and we would rather show you the laboratory’s figure than ask you to take our word. So each bottle carries a number.</p>
            <div>
              <p className="text-ink/80">The number leads to a producer, a harvest and a mill. What we can show you, we publish. What we cannot show you, we do not say.</p>
              <ButtonLink href="/our-story" variant="text" arrow className="mt-5">
                Our story
              </ButtonLink>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

export function Heritage() {
  return (
    <section data-tone="#f7f3ea" aria-labelledby="heritage-title" className="py-section">
      <div className="container-page grid gap-x-8 gap-y-14 lg:grid-cols-12">
        <div className="lg:col-span-6">
          <div className="relative aspect-[4/5]">
            <Plate parallax={10} tone="olive" label="a producer in the grove" />
          </div>
        </div>

        <div className="flex flex-col justify-between gap-14 lg:col-span-5 lg:col-start-8 lg:pt-[8vw]">
          <div>
            <Reveal>
              <p className="text-label text-stone-700">Where the oils come from</p>
            </Reveal>
            <SplitHeading id="heritage-title" className="text-h2 mt-5 max-w-[15ch]">
              Morocco, Turkey, Italy, Greece, Spain. We go where the oil is good.
            </SplitHeading>
            <Reveal delay={0.1} className="mt-8 max-w-[44ch] space-y-5 text-ink/80">
              <p>The olive grows right around the Mediterranean, and no one shore has the best of it. Each country has its own varieties, its own ground and its own way of working.</p>
              <p>We are a husband and wife, and we do not grow or press the oil ourselves. Our part is to choose. We look for oils high in polyphenols, taste each lot, ask for its laboratory report, and offer only what we would put on our own table. The producer’s name stays on it.</p>
              <ButtonLink href="/our-story" variant="secondary" arrow className="!mt-9">
                Read the story
              </ButtonLink>
            </Reveal>
          </div>

          <div className="ml-auto w-3/5 lg:w-2/3">
            <div className="relative aspect-[4/3]">
              <Plate parallax={14} tone="terracotta" label="the mill" />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

export function Groves() {
  return (
    <section data-tone="#f7f3ea" aria-labelledby="groves-title" className="pb-section">
      <div className="container-page">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <Reveal>
              <p className="text-label text-stone-700">Producers &amp; harvest</p>
            </Reveal>
            <SplitHeading id="groves-title" className="text-h1 mt-4">
              In the grove
            </SplitHeading>
          </div>
          <Reveal>
            <ButtonLink href="/olive-groves" variant="text" arrow>
              See where each oil comes from
            </ButtonLink>
          </Reveal>
        </div>

        <div className="mt-14 grid grid-cols-6 gap-4 sm:gap-6 lg:grid-cols-12 lg:gap-8">
          <div className="col-span-6 lg:col-span-7">
            <div className="relative aspect-[3/2]">
              <Plate parallax={10} tone="dawn" label="the grove at midday">
                <GroveScene id="groves-noon" tone="noon" seed={4} className="absolute inset-0 h-full w-full" />
              </Plate>
            </div>
          </div>
          <div className="col-span-3 lg:col-span-3 lg:pt-[9vw]">
            <div className="relative aspect-[3/4]">
              <Plate parallax={14} tone="stone" label="nets under the trees" />
            </div>
          </div>
          <div className="col-span-3 lg:col-span-2 lg:pt-[3vw]">
            <div className="relative aspect-[3/4] lg:aspect-[2/3]">
              <Plate parallax={8} tone="gold" label="hands sorting fruit" />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

const principles = [
  { title: "High in polyphenols, by measurement", body: "We look for oils high in polyphenols, and we ask a laboratory rather than take anyone’s word for it. Then the oil has to taste right." },
  { title: "One lot, one number", body: "Each lot is kept apart under its own number, with its producer’s name. Lots are not blended to hide a weak one." },
  { title: "Say only what we can show", body: "Certificates, analyses and awards appear on a bottle’s page only when the documents exist." },
];

export function Philosophy() {
  return (
    <section data-tone="#eae3d3" aria-labelledby="philosophy-title" className="py-section">
      <div className="container-page">
        <div className="grid gap-x-8 gap-y-8 lg:grid-cols-12">
          <Reveal className="lg:col-span-3">
            <p className="text-label text-stone-700">How we choose</p>
          </Reveal>
          <SplitHeading id="philosophy-title" className="text-h1 max-w-[14ch] lg:col-span-9">
            Three rules. We wrote them down so you can hold us to them.
          </SplitHeading>
        </div>

        <ol className="mt-section-sm grid gap-x-8 gap-y-12 md:grid-cols-3">
          {principles.map((item, index) => (
            <li key={item.title}>
              <Reveal delay={index * 0.12} className="border-t border-ink/25 pt-6">
                <span aria-hidden="true" className="font-serif text-[clamp(3.5rem,6vw,6rem)] italic leading-none text-gold-700">
                  {index + 1}
                </span>
                <h3 className="text-h3 mt-8">{item.title}</h3>
                <p className="mt-4 max-w-[36ch] text-ink/80">{item.body}</p>
              </Reveal>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

export function Featured({ items }: { items: CatalogItem[] }) {
  if (items.length === 0) return null;
  return (
    <section data-tone="#f4efe4" aria-labelledby="featured-title" className="py-section">
      <div className="container-page">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <SplitHeading id="featured-title" className="text-h1">
            The bottles
          </SplitHeading>
          <Reveal>
            <ButtonLink href="/shop" variant="text" arrow>
              Shop all
            </ButtonLink>
          </Reveal>
        </div>
        <ul className="mt-14 grid gap-x-8 gap-y-14 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item, index) => (
            <li key={item.variant.sku}>
              <Reveal delay={index * 0.12}>
                <ProductCard item={item} />
              </Reveal>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

const ticketRows = ["Producer", "Harvest", "Milled", "Bottled"];

export function Traceability() {
  return (
    <section aria-labelledby="trace-title" className="grain bg-olive-900 text-ivory">
      <div className="container-page relative z-10 grid items-center gap-x-8 gap-y-16 py-section lg:grid-cols-12">
        <div className="lg:col-span-6">
          <Reveal>
            <p className="text-label text-gold-300">Quality &amp; traceability</p>
          </Reveal>
          <SplitHeading id="trace-title" className="text-h1 mt-5 max-w-[12ch]">
            Every bottle answers for itself.
          </SplitHeading>
          <Reveal delay={0.1}>
            <p className="text-lead mt-7 max-w-[40ch] text-ivory/85">Find the lot number on your label. Enter it, and see what has been recorded for that lot: producer, harvest, mill and any analysis on file.</p>
            <div className="mt-10">
              <TraceForm />
            </div>
            <ButtonLink href="/quality-traceability" variant="text" arrow className="mt-4 text-ivory">
              How we trace
            </ButtonLink>
          </Reveal>
        </div>

        <Reveal className="lg:col-span-5 lg:col-start-8" y={48}>
          <div className="mx-auto max-w-sm -rotate-2 bg-ivory p-7 text-ink shadow-[0_30px_60px_-30px_rgb(0_0_0/0.55)] sm:p-9">
            <p className="flex items-center gap-2.5 font-serif text-[1.125rem] uppercase tracking-[0.2em]">
              <Emblem className="h-9" />
              Azzopardi
            </p>
            <p className="text-ticket mt-1 text-stone-700">Lot ticket</p>
            <p className="mt-8 font-mono text-[clamp(2.25rem,4vw,3.25rem)] leading-none tracking-tight">AZ-0000</p>
            <dl className="text-ticket mt-8 grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 border-t border-dashed border-ink/40 pt-5">
              {ticketRows.map((row) => (
                <div key={row} className="contents">
                  <dt className="text-stone-700">{row}</dt>
                  <dd className="text-right">—</dd>
                </div>
              ))}
            </dl>
            <p className="text-ticket mt-6 border-t border-dashed border-ink/40 pt-4 text-terracotta-700">Sample ticket. Details are entered per lot.</p>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

export function Testimonials() {
  return (
    <section data-tone="#eae3d3" aria-labelledby="voices-title" className="py-section">
      <div className="container-page">
        <div className="grid gap-x-8 gap-y-6 lg:grid-cols-12">
          <Reveal className="lg:col-span-3">
            <p className="text-label text-stone-700">From our customers</p>
          </Reveal>
          <SplitHeading id="voices-title" className="text-h2 max-w-[20ch] lg:col-span-9">
            Reviews appear here once the first orders have been delivered and verified.
          </SplitHeading>
        </div>
        <ul className="mt-14 grid gap-8 md:grid-cols-3">
          {[0, 1, 2].map((index) => (
            <li key={index}>
              <Reveal delay={index * 0.12} className="flex h-full flex-col border border-dashed border-ink/30 p-7">
                <span aria-hidden="true" className="font-serif text-[4rem] leading-[0.6] text-gold-700">
                  “
                </span>
                <blockquote className="mt-4 flex-1 font-serif text-[1.375rem] italic leading-snug text-ink/80">A verified customer’s own words will be set here.</blockquote>
                <p className="text-ticket mt-8 text-stone-700">Name · City · Lot purchased</p>
              </Reveal>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

export function Journal() {
  return (
    <section data-tone="#f4efe4" aria-labelledby="journal-title" className="py-section">
      <div className="container-page">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <Reveal>
              <p className="text-label text-stone-700">Journal</p>
            </Reveal>
            <SplitHeading id="journal-title" className="text-h1 mt-4">
              At the table
            </SplitHeading>
          </div>
          <Reveal>
            <ButtonLink href="/journal" variant="text" arrow>
              All stories
            </ButtonLink>
          </Reveal>
        </div>

        <ul className="mt-14 grid gap-x-8 gap-y-14 md:grid-cols-3">
          {journal.map((entry, index) => (
            <li key={entry.title} className={index === 1 ? "md:pt-16" : undefined}>
              <Reveal delay={index * 0.12}>
                <article className="group/story relative">
                  <div className="relative aspect-[4/5] overflow-hidden">
                    <Plate tone={entry.tone} label={entry.label} className="transition-transform duration-[1400ms] ease-out-expo group-hover/story:scale-[1.04]" />
                  </div>
                  <p className="text-label mt-6 text-terracotta-700">{entry.kicker}</p>
                  <h3 className="text-h3 mt-3 max-w-[20ch]">
                    <Link href={`/journal/${entry.slug}`} className="after:absolute after:inset-0 after:content-['']">
                      {entry.title}
                    </Link>
                  </h3>
                  <span className="text-label mt-5 inline-flex items-center gap-3">
                    Read
                    <ArrowIcon className="size-4 transition-transform duration-500 ease-out-expo group-hover/story:translate-x-1" />
                  </span>
                </article>
              </Reveal>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

export function Newsletter() {
  return (
    <section aria-labelledby="newsletter-title" className="grain bg-terracotta-700 text-ivory">
      <div className="container-page relative z-10 grid gap-x-8 gap-y-12 py-section-sm lg:grid-cols-12 lg:items-end">
        <div className="lg:col-span-6">
          <SplitHeading id="newsletter-title" className="text-h1 max-w-[12ch]">
            Letters from the house
          </SplitHeading>
          <Reveal delay={0.1}>
            <p className="text-lead mt-6 max-w-[38ch] text-ivory/90">A few times a year: when a harvest comes in, when a new lot arrives, and something to cook.</p>
          </Reveal>
        </div>
        <Reveal className="lg:col-span-5 lg:col-start-8">
          <NewsletterForm />
          <p className="text-small text-ivory/85">
            You can unsubscribe at any time. See our{" "}
            <Link href="/privacy-policy" className="underline underline-offset-4">
              privacy policy
            </Link>
            .
          </p>
        </Reveal>
      </div>
    </section>
  );
}
