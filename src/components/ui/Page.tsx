import { Link } from "@/components/ui/Link";
import clsx from "clsx";
import type { ReactNode } from "react";
import { Reveal } from "@/motion/Reveal";
import { SplitHeading } from "@/motion/SplitHeading";

type Crumb = { href?: string; label: string };

export function Breadcrumbs({ items }: { items: Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb">
      <ol className="text-label flex flex-wrap items-center gap-x-3 gap-y-1 text-stone-700">
        {items.map((item, index) => (
          <li key={`${index}-${item.label}`} className="flex items-center gap-3">
            {index > 0 && <span aria-hidden="true">/</span>}
            {item.href ? (
              <Link href={item.href} className="link-underline inline-flex min-h-9 items-center">
                {item.label}
              </Link>
            ) : (
              <span aria-current="page" className="text-ink">
                {item.label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

type PageHeaderProps = {
  eyebrow?: string;
  title: string;
  lead?: string;
  crumbs?: Crumb[];
  /** Page ground while the header is on screen. */
  tone?: string;
  size?: "display" | "h1";
  children?: ReactNode;
};

/** Standard opening for every interior page. Clears the fixed header. */
export function PageHeader({ eyebrow, title, lead, crumbs, tone = "#f4efe4", size = "display", children }: PageHeaderProps) {
  return (
    <section data-tone={tone} className="pb-section-sm pt-[calc(var(--header-h)+clamp(2.5rem,7vw,6.5rem))]">
      <div className="container-page">
        {crumbs && <Breadcrumbs items={crumbs} />}
        {eyebrow && (
          <Reveal immediate delay={0.1} className={crumbs ? "mt-8" : undefined}>
            <p className="text-label text-stone-700">{eyebrow}</p>
          </Reveal>
        )}
        <SplitHeading as="h1" immediate delay={0.15} className={clsx(size === "display" ? "text-display max-w-[13ch]" : "text-h1 max-w-[18ch]", "mt-5")}>
          {title}
        </SplitHeading>
        {lead && (
          <Reveal immediate delay={0.5}>
            <p className="text-lead mt-8 max-w-[52ch] text-ink/80">{lead}</p>
          </Reveal>
        )}
        {children}
      </div>
    </section>
  );
}

/** States plainly that something on the page is not final or not live. */
export function Notice({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  return (
    <aside className={clsx("border border-dashed border-terracotta-700/60 bg-terracotta-500/[0.06] p-5", className)}>
      <p className="text-label text-terracotta-700">{title}</p>
      <div className="text-small mt-2 max-w-[75ch] text-ink/85">{children}</div>
    </aside>
  );
}

/**
 * Disclosure list built on native <details>, so it works without JavaScript
 * and is announced correctly. Items sharing a `name` close one another.
 */
export function Accordion({ items, name, defaultOpen }: { items: { title: string; content: ReactNode }[]; name: string; defaultOpen?: number }) {
  return (
    <div className="border-t border-ink/20">
      {items.map((item, index) => (
        <details key={item.title} name={name} open={index === defaultOpen} className="group/acc border-b border-ink/20">
          <summary className="flex min-h-16 cursor-pointer list-none items-center justify-between gap-6 py-4 [&::-webkit-details-marker]:hidden">
            <span className="text-h3 !text-[1.25rem] sm:!text-[1.5rem]">{item.title}</span>
            <span aria-hidden="true" className="relative block size-4 shrink-0">
              <span className="absolute inset-x-0 top-1/2 h-px bg-current" />
              <span className="absolute inset-y-0 left-1/2 w-px bg-current transition-transform duration-500 ease-out-expo group-open/acc:rotate-90" />
            </span>
          </summary>
          <div className="max-w-[68ch] pb-7 text-ink/80">{item.content}</div>
        </details>
      ))}
    </div>
  );
}

/** Definition rows for specifications. `null` renders as an em dash. */
export function FactList({ rows }: { rows: { label: string; value: string | null }[] }) {
  return (
    <dl className="divide-y divide-ink/10">
      {rows.map((row) => (
        <div key={row.label} className="flex items-baseline justify-between gap-6 py-2.5">
          <dt>{row.label}</dt>
          <dd className={clsx("text-right", row.value ? "text-ink" : "text-stone-700")}>{row.value ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Long-form copy with a calm measure. Used by articles and legal pages. */
export function Prose({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={clsx("prose-azz", className)}>{children}</div>;
}
