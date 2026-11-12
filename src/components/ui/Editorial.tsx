import clsx from "clsx";
import type { ReactNode } from "react";
import { ButtonLink } from "@/components/ui/Button";
import { Plate, type PlateTone } from "@/components/ui/Plate";
import { Reveal } from "@/motion/Reveal";
import { SplitHeading } from "@/motion/SplitHeading";

/** Wide opening image under a page header. */
export function LeadPlate({ label, tone = "olive", children }: { label: string; tone?: PlateTone; children?: ReactNode }) {
  return (
    <div className="container-page">
      <div className="relative aspect-[4/5] sm:aspect-[16/9] lg:aspect-[21/9]">
        <Plate parallax={8} tone={tone} label={label}>
          {children}
        </Plate>
      </div>
    </div>
  );
}

type SplitProps = {
  eyebrow?: string;
  title: string;
  paragraphs: string[];
  plate: { label: string; tone?: PlateTone; ratio?: string };
  flip?: boolean;
  tone?: string;
  cta?: { href: string; label: string };
};

/** Image beside text. `flip` puts the image on the right. */
export function Split({ eyebrow, title, paragraphs, plate, flip = false, tone, cta }: SplitProps) {
  return (
    <section data-tone={tone} className="py-section-sm lg:py-section">
      <div className="container-page grid items-center gap-x-8 gap-y-10 lg:grid-cols-12">
        <div className={clsx("lg:col-span-6", flip && "lg:order-2 lg:col-start-7")}>
          <div className={clsx("relative", plate.ratio ?? "aspect-[4/5]")}>
            <Plate parallax={10} tone={plate.tone} label={plate.label} />
          </div>
        </div>
        <div className={clsx("lg:col-span-5", flip ? "lg:order-1 lg:col-start-1" : "lg:col-start-8")}>
          {eyebrow && (
            <Reveal>
              <p className="text-label text-stone-700">{eyebrow}</p>
            </Reveal>
          )}
          <SplitHeading className="text-h2 mt-5 max-w-[16ch]">{title}</SplitHeading>
          <Reveal delay={0.1} className="mt-7 max-w-[46ch] space-y-5 text-ink/80">
            {paragraphs.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
            {cta && (
              <ButtonLink href={cta.href} variant="secondary" arrow className="!mt-9">
                {cta.label}
              </ButtonLink>
            )}
          </Reveal>
        </div>
      </div>
    </section>
  );
}

/** One large sentence, alone. */
export function Statement({ children, tone, attribution }: { children: string; tone?: string; attribution?: string }) {
  return (
    <section data-tone={tone} className="py-section">
      <div className="container-page">
        <SplitHeading as="p" className="text-h1 mx-auto max-w-[20ch] text-center">
          {children}
        </SplitHeading>
        {attribution && <p className="text-label mt-8 text-center text-stone-700">{attribution}</p>}
      </div>
    </section>
  );
}

/** Numbered points in columns. */
export function Points({ eyebrow, title, items, tone }: { eyebrow?: string; title: string; items: { title: string; body: string }[]; tone?: string }) {
  return (
    <section data-tone={tone} className="py-section">
      <div className="container-page">
        <div className="grid gap-x-8 gap-y-6 lg:grid-cols-12">
          <Reveal className="lg:col-span-3">{eyebrow && <p className="text-label text-stone-700">{eyebrow}</p>}</Reveal>
          <SplitHeading className="text-h1 max-w-[15ch] lg:col-span-9">{title}</SplitHeading>
        </div>
        <ol className={clsx("mt-section-sm grid gap-x-8 gap-y-12", items.length === 4 ? "md:grid-cols-2 xl:grid-cols-4" : "md:grid-cols-3")}>
          {items.map((item, index) => (
            <li key={item.title}>
              <Reveal delay={index * 0.1} className="border-t border-ink/25 pt-6">
                <span aria-hidden="true" className="font-serif text-[clamp(3rem,5vw,5rem)] italic leading-none text-gold-700">
                  {index + 1}
                </span>
                <h3 className="text-h3 mt-7">{item.title}</h3>
                <p className="mt-4 max-w-[38ch] text-ink/80">{item.body}</p>
              </Reveal>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

/** Closing band that hands the reader to the next page. */
export function NextPage({ eyebrow = "Next", title, href, label }: { eyebrow?: string; title: string; href: string; label: string }) {
  return (
    <section className="grain bg-olive-900 text-ivory">
      <div className="container-page relative z-10 flex flex-col items-start gap-8 py-section-sm lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-label text-gold-300">{eyebrow}</p>
          <SplitHeading className="text-h1 mt-4 max-w-[16ch]">{title}</SplitHeading>
        </div>
        <ButtonLink href={href} variant="inverse" arrow>
          {label}
        </ButtonLink>
      </div>
    </section>
  );
}

/** Banner for pages whose copy is still draft. */
export function DraftBand({ children }: { children: ReactNode }) {
  return (
    <div className="container-page pb-10">
      <p className="text-small border-l-2 border-terracotta-700 pl-4 text-ink/80">{children}</p>
    </div>
  );
}
