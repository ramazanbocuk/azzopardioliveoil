import { Card, Check, Field, Flash, LinkButton, Page, Select, Submit, TextArea } from "@/components/admin/ui";
import { adminCtx } from "@/server/adminSession";
import { getPost } from "@/server/backoffice";
import { deletePost, savePost } from "../../actions";

export const metadata = { title: "Article" };

export default async function PostPage({ params, searchParams }: PageProps<"/admin/content/[id]">) {
  const ctx = await adminCtx();
  if (!ctx.admin) return null;
  const [{ id }, flash] = await Promise.all([params, searchParams]);
  const post = id === "new" ? null : await getPost(ctx, id);

  return (
    <Page title={post?.title ?? "New article"} eyebrow="Journal" actions={<>{post?.isPublished && <LinkButton href={`/journal/${post.slug}`} target="_blank">View on the shop</LinkButton>}<LinkButton href="/admin/content">All articles</LinkButton></>}>
      <Flash params={flash} />
      <Card>
        <form action={savePost.bind(null, post?.id ?? null)} className="grid gap-4 sm:grid-cols-2">
          <Field label="Title" name="title" required maxLength={160} defaultValue={post?.title ?? ""} className="sm:col-span-2" />
          <Field label="Address" name="slug" required defaultValue={post?.slug ?? ""} placeholder="how-we-harvest" hint="Lowercase letters, numbers and hyphens. Appears as /journal/address." />
          <Select label="Kind" name="kind" defaultValue={post?.kind ?? "Story"}>
            {["Story", "Recipe", "Guide", "News"].map((kind) => (
              <option key={kind} value={kind}>
                {kind}
              </option>
            ))}
          </Select>
          <TextArea label="Introduction" name="standfirst" rows={3} maxLength={400} defaultValue={post?.standfirst ?? ""} hint="One or two sentences shown under the title and on the Journal page." className="sm:col-span-2" />
          <TextArea label="Text" name="body" rows={18} defaultValue={post?.body ?? ""} hint="Plain text. Leave an empty line between paragraphs." className="sm:col-span-2" />
          <Check label="Published on the shop" name="isPublished" defaultChecked={post?.isPublished ?? false} className="sm:col-span-2" />
          <div className="sm:col-span-2">
            <Submit>{post ? "Save article" : "Create article"}</Submit>
            <p className="text-small mt-2 text-stone-700">Do not publish health or nutrition claims, awards or certifications that have not been verified.</p>
          </div>
        </form>
      </Card>
      {post && (
        <Card title="Delete">
          <form action={deletePost.bind(null, post.id)}>
            <Submit variant="danger">Delete this article</Submit>
          </form>
        </Card>
      )}
    </Page>
  );
}
