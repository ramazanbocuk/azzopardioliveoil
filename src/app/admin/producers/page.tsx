import { Card, Field, Flash, Page, Select, Submit, TextArea } from "@/components/admin/ui";
import { adminCtx } from "@/server/adminSession";
import { listProducers, listRegions } from "@/server/provenance";
import { saveProducer } from "../actions";

export const metadata = { title: "Producers" };

export default async function ProducersPage({ searchParams }: PageProps<"/admin/producers">) {
  const ctx = await adminCtx();
  if (!ctx.admin) return null;
  const [producers, regions, params] = await Promise.all([listProducers(ctx), listRegions(ctx), searchParams]);

  const form = (producer: (typeof producers)[number] | null) => (
    <form action={saveProducer.bind(null, producer?.id ?? null)} className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <Field label="Name" name="name" required defaultValue={producer?.name} />
      <Field label="Web address name" name="slug" required defaultValue={producer?.slug} hint="Lowercase letters, numbers and hyphens." />
      <Field label="Country code" name="countryCode" maxLength={2} defaultValue={producer?.countryCode ?? ""} placeholder="GR" hint="Taken from the region when one is chosen." />
      <Select label="Region" name="regionId" defaultValue={producer?.regionId ?? ""}>
        <option value="">Not recorded</option>
        {regions.map((region) => (
          <option key={region.id} value={region.id}>
            {region.countryCode} · {region.name}
          </option>
        ))}
      </Select>
      <Field label="Town or village" name="town" defaultValue={producer?.town ?? ""} />
      <Field label="Website" name="website" type="url" defaultValue={producer?.website ?? ""} placeholder="https://" />
      <TextArea label="About the producer" name="description" rows={3} defaultValue={producer?.description} className="sm:col-span-2" hint="Facts you can stand behind: who they are, what they grow, how they work. No awards or certifications unless the document is on file." />
      <div className="flex items-end justify-between gap-4 sm:col-span-2 xl:col-span-4">
        <p className="text-small text-stone-700">For your records only. Never shown on the shop.</p>
        <Submit variant={producer ? "secondary" : "primary"}>{producer ? "Save" : "Add producer"}</Submit>
      </div>
    </form>
  );

  return (
    <Page title="Producers" eyebrow={`${producers.length} producer${producers.length === 1 ? "" : "s"}`}>
      <Flash params={params} />
      <Card title="Add a producer" description="A producer is who makes an oil: an estate, a mill or a cooperative. Producers are for your own records: nothing about them is shown on the shop, in emails or by the assistant. Suppliers (who you buy from and pay) are kept separately and are never shown.">
        {form(null)}
      </Card>
      {producers.map((producer) => (
        <Card key={producer.id} title={producer.name} description={`${producer._count.products} product${producer._count.products === 1 ? "" : "s"}, ${producer._count.batches} lot${producer._count.batches === 1 ? "" : "s"}${producer.region ? ` · ${producer.region.name}` : ""}`}>
          {form(producer)}
        </Card>
      ))}
    </Page>
  );
}
