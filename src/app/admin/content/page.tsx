import Link from "next/link";
import { Badge, Card, Check, Field, Flash, LinkButton, Page, Submit, Table, cellLink, dateTime } from "@/components/admin/ui";
import { getSettings } from "@/server/admin";
import { adminCtx } from "@/server/adminSession";
import { listPosts } from "@/server/backoffice";
import { can } from "@/server/permissions";
import { saveContent } from "../actions";

export const metadata = { title: "Website content" };

export default async function ContentPage({ searchParams }: PageProps<"/admin/content">) {
  const ctx = await adminCtx();
  if (!ctx.admin) return null;
  const [posts, settings, params] = await Promise.all([listPosts(ctx), can(ctx.admin.role, "ADMINISTRATOR", "settings") ? getSettings(ctx) : null, searchParams]);
  const content = settings?.content ?? {};
  const text = (key: string) => (typeof content[key] === "string" ? (content[key] as string) : "");

  return (
    <Page title="Website content" eyebrow={`${posts.filter((post) => post.isPublished).length} published article${posts.filter((post) => post.isPublished).length === 1 ? "" : "s"}`} actions={<LinkButton href="/admin/content/new" variant="primary">New article</LinkButton>}>
      <Flash params={params} />
      {settings && (
        <Card title="Announcement bar" description="One short line shown on every shop page, in a band above the footer: delivery cut-offs, holiday closures. Administrators only.">
          <form action={saveContent} className="grid gap-4 sm:grid-cols-2">
            <Field label="Message" name="announcement" maxLength={160} defaultValue={text("announcement")} className="sm:col-span-2" />
            <Field label="Link (optional)" name="announcementLink" defaultValue={text("announcementLink")} placeholder="/shipping-returns" hint="Start with / for a page on this site, or https:// for elsewhere." />
            <Check label="Show the announcement" name="announcementOn" defaultChecked={content.announcementOn === true} className="self-end" />
            <div className="sm:col-span-2">
              <Submit>Save announcement</Submit>
            </div>
          </form>
        </Card>
      )}
      <Card title="Journal" description="Articles and recipes. Published articles appear on the shop's Journal page, newest first, ahead of the built-in sample entries.">
        <Table head={["Title", "Kind", "State", "Address", "Updated"]} empty={posts.length === 0 ? "No articles yet. The Journal page shows its built-in sample entries until one is published." : undefined}>
          {posts.map((post) => (
            <tr key={post.id}>
              <td>
                <Link href={`/admin/content/${post.id}`} className={cellLink}>
                  {post.title}
                </Link>
              </td>
              <td>{post.kind}</td>
              <td>
                <Badge tone={post.isPublished ? "PAID" : undefined}>{post.isPublished ? "PUBLISHED" : "DRAFT"}</Badge>
              </td>
              <td className="font-mono text-[0.8125rem] text-stone-700">/journal/{post.slug}</td>
              <td className="whitespace-nowrap">{dateTime(post.updatedAt)}</td>
            </tr>
          ))}
        </Table>
      </Card>
      <Card title="Not editable here yet">
        <p className="text-stone-700">The home page sections, Our Story, Olive Groves, Harvest and the legal pages are still part of the site’s code. Product copy and photos are edited under Products.</p>
      </Card>
    </Page>
  );
}
