import type { Metadata } from "next";
import Link from "next/link";
import { DraftBand } from "@/components/ui/Editorial";
import { ArrowIcon } from "@/components/ui/icons";
import { PageHeader } from "@/components/ui/Page";
import { Plate } from "@/components/ui/Plate";
import { journal } from "@/content/site";
import { Reveal } from "@/motion/Reveal";

export const metadata: Metadata = {
  title: "Journal",
  description: "Recipes, the table, and news from the groves.",
  alternates: { canonical: "/journal" },
};

export default function JournalPage() {
  const [lead, ...rest] = journal;
  return (
    <>
      <PageHeader eyebrow="Journal" title="At the table, and in the grove." lead="Recipes, notes from the harvest, and the Mediterranean way of eating well with very little." />
      <DraftBand>Draft articles to show the layout. Published pieces are written and photographed by the house and managed from the admin panel.</DraftBand>

      <section className="container-page pb-section">
        <Reveal>
          <article className="group/story relative grid items-end gap-x-8 gap-y-6 lg:grid-cols-12">
            <div className="relative aspect-[4/3] overflow-hidden lg:col-span-8 lg:aspect-[16/9]">
              <Plate tone={lead.tone} label={lead.label} className="transition-transform duration-[1400ms] ease-out-expo group-hover/story:scale-[1.03]" />
            </div>
            <div className="lg:col-span-4 lg:pb-4">
              <p className="text-label text-terracotta-700">{lead.kicker}</p>
              <h2 className="text-h2 mt-4">
                <Link href={`/journal/${lead.slug}`} className="after:absolute after:inset-0 after:content-['']">
                  {lead.title}
                </Link>
              </h2>
              <p className="mt-4 text-ink/80">{lead.standfirst}</p>
              <span className="text-label mt-6 inline-flex items-center gap-3">
                Read
                <ArrowIcon className="size-4 transition-transform duration-500 ease-out-expo group-hover/story:translate-x-1" />
              </span>
            </div>
          </article>
        </Reveal>

        <ul className="mt-section-sm grid gap-x-8 gap-y-14 md:grid-cols-2">
          {rest.map((entry, index) => (
            <li key={entry.slug}>
              <Reveal delay={index * 0.1}>
                <article className="group/story relative">
                  <div className="relative aspect-[4/3] overflow-hidden">
                    <Plate tone={entry.tone} label={entry.label} className="transition-transform duration-[1400ms] ease-out-expo group-hover/story:scale-[1.03]" />
                  </div>
                  <p className="text-label mt-6 text-terracotta-700">{entry.kicker}</p>
                  <h2 className="text-h3 mt-3 max-w-[24ch]">
                    <Link href={`/journal/${entry.slug}`} className="after:absolute after:inset-0 after:content-['']">
                      {entry.title}
                    </Link>
                  </h2>
                  <p className="mt-3 max-w-[48ch] text-ink/80">{entry.standfirst}</p>
                </article>
              </Reveal>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
