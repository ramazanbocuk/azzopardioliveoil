import type { Metadata } from "next";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { LeadPlate, NextPage } from "@/components/ui/Editorial";
import { Notice, PageHeader, Prose } from "@/components/ui/Page";
import { journal } from "@/content/site";
import { getJournalEntries } from "@/server/storefrontData";

export function generateStaticParams() {
  return journal.map((entry) => ({ slug: entry.slug }));
}

export async function generateMetadata({ params }: PageProps<"/journal/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const entry = (await getJournalEntries()).entries.find((candidate) => candidate.slug === slug);
  if (!entry) return {};
  return { title: entry.title, description: entry.standfirst, alternates: { canonical: `/journal/${entry.slug}` } };
}

/**
 * `params` is URL data, so it is read inside a Suspense boundary: the shell
 * can be shown instantly on navigation and the content streams into it.
 */
export default function JournalEntryPage({ params }: PageProps<"/journal/[slug]">) {
  return (
    <Suspense fallback={<div className="min-h-svh" />}>
      <JournalEntryPageContent params={params} />
    </Suspense>
  );
}

async function JournalEntryPageContent({ params }: Pick<PageProps<"/journal/[slug]">, "params">) {
  const { slug } = await params;
  const { entries, fromAdmin } = await getJournalEntries();
  const entry = entries.find((candidate) => candidate.slug === slug);
  if (!entry) notFound();

  const next = entries[(entries.indexOf(entry) + 1) % entries.length];
  const isSample = entries.indexOf(entry) >= fromAdmin;

  return (
    <article>
      <PageHeader crumbs={[{ href: "/journal", label: "Journal" }, { label: entry.kind }]} eyebrow={entry.kicker} title={entry.title} lead={entry.standfirst} size="h1" />
      <LeadPlate label={entry.label} tone={entry.tone} />

      <div className="container-page grid gap-x-8 gap-y-12 py-section-sm lg:grid-cols-12">
        <Prose className="text-lead order-2 lg:order-1 lg:col-span-7 lg:col-start-2">
          {entry.body.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}

          {entry.recipe && (
            <>
              <h2>Method</h2>
              <ol>
                {entry.recipe.method.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
            </>
          )}
        </Prose>

        {entry.recipe && (
          <aside aria-label="Recipe details" className="order-1 lg:order-2 lg:col-span-3 lg:col-start-10">
            <div className="bg-paper p-7 lg:sticky lg:top-[calc(var(--header-h)+2rem)]">
              <p className="text-ticket text-stone-700">
                {entry.recipe.serves} · {entry.recipe.time}
              </p>
              <h2 className="text-h3 mt-4">Ingredients</h2>
              <ul className="mt-4 divide-y divide-ink/15">
                {entry.recipe.ingredients.map((ingredient) => (
                  <li key={ingredient} className="py-2.5">
                    {ingredient}
                  </li>
                ))}
              </ul>
            </div>
          </aside>
        )}

        {isSample && (
          <Notice title="Draft article" className="order-3 lg:col-span-7 lg:col-start-2">
            Placeholder text and no photography yet. Journal entries are written and published from the admin panel.
          </Notice>
        )}
      </div>

      <NextPage eyebrow="Read next" title={next.title} href={`/journal/${next.slug}`} label="Read" />
    </article>
  );
}
