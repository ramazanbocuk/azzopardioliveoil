import Link from "next/link";
import { Card, Flash, Page, Stat, Table, cellLink } from "@/components/admin/ui";
import { adminCtx } from "@/server/adminSession";
import { STATE_LABEL, translationOverview, type TranslationState } from "@/server/translations";

export const metadata = { title: "Translations" };

const TONE: Record<TranslationState, string> = {
  missing: "bg-stone-300 text-ink",
  draft: "bg-gold-300 text-ink",
  published: "bg-olive-700 text-ivory",
  outdated: "bg-terracotta-700 text-ivory",
  changed: "bg-gold-300 text-ink",
};
const SHORT: Record<TranslationState, string> = { missing: "Missing", draft: "Draft", published: "Live", outdated: "Outdated", changed: "Live + draft" };

export default async function TranslationsPage({ searchParams }: PageProps<"/admin/translations">) {
  const ctx = await adminCtx();
  if (!ctx.admin) return null;
  const [overview, params] = await Promise.all([translationOverview(ctx), searchParams]);

  return (
    <Page title="Translations" eyebrow="Products, categories and journal articles">
      <Flash params={params} />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {overview.languages.map((language) => {
          const total = overview.totals[language.code];
          return <Stat key={language.code} label={language.name} value={`${total.live} of ${total.total} live`} note={`${total.missing} missing, ${total.attention} need attention`} />;
        })}
      </div>

      <Card
        title="How this works"
        description="English is written on the product, category or article itself. Each other language has a draft, which only staff see, and a published version, which is what customers see. Nothing appears in the shop until a manager publishes it. A record without a published translation is shown to customers in English, with a note saying so."
      >
        <ul className="text-small grid gap-x-8 gap-y-1 text-stone-700 sm:grid-cols-2">
          {(Object.keys(STATE_LABEL) as TranslationState[]).map((state) => (
            <li key={state}>
              <span className={`mr-2 inline-block px-2 py-0.5 text-[0.6875rem] font-medium uppercase tracking-[0.08em] ${TONE[state]}`}>{SHORT[state]}</span>
              {STATE_LABEL[state]}
            </li>
          ))}
        </ul>
        <p className="text-small mt-4 text-stone-700">
          Menus, buttons, checkout and emails are translated in the application itself, in all six languages, and are not edited here. Legal pages and the home and story pages are English only for now.
        </p>
      </Card>

      {overview.groups.map((group) => (
        <Card key={group.entity} title={group.label}>
          <Table head={["English", ...overview.languages.map((language) => language.name)]} empty={group.records.length === 0 ? "Nothing to translate yet." : undefined}>
            {group.records.map((record) => (
              <tr key={record.id}>
                <td>{record.title}</td>
                {overview.languages.map((language) => (
                  <td key={language.code}>
                    <Link href={`/admin/translations/${group.entity}/${record.id}/${language.code}`} className={cellLink} aria-label={`${record.title}, ${language.name}: ${STATE_LABEL[record.states[language.code]]}`}>
                      <span className={`inline-block whitespace-nowrap px-2 py-1 text-[0.6875rem] font-medium uppercase tracking-[0.08em] ${TONE[record.states[language.code]]}`}>{SHORT[record.states[language.code]]}</span>
                    </Link>
                  </td>
                ))}
              </tr>
            ))}
          </Table>
        </Card>
      ))}
    </Page>
  );
}
