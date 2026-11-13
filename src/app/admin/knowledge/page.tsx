import { Badge, Card, Check, Field, Flash, Page, Select, Submit, TextArea } from "@/components/admin/ui";
import { adminCtx } from "@/server/adminSession";
import { listArticles } from "@/server/assistantAdmin";
import { can } from "@/server/permissions";
import { deleteArticle, saveArticle } from "../actions";

export const metadata = { title: "Knowledge base" };

export default async function KnowledgePage({ searchParams }: PageProps<"/admin/knowledge">) {
  const ctx = await adminCtx();
  if (!ctx.admin) return null;
  const [articles, params] = await Promise.all([listArticles(ctx), searchParams]);
  const mayEdit = can(ctx.admin.role, "MANAGER", "assistant");
  const published = articles.filter((article) => article.isPublished).length;

  const form = (article: (typeof articles)[number] | null) => (
    <form action={saveArticle.bind(null, article?.id ?? null)} className="grid gap-4 sm:grid-cols-2">
      <Field label="Title" name="title" required defaultValue={article?.title} placeholder="How to store olive oil" disabled={!mayEdit} />
      <Field label="Address name" name="slug" required defaultValue={article?.slug} placeholder="how-to-store-olive-oil" hint="Lowercase letters, numbers and hyphens." disabled={!mayEdit} />
      <TextArea label="Article" name="body" required rows={8} defaultValue={article?.body} className="sm:col-span-2" disabled={!mayEdit} hint="Write it as you would say it to a customer, in English; the assistant answers in the customer's language. Facts about one product or one lot do not belong here: they come from the product's own data." />
      <Select label="Who may be told" name="audience" defaultValue={article?.audience ?? "customer"} disabled={!mayEdit}>
        <option value="customer">Customers</option>
        <option value="staff">Staff only (for the admin assistant, not yet built)</option>
      </Select>
      <div className="flex items-end justify-between gap-4">
        <Check label="Published: the assistant may quote it" name="isPublished" defaultChecked={article?.isPublished} disabled={!mayEdit} />
        {mayEdit && <Submit variant={article ? "secondary" : "primary"}>{article ? "Save" : "Add article"}</Submit>}
      </div>
    </form>
  );

  return (
    <Page title="Knowledge base" eyebrow={`${published} of ${articles.length} article${articles.length === 1 ? "" : "s"} published`}>
      <Flash params={params} />
      <Card
        title="What this is for"
        description="General knowledge the assistant may quote: how to store and use olive oil, what polyphenols, free acidity or a harvest year mean, how ordering and returns work. When a customer asks something no published article covers, the assistant says it does not know and offers to ask the team. An article is the shop speaking, so the same rule applies as on a product page: no health claims unless a food-law adviser has approved the wording."
      >
        {mayEdit ? form(null) : <p className="text-stone-700">Adding and publishing articles needs a manager for the assistant.</p>}
      </Card>
      {articles.map((article) => (
        <Card key={article.id} title={article.title}>
          <div className="mb-4 flex items-center justify-between gap-4">
            <Badge tone={article.isPublished ? "PAID" : "CANCELLED"}>{article.isPublished ? "Published" : "Draft"}</Badge>
            {mayEdit && (
              <form action={deleteArticle.bind(null, article.id)}>
                <Submit variant="danger">Delete</Submit>
              </form>
            )}
          </div>
          {form(article)}
        </Card>
      ))}
    </Page>
  );
}
