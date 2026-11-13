import { Card, Field, Flash, Page, Submit, Table } from "@/components/admin/ui";
import { adminCtx } from "@/server/adminSession";
import { listRegions } from "@/server/provenance";
import { deleteRegion, saveRegion } from "../actions";

export const metadata = { title: "Countries & regions" };

const countryName = (code: string) => new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? code;

export default async function RegionsPage({ searchParams }: PageProps<"/admin/regions">) {
  const ctx = await adminCtx();
  if (!ctx.admin) return null;
  const [regions, params] = await Promise.all([listRegions(ctx), searchParams]);
  const countries = [...new Set(regions.map((region) => region.countryCode))];

  return (
    <Page title="Countries & regions" eyebrow={`${countries.length} countr${countries.length === 1 ? "y" : "ies"}, ${regions.length} region${regions.length === 1 ? "" : "s"}`}>
      <Flash params={params} />
      <Card title="Add a region" description="Countries are the standard two-letter codes (GR, IT, ES, MA, TR) and need no setting up. A region is a growing area within one country. Enter only regions an oil in the range really comes from.">
        <form action={saveRegion.bind(null, null)} className="grid gap-4 sm:grid-cols-[8rem_1fr_auto] sm:items-end">
          <Field label="Country code" name="countryCode" required maxLength={2} placeholder="GR" />
          <Field label="Region" name="name" required placeholder="Crete" />
          <Submit>Add region</Submit>
        </form>
      </Card>
      <Card title="Regions">
        <Table head={["Country", "Region", "Products", "Producers", ""]} empty={regions.length === 0 ? "No region has been added yet." : undefined}>
          {regions.map((region) => (
            <tr key={region.id}>
              <td>
                {countryName(region.countryCode)} <span className="text-stone-700">({region.countryCode})</span>
              </td>
              <td>
                <form action={saveRegion.bind(null, region.id)} className="flex items-center gap-2">
                  <input type="hidden" name="countryCode" value={region.countryCode} />
                  <input name="name" defaultValue={region.name} aria-label={`Name of ${region.name}`} required className="h-9 w-full max-w-64 border border-ink/25 bg-white px-2" />
                  <Submit variant="secondary">Rename</Submit>
                </form>
              </td>
              <td className="tabular-nums">{region._count.products}</td>
              <td className="tabular-nums">{region._count.producers}</td>
              <td>
                {region._count.products + region._count.producers === 0 && (
                  <form action={deleteRegion.bind(null, region.id)}>
                    <Submit variant="danger">Remove</Submit>
                  </form>
                )}
              </td>
            </tr>
          ))}
        </Table>
      </Card>
    </Page>
  );
}
