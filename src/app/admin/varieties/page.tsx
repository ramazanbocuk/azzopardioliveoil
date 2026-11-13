import { Card, Field, Flash, Page, Submit, TextArea } from "@/components/admin/ui";
import { adminCtx } from "@/server/adminSession";
import { listVarieties } from "@/server/provenance";
import { saveVariety } from "../actions";

export const metadata = { title: "Olive varieties" };

export default async function VarietiesPage({ searchParams }: PageProps<"/admin/varieties">) {
  const ctx = await adminCtx();
  if (!ctx.admin) return null;
  const [varieties, params] = await Promise.all([listVarieties(ctx), searchParams]);

  const form = (variety: (typeof varieties)[number] | null) => (
    <form action={saveVariety.bind(null, variety?.id ?? null)} className="grid gap-4 sm:grid-cols-2">
      <Field label="Name" name="name" required defaultValue={variety?.name} placeholder="Koroneiki" />
      <Field label="Web address name" name="slug" required defaultValue={variety?.slug} placeholder="koroneiki" hint="Lowercase letters, numbers and hyphens." />
      <TextArea label="Description" name="description" rows={3} defaultValue={variety?.description} className="sm:col-span-2" hint="What the variety is and where it is grown. Do not describe an expected polyphenol level or health effect here: those are measured per batch, not promised by a variety." />
      <div>
        <Submit variant={variety ? "secondary" : "primary"}>{variety ? "Save" : "Add variety"}</Submit>
      </div>
    </form>
  );

  return (
    <Page title="Olive varieties" eyebrow={`${varieties.length} variet${varieties.length === 1 ? "y" : "ies"}`}>
      <Flash params={params} />
      <Card title="Add a variety" description="A variety is linked to a product on the product's own page. Choosing a variety there fills in nothing else: origin, taste and laboratory values are always entered for the oil itself.">
        {form(null)}
      </Card>
      {varieties.map((variety) => (
        <Card key={variety.id} title={variety.name} description={`Used by ${variety._count.products} product${variety._count.products === 1 ? "" : "s"}.`}>
          {form(variety)}
        </Card>
      ))}
    </Page>
  );
}
