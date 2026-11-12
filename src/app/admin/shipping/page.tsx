import { Card, Check, Field, Flash, Page, Submit, Table, euros } from "@/components/admin/ui";
import { requireAdmin } from "@/server/auth";
import { adminCtx } from "@/server/adminSession";
import { deleteRate, deleteTax, saveRate, saveTax, saveZone } from "../actions";

export const metadata = { title: "Shipping & VAT" };

export default async function ShippingPage({ searchParams }: PageProps<"/admin/shipping">) {
  const ctx = await adminCtx();
  if (!ctx.admin) return null;
  requireAdmin(ctx);
  const [zones, taxes, params] = await Promise.all([
    ctx.db.shippingZone.findMany({ orderBy: { name: "asc" }, include: { rates: { orderBy: { position: "asc" } } } }),
    ctx.db.taxRate.findMany({ orderBy: { countryCode: "asc" } }),
    searchParams,
  ]);

  const rateForm = (zoneId: string, rate: (typeof zones)[number]["rates"][number] | null) => (
    <div key={rate?.id ?? "new"} className="flex flex-wrap items-end gap-3 border-t border-ink/10 pt-4">
      <form action={saveRate.bind(null, zoneId, rate?.id ?? null)} className="grid flex-1 items-end gap-3 sm:grid-cols-3 xl:grid-cols-[1.4fr_0.8fr_0.7fr_0.8fr_0.8fr_0.8fr_1fr_auto_auto]">
        <Field label={rate ? "Rate name" : "New rate"} name="name" required defaultValue={rate?.name} placeholder="Standard" />
        <Field label="Carrier" name="carrier" defaultValue={rate?.carrier ?? ""} placeholder="bpost" />
        <Field label="Price (€)" name="priceCents" inputMode="decimal" required defaultValue={euros(rate?.priceCents)} />
        <Field label="From (g)" name="minWeightGrams" inputMode="numeric" defaultValue={rate?.minWeightGrams ?? 0} />
        <Field label="Up to (g)" name="maxWeightGrams" inputMode="numeric" defaultValue={rate?.maxWeightGrams ?? ""} />
        <Field label="Free from (€)" name="freeAboveCents" inputMode="decimal" defaultValue={euros(rate?.freeAboveCents)} />
        <Field label="Delivery estimate" name="estimate" defaultValue={rate?.estimate ?? ""} placeholder="2–3 working days" />
        <Check label="Active" name="isActive" defaultChecked={rate?.isActive ?? true} />
        <Submit variant={rate ? "secondary" : "primary"}>{rate ? "Save" : "Add"}</Submit>
      </form>
      {rate && (
        <form action={deleteRate.bind(null, rate.id)}>
          <Submit variant="danger">Delete</Submit>
        </form>
      )}
    </div>
  );

  return (
    <Page title="Shipping & VAT" eyebrow="Settings">
      <Flash params={params} />
      {zones.map((zone) => (
        <Card key={zone.id} title={zone.name} description="A customer sees the rates of the zone that contains their country, limited to the weight band their parcel falls in.">
          <form action={saveZone.bind(null, zone.id)} className="grid items-end gap-3 sm:grid-cols-[1fr_2fr_auto_auto]">
            <Field label="Zone name" name="name" required defaultValue={zone.name} />
            <Field label="Countries" name="countries" required defaultValue={zone.countries.join(", ")} hint="Two-letter codes, separated by commas: BE, NL, LU" />
            <Check label="Active" name="isActive" defaultChecked={zone.isActive} />
            <Submit variant="secondary">Save zone</Submit>
          </form>
          <div className="mt-5 space-y-4">
            {zone.rates.map((rate) => rateForm(zone.id, rate))}
            {rateForm(zone.id, null)}
          </div>
        </Card>
      ))}
      <Card title="New shipping zone">
        <form action={saveZone.bind(null, null)} className="grid items-end gap-3 sm:grid-cols-[1fr_2fr_auto_auto]">
          <Field label="Zone name" name="name" required placeholder="Rest of EU" />
          <Field label="Countries" name="countries" required placeholder="ES, PT, AT" />
          <Check label="Active" name="isActive" defaultChecked />
          <Submit>Create zone</Submit>
        </form>
      </Card>

      <Card title="VAT rates" description="Administrators only. The rate for the delivery country is used to state the VAT contained in each order. Confirm every rate with your accountant: food rates differ by country, and selling across EU borders above the yearly threshold means charging the destination country’s rate.">
        <Table head={["Country", "Rate", "Label", ""]} empty={taxes.length === 0 ? "No VAT rates set. Orders currently record no VAT amount." : undefined}>
          {taxes.map((tax) => (
            <tr key={tax.id}>
              <td>{tax.countryCode}</td>
              <td className="tabular-nums">{(tax.rateBps / 100).toFixed(2)}%</td>
              <td>{tax.label}</td>
              <td className="text-right">
                <form action={deleteTax.bind(null, tax.countryCode)}>
                  <Submit variant="danger" className="!h-8 !px-3">Delete</Submit>
                </form>
              </td>
            </tr>
          ))}
        </Table>
        <form action={saveTax} className="mt-5 grid items-end gap-3 border-t border-ink/10 pt-5 sm:grid-cols-[0.6fr_0.6fr_1fr_auto]">
          <Field label="Country code" name="countryCode" required placeholder="BE" maxLength={2} />
          <Field label="Rate (%)" name="ratePercent" inputMode="decimal" required placeholder="6" />
          <Field label="Label" name="label" defaultValue="VAT" />
          <Submit>Save rate</Submit>
        </form>
      </Card>

      <p className="text-small text-stone-700">Carrier connections (bpost, DHL, UPS), label printing and automatic tracking are not connected. They need a carrier contract or a Sendcloud account and are added in the shipping phase.</p>
    </Page>
  );
}
