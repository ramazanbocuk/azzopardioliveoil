import { Card, Check, Field, Flash, LinkButton, Page, Select, Submit, TextArea, euros } from "@/components/admin/ui";
import { getProduct } from "@/server/admin";
import { adminCtx } from "@/server/adminSession";
import { adjustStock, deleteProduct, saveProduct, saveVariant } from "../../actions";

export const metadata = { title: "Product" };

export default async function ProductPage({ params, searchParams }: PageProps<"/admin/products/[id]">) {
  const ctx = await adminCtx();
  if (!ctx.admin) return null;
  const [{ id }, flash, categories] = await Promise.all([params, searchParams, ctx.db.category.findMany({ orderBy: { position: "asc" } })]);
  const product = id === "new" ? null : await getProduct(ctx, id);

  return (
    <Page title={product?.name ?? "New product"} eyebrow="Product" actions={<LinkButton href="/admin/products">All products</LinkButton>}>
      <Flash params={flash} />

      <form action={saveProduct.bind(null, product?.id ?? null)} className="space-y-8">
        <Card title="Details">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name" name="name" required defaultValue={product?.name} />
            <Field label="Web address" name="slug" required defaultValue={product?.slug} hint="Lowercase letters, numbers and hyphens. Appears in the page link." />
            <Select label="Category" name="categoryId" required defaultValue={product?.categoryId}>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </Select>
            <div className="flex items-end gap-6">
              <Check label="Visible in the shop" name="isVisible" defaultChecked={product?.isVisible} />
              <Check label="Featured" name="isFeatured" defaultChecked={product?.isFeatured} />
            </div>
            <Field label="Short description" name="blurb" defaultValue={product?.blurb} className="sm:col-span-2" />
            <TextArea label="Full description" name="description" rows={6} defaultValue={product?.description} className="sm:col-span-2" hint="Leave a blank line between paragraphs." />
          </div>
        </Card>

        <Card title="Label information" description="Shown on the product page exactly as entered. Leave a field empty if you do not have the confirmed information: the shop shows a dash rather than a guess. Food-labelling rules require these before the product is sold.">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Origin" name="origin" defaultValue={product?.origin ?? ""} />
            <Field label="Olive variety" name="cultivar" defaultValue={product?.cultivar ?? ""} />
            <TextArea label="Ingredients" name="ingredients" rows={2} defaultValue={product?.ingredients ?? ""} />
            <TextArea label="Storage" name="storage" rows={2} defaultValue={product?.storage ?? ""} />
            <Field label="Customs (HS) code" name="hsCode" inputMode="numeric" defaultValue={product?.hsCode ?? ""} hint="6 to 10 digits. Needed on labels for parcels leaving the EU. Confirm the code with your customs adviser." />
            <Field label="Country of origin" name="originCountry" maxLength={2} defaultValue={product?.originCountry ?? ""} hint="Two-letter code, such as IT." />
            <Field label="Customs description" name="customsDescription" defaultValue={product?.customsDescription ?? ""} hint="Plain description of the goods for the customs declaration." />
          </div>
          <p className="text-small mt-4 text-stone-700">The nutrition table, certifications and awards are not editable here yet. Harvest, mill and bottling dates are recorded per lot.</p>
        </Card>

        <Card title="Search engines">
          <div className="grid gap-4">
            <Field label="Page title" name="seoTitle" maxLength={70} defaultValue={product?.seoTitle ?? ""} hint="Up to 70 characters. Defaults to the product name." />
            <TextArea label="Description" name="seoDescription" maxLength={170} rows={2} defaultValue={product?.seoDescription ?? ""} hint="Up to 170 characters." />
          </div>
        </Card>

        <Submit>{product ? "Save product" : "Create product"}</Submit>
      </form>

      {product && (
        <>
          <Card title="Sizes, prices and stock" description="Each size is sold separately. Prices include VAT.">
            <div className="space-y-6">
              {[...product.variants, null].map((variant) => (
                <div key={variant?.id ?? "new"} className="border-b border-ink/10 pb-6 last:border-0 last:pb-0">
                  <form action={saveVariant.bind(null, product.id, variant?.id ?? null)} className="grid items-end gap-3 sm:grid-cols-3 xl:grid-cols-[1fr_1fr_0.7fr_0.8fr_0.8fr_0.8fr_0.7fr_auto_auto]">
                    <Field label={variant ? "Label" : "New size"} name="label" required defaultValue={variant?.label} placeholder="250 ml" />
                    <Field label="SKU" name="sku" required defaultValue={variant?.sku} />
                    <Field label="Volume (ml)" name="volumeMl" inputMode="numeric" required defaultValue={variant?.volumeMl} />
                    <Field label="Price (€)" name="priceCents" inputMode="decimal" required defaultValue={euros(variant?.priceCents)} />
                    <Field label="Was (€)" name="compareAtCents" inputMode="decimal" defaultValue={euros(variant?.compareAtCents)} />
                    <Field label="Weight (g)" name="weightGrams" inputMode="numeric" required defaultValue={variant?.weightGrams} />
                    <Field label="Low at" name="lowStockThreshold" inputMode="numeric" defaultValue={variant?.lowStockThreshold ?? 6} />
                    <Check label="On sale" name="isActive" defaultChecked={variant?.isActive ?? true} />
                    <Submit variant={variant ? "secondary" : "primary"}>{variant ? "Save" : "Add"}</Submit>
                  </form>
                  {variant && (
                    <form action={adjustStock.bind(null, product.id, variant.id)} className="mt-3 flex flex-wrap items-end gap-3 bg-[#f3f1ea] p-3">
                      <p className="mr-auto self-center text-[0.9375rem]">
                        <strong>{variant.stock}</strong> on hand · {variant.reserved} held by unpaid orders · <strong>{variant.stock - variant.reserved}</strong> available
                      </p>
                      <Field label="Add / remove" name="delta" inputMode="numeric" required placeholder="+24 or -2" className="w-32" />
                      <Select label="Reason" name="reason" className="w-40">
                        <option value="RECEIVED">Received</option>
                        <option value="ADJUSTMENT">Correction</option>
                        <option value="RETURN">Return</option>
                        <option value="DAMAGED">Damaged</option>
                      </Select>
                      <Field label="Note" name="note" className="w-48" />
                      <Submit variant="secondary">Update stock</Submit>
                    </form>
                  )}
                </div>
              ))}
            </div>
          </Card>

          <Card title="Remove product">
            <form action={deleteProduct.bind(null, product.id)} className="flex flex-wrap items-center justify-between gap-4">
              <p className="max-w-[60ch] text-stone-700">Removes the product from the shop. Past orders keep their record of it.</p>
              <Submit variant="danger">Remove from sale</Submit>
            </form>
          </Card>
        </>
      )}
    </Page>
  );
}
