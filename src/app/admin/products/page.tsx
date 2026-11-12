import Link from "next/link";
import { Badge, Card, Check, Field, Flash, LinkButton, Page, Submit, Table, cellLink, money } from "@/components/admin/ui";
import { listProducts } from "@/server/admin";
import { adminCtx } from "@/server/adminSession";
import { saveCategory } from "../actions";

export const metadata = { title: "Products" };

export default async function ProductsPage({ searchParams }: PageProps<"/admin/products">) {
  const ctx = await adminCtx();
  if (!ctx.admin) return null;
  const [products, categories, params] = await Promise.all([listProducts(ctx), ctx.db.category.findMany({ orderBy: { position: "asc" } }), searchParams]);

  return (
    <Page title="Products" eyebrow="Catalogue" actions={<LinkButton href="/admin/products/new" variant="primary">New product</LinkButton>}>
      <Flash params={params} />
      <Card>
        <Table head={["Product", "Category", "Sizes", "Price", "Available", "Shop"]} empty={products.length === 0 ? "No products yet." : undefined}>
          {products.map((product) => {
            const prices = product.variants.map((v) => v.priceCents);
            const available = product.variants.reduce((sum, v) => sum + (v.stock - v.reserved), 0);
            return (
              <tr key={product.id}>
                <td>
                  <Link href={`/admin/products/${product.id}`} className={cellLink}>
                    {product.name}
                  </Link>
                </td>
                <td>{product.category.name}</td>
                <td>{product.variants.map((v) => v.label).join(", ") || "—"}</td>
                <td className="tabular-nums">{prices.length ? `${money(Math.min(...prices))}${Math.max(...prices) !== Math.min(...prices) ? ` – ${money(Math.max(...prices))}` : ""}` : "—"}</td>
                <td className={available <= 0 ? "text-terracotta-700" : "tabular-nums"}>{available <= 0 ? "Sold out" : available}</td>
                <td>
                  <Badge tone={product.isVisible ? "PAID" : "CANCELLED"}>{product.isVisible ? "Visible" : "Hidden"}</Badge>
                </td>
              </tr>
            );
          })}
        </Table>
      </Card>

      <Card title="Categories" description="Each category has its own page in the shop.">
        <div className="space-y-4">
          {categories.map((category) => (
            <form key={category.id} action={saveCategory.bind(null, category.id)} className="grid items-end gap-3 sm:grid-cols-[1fr_1fr_2fr_auto_auto]">
              <Field label="Name" name="name" defaultValue={category.name} required />
              <Field label="Web address" name="slug" defaultValue={category.slug} required />
              <Field label="Introduction" name="intro" defaultValue={category.intro} />
              <Check label="Visible" name="isVisible" defaultChecked={category.isVisible} />
              <Submit variant="secondary">Save</Submit>
            </form>
          ))}
          <form action={saveCategory.bind(null, null)} className="grid items-end gap-3 border-t border-ink/10 pt-4 sm:grid-cols-[1fr_1fr_2fr_auto_auto]">
            <Field label="New category" name="name" required />
            <Field label="Web address" name="slug" required placeholder="gift-sets" />
            <Field label="Introduction" name="intro" />
            <Check label="Visible" name="isVisible" defaultChecked />
            <Submit>Add</Submit>
          </form>
        </div>
      </Card>
    </Page>
  );
}
