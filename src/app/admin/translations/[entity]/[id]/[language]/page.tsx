import { notFound } from "next/navigation";
import { Card, Field, Flash, LinkButton, Page, Submit, Table, TextArea, dateTime } from "@/components/admin/ui";
import { adminCtx } from "@/server/adminSession";
import { AppError } from "@/server/errors";
import { can } from "@/server/permissions";
import { ENTITY_LABEL, STATE_LABEL, getTranslation } from "@/server/translations";
import { publishTranslationAction, saveTranslationAction, unpublishTranslationAction } from "../../../../actions";

export const metadata = { title: "Translation" };

const ACTION: Record<string, string> = { draft: "Draft saved", publish: "Published", unpublish: "Taken off the shop" };

export default async function TranslationPage({ params, searchParams }: PageProps<"/admin/translations/[entity]/[id]/[language]">) {
  const ctx = await adminCtx();
  if (!ctx.admin) return null;
  const [{ entity, id, language }, flash] = await Promise.all([params, searchParams]);
  const data = await getTranslation(ctx, entity, id, language).catch((error) => {
    if (error instanceof AppError && (error.code === "NOT_FOUND" || error.code === "BAD_INPUT")) notFound();
    throw error;
  });
  const mayPublish = can(ctx.admin.role, "MANAGER", "content");
  const mayEdit = can(ctx.admin.role, "STAFF", "content");
  const regulated = data.fields.some((field) => field.regulated);

  return (
    <Page title={`${data.record.title} — ${data.languageName}`} eyebrow={`${ENTITY_LABEL[data.entity]} · ${STATE_LABEL[data.state]}`} actions={<LinkButton href="/admin/translations">All translations</LinkButton>}>
      <Flash params={flash} />
      {data.state === "outdated" && <p role="alert" className="border-l-2 border-terracotta-700 bg-terracotta-500/10 px-4 py-3 text-terracotta-700">The English text has changed since this translation was published. Check each field against the English, then publish again.</p>}

      <Card title="Translate" description="Saving keeps a draft that only staff can see. Customers keep seeing the published version, or English if there is none, until a manager publishes.">
        <form action={saveTranslationAction.bind(null, data.entity, data.record.id, data.language)} className="space-y-6">
          {data.fields.map((field) => {
            const live = data.published?.[field.key];
            const draft = data.draft[field.key] ?? "";
            return (
              <div key={field.key} className="grid gap-4 border-b border-ink/10 pb-6 last:border-0 lg:grid-cols-2">
                <div>
                  <p className="text-small font-medium">{field.label} — English</p>
                  <p lang="en" className="mt-1.5 whitespace-pre-wrap border border-ink/10 bg-stone-300/20 px-3 py-2 text-[0.9375rem] text-stone-700">
                    {data.record.fields[field.key] || "—"}
                  </p>
                  {field.regulated && <p className="text-small mt-1 text-terracotta-700">Food-label wording: have it checked by someone qualified before publishing.</p>}
                </div>
                <div>
                  {field.long ? (
                    <TextArea label={`${field.label} — ${data.languageName}`} name={field.key} defaultValue={draft} rows={8} maxLength={field.max} lang={data.language} disabled={!mayEdit} />
                  ) : (
                    <Field label={`${field.label} — ${data.languageName}`} name={field.key} defaultValue={draft} maxLength={field.max} lang={data.language} disabled={!mayEdit} required={field.required} />
                  )}
                  {live !== undefined && live !== draft && (
                    <p className="text-small mt-1 text-stone-700">
                      On the shop now: <span lang={data.language}>{live}</span>
                    </p>
                  )}
                </div>
              </div>
            );
          })}
          {mayEdit && <Submit>Save draft</Submit>}
        </form>
      </Card>

      <Card title="Publish" description={mayPublish ? "Publishing replaces what customers see in this language with the saved draft. Save first: unsaved typing above is not published." : "Publishing needs a manager for website content."}>
        {regulated && <p className="text-small mb-4 text-stone-700">Origin, variety, ingredients and storage are food information. A wrong translation of those is a labelling error, not a style issue.</p>}
        <div className="flex flex-wrap gap-3">
          {mayPublish && (
            <form action={publishTranslationAction.bind(null, data.entity, data.record.id, data.language)}>
              <Submit>Publish the saved draft</Submit>
            </form>
          )}
          {mayPublish && data.published && (
            <form action={unpublishTranslationAction.bind(null, data.entity, data.record.id, data.language)}>
              <Submit variant="secondary">Take off the shop</Submit>
            </form>
          )}
        </div>
        {data.publishedAt && <p className="text-small mt-4 text-stone-700">Last published {dateTime(data.publishedAt)}.</p>}
      </Card>

      <Card title="History">
        <Table head={["When", "What", "By", "Name or title at that point"]} empty={data.history.length === 0 ? "Nothing has been saved yet." : undefined}>
          {data.history.map((entry) => (
            <tr key={entry.id}>
              <td className="whitespace-nowrap">{dateTime(entry.at)}</td>
              <td>{ACTION[entry.action] ?? entry.action}</td>
              <td>{entry.by}</td>
              <td lang={data.language}>{entry.fields.name ?? entry.fields.title ?? "—"}</td>
            </tr>
          ))}
        </Table>
      </Card>
    </Page>
  );
}
