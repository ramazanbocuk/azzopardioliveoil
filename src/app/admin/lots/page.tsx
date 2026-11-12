import { Badge, Card, Check, Field, Flash, Page, Select, Submit, TextArea, isoDay } from "@/components/admin/ui";
import { adminCtx } from "@/server/adminSession";
import { saveBatch } from "../actions";

export const metadata = { title: "Lots" };

export default async function LotsPage({ searchParams }: PageProps<"/admin/lots">) {
  const ctx = await adminCtx();
  if (!ctx.admin) return null;
  const [batches, products, params] = await Promise.all([
    ctx.db.batch.findMany({ orderBy: { createdAt: "desc" }, include: { product: true, documents: true } }),
    ctx.db.product.findMany({ where: { deletedAt: null }, orderBy: { name: "asc" } }),
    searchParams,
  ]);

  const form = (batch: (typeof batches)[number] | null) => (
    <form action={saveBatch.bind(null, batch?.id ?? null)} className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <Field label="Lot number" name="lotNumber" required defaultValue={batch?.lotNumber} placeholder="AZ-0001" />
      <Select label="Product" name="productId" required defaultValue={batch?.productId}>
        {products.map((product) => (
          <option key={product.id} value={product.id}>
            {product.name}
          </option>
        ))}
      </Select>
      <Field label="Grove" name="grove" defaultValue={batch?.grove ?? ""} />
      <Field label="Mill" name="mill" defaultValue={batch?.mill ?? ""} />
      <Field label="Harvest date" name="harvestDate" type="date" defaultValue={isoDay(batch?.harvestDate)} />
      <Field label="Milled" name="milledAt" type="date" defaultValue={isoDay(batch?.milledAt)} />
      <Field label="Bottled" name="bottledAt" type="date" defaultValue={isoDay(batch?.bottledAt)} />
      <Field label="Best before" name="bestBefore" type="date" defaultValue={isoDay(batch?.bestBefore)} />
      <TextArea label="Internal notes" name="notes" rows={2} defaultValue={batch?.notes ?? ""} className="sm:col-span-2 xl:col-span-3" />
      <div className="flex items-end justify-between gap-4">
        <Check label="Published" name="isPublished" defaultChecked={batch?.isPublished} />
        <Submit variant={batch ? "secondary" : "primary"}>{batch ? "Save" : "Create lot"}</Submit>
      </div>
    </form>
  );

  return (
    <Page title="Lots" eyebrow="Traceability">
      <Flash params={params} />
      <Card title="New lot" description="A lot is one bottling. Once published, anyone who enters its number on the site sees what is recorded here. Enter only what you can document; empty fields show as a dash.">
        {form(null)}
      </Card>
      {batches.map((batch) => (
        <Card key={batch.id} title={`${batch.lotNumber} · ${batch.product.name}`}>
          <div className="mb-4 flex items-center gap-3">
            <Badge tone={batch.isPublished ? "PAID" : "CANCELLED"}>{batch.isPublished ? "Published" : "Draft"}</Badge>
            <span className="text-small text-stone-700">{batch.documents.length} document{batch.documents.length === 1 ? "" : "s"} on file</span>
          </div>
          {form(batch)}
        </Card>
      ))}
      <p className="text-small text-stone-700">Uploading analyses, certificates and awards to a lot needs file storage, which is set up at deployment. Until then no such documents can be shown on the site.</p>
    </Page>
  );
}
