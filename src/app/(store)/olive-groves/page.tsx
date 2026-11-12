import type { Metadata } from "next";
import { DraftBand, LeadPlate, NextPage, Split, Statement } from "@/components/ui/Editorial";
import { GroveScene } from "@/components/ui/GroveScene";
import { FactList, PageHeader } from "@/components/ui/Page";
import { Plate } from "@/components/ui/Plate";
import { Reveal } from "@/motion/Reveal";
import { SplitHeading } from "@/motion/SplitHeading";

export const metadata: Metadata = {
  title: "Our olive groves",
  description: "The Sicilian groves behind Azzopardi Olive Oil.",
  alternates: { canonical: "/olive-groves" },
};

export default function OliveGrovesPage() {
  return (
    <>
      <PageHeader eyebrow="Our olive groves" title="Where the trees stand." tone="#dddad1" lead="Every lot begins in a named grove. This page will introduce each one: where it is, what grows there, and how it is kept." />
      <DraftBand>Draft copy. Grove names, locations, altitudes, varieties and tree ages are recorded by the administrator and shown here once confirmed.</DraftBand>
      <LeadPlate label="the grove at midday" tone="dawn">
        <GroveScene id="groves-lead" tone="noon" seed={7} className="absolute inset-0 h-full w-full" />
      </LeadPlate>

      <section data-tone="#f7f3ea" className="py-section">
        <div className="container-page grid gap-x-8 gap-y-10 lg:grid-cols-12">
          <div className="lg:col-span-5">
            <Reveal>
              <p className="text-label text-stone-700">The grove record</p>
            </Reveal>
            <SplitHeading className="text-h2 mt-5 max-w-[14ch]">What we record about each grove.</SplitHeading>
            <Reveal delay={0.1}>
              <p className="mt-6 max-w-[44ch] text-ink/80">These are the facts a lot number leads back to. A dash means the value has not been entered yet.</p>
            </Reveal>
          </div>
          <Reveal className="lg:col-span-6 lg:col-start-7">
            <FactList
              rows={[
                { label: "Grove name", value: null },
                { label: "Municipality and province", value: null },
                { label: "Altitude", value: null },
                { label: "Olive varieties", value: null },
                { label: "Approximate age of the trees", value: null },
                { label: "Farming method", value: null },
              ]}
            />
          </Reveal>
        </div>
      </section>

      <Split
        tone="#f7f3ea"
        eyebrow="Through the year"
        title="The grove is never idle."
        paragraphs={[
          "Pruning in winter opens each tree to light and air. Spring brings flower, summer sets the fruit, and autumn decides the day of harvest.",
          "The journal follows the grove through the year, so you can see what the trees are doing while your bottle is on the shelf.",
        ]}
        plate={{ label: "pruning in winter", tone: "stone" }}
        cta={{ href: "/journal", label: "Read the journal" }}
      />

      <section data-tone="#eae3d3" className="py-section-sm">
        <div className="container-page grid grid-cols-2 gap-4 sm:gap-8 lg:grid-cols-4">
          {[
            { label: "blossom in spring", tone: "dawn" as const },
            { label: "green fruit in summer", tone: "olive" as const },
            { label: "nets laid for harvest", tone: "gold" as const },
            { label: "the grove after rain", tone: "terracotta" as const },
          ].map((plate, index) => (
            <Reveal key={plate.label} delay={index * 0.08} className={index % 2 ? "lg:pt-16" : undefined}>
              <div className="relative aspect-[3/4]">
                <Plate tone={plate.tone} label={plate.label} />
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      <Statement tone="#eae3d3">The island does most of the work. We try to stay out of its way.</Statement>
      <NextPage title="From branch to bottle." href="/harvest-production" label="Harvest & production" />
    </>
  );
}
