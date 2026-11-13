import { Badge, Card, Check, Field, Flash, Page, Select, Submit, Table, money } from "@/components/admin/ui";
import { adminCtx } from "@/server/adminSession";
import { CURRENCIES, marketsOverview } from "@/server/markets";
import { can } from "@/server/permissions";
import { deleteMarket, saveMarket } from "../actions";

export const metadata = { title: "Markets & currencies" };

type Market = Awaited<ReturnType<typeof marketsOverview>>["markets"][number];

function MarketForm({ market, disabled }: { market: Market | null; disabled: boolean }) {
  return (
    <form action={saveMarket.bind(null, market?.id ?? null)} className="grid items-end gap-4 sm:grid-cols-2 xl:grid-cols-[1fr_0.7fr_0.6fr_2fr_auto_auto]">
      <Field label="Name" name="name" required defaultValue={market?.name} placeholder="United States" disabled={disabled} />
      <Field label="Code" name="code" required defaultValue={market?.code} placeholder="us" hint="Lowercase, no spaces." disabled={disabled} />
      <Select label="Currency" name="currency" defaultValue={market?.currency ?? "USD"} disabled={disabled}>
        {CURRENCIES.map((currency) => (
          <option key={currency} value={currency}>
            {currency}
          </option>
        ))}
      </Select>
      <Field label="Delivery countries" name="countries" required defaultValue={market?.countries.join(", ")} placeholder="US" hint="Two-letter codes, separated by commas." disabled={disabled} />
      <Check label="Open" name="isActive" defaultChecked={market?.isActive ?? true} disabled={disabled} />
      {!disabled && <Submit variant={market ? "secondary" : "primary"}>{market ? "Save" : "Add market"}</Submit>}
    </form>
  );
}

export default async function MarketsPage({ searchParams }: PageProps<"/admin/markets">) {
  const ctx = await adminCtx();
  if (!ctx.admin) return null;
  const [data, params] = await Promise.all([marketsOverview(ctx), searchParams]);
  const mayChange = can(ctx.admin.role, "ADMINISTRATOR", "settings");

  return (
    <Page title="Markets & currencies" eyebrow="Which countries are sold to, and in which currency">
      <Flash params={params} />
      <Card title="How it works">
        <ul className="list-disc space-y-2 pl-5">
          <li>A market is a group of delivery countries sold to in one currency. The currency follows where the parcel goes, not the language of the page.</li>
          <li>Euro is the base. A country in no market is sold to in euro, at the euro price of each size.</li>
          <li>Nothing is converted. A size is sold in dollars or pounds only if you have typed in its price in that currency, on the product&rsquo;s page. Without one it cannot be bought there.</li>
          <li>Shipping rates, free-shipping thresholds and fixed-amount discount codes each carry a currency and apply only to orders in it.</li>
          <li>Reports show one currency at a time. Amounts in different currencies are never added together.</li>
          <li>VAT rates are set per country under Shipping &amp; VAT. This shop does not calculate United States sales tax or United Kingdom import VAT: take advice before opening those markets.</li>
        </ul>
      </Card>

      <Card title="Euro (base)" description="Countries served by an active euro shipping zone and not claimed by a market below.">
        <p>{data.base.countries.length > 0 ? data.base.countries.join(", ") : "No country: there is no active euro shipping zone."}</p>
      </Card>

      {data.markets.map((market) => (
        <Card key={market.id} title={`${market.name} · ${market.currency}`}>
          <div className="mb-5 flex flex-wrap items-center gap-3">
            <Badge tone={market.isActive ? "PAID" : "CANCELLED"}>{market.isActive ? "Open" : "Closed: no delivery to these countries"}</Badge>
            <span className="text-small text-stone-700">
              {market.sizesPriced} of {data.sizesOnSale} sizes on sale have a price in {market.currency}
            </span>
          </div>
          {market.countriesWithoutShipping.length > 0 && (
            <p className="mb-4 border-l-2 border-terracotta-700 bg-terracotta-500/10 px-4 py-3 text-terracotta-700">
              No shipping zone in {market.currency} serves {market.countriesWithoutShipping.join(", ")}, so nothing can be delivered there. Add a zone with rates in {market.currency} under Shipping &amp; VAT.
            </p>
          )}
          {market.sizesWithoutPrice.length > 0 && (
            <details className="mb-4 border-l-2 border-gold-700 px-4 py-2">
              <summary className="cursor-pointer">
                {market.sizesWithoutPrice.length} size{market.sizesWithoutPrice.length === 1 ? "" : "s"} cannot be bought in this market: no price in {market.currency}
              </summary>
              <ul className="text-small mt-2 list-disc space-y-1 pl-5">
                {market.sizesWithoutPrice.map((name) => (
                  <li key={name}>{name}</li>
                ))}
              </ul>
            </details>
          )}
          <MarketForm market={market} disabled={!mayChange} />
          {mayChange && (
            <form action={deleteMarket.bind(null, market.id)} className="mt-4">
              <Submit variant="secondary">Remove market</Submit>
              <span className="text-small ml-3 text-stone-700">Its countries go back to euro. Orders already placed keep their currency.</span>
            </form>
          )}
        </Card>
      ))}

      {mayChange ? (
        <Card title="Add a market" description="Changing a market changes what customers are charged. Set the prices and a shipping zone in its currency first.">
          <MarketForm market={null} disabled={false} />
        </Card>
      ) : (
        <p className="text-small text-stone-700">Only an administrator can add or change a market.</p>
      )}

      {data.strandedZones.length > 0 && (
        <Card title="Shipping zones that can never apply">
          <p>These zones are written in a currency that none of their countries is sold to in: {data.strandedZones.join(", ")}.</p>
        </Card>
      )}

      <Card title="Paid orders by currency" description="Each currency on its own. They are not added together.">
        <Table head={["Currency", "Paid orders", "Total"]} empty={data.paidOrders.length === 0 ? "No paid order yet." : undefined}>
          {data.paidOrders.map((row) => (
            <tr key={row.currency}>
              <td>{row.currency}</td>
              <td className="tabular-nums">{row.orders}</td>
              <td className="tabular-nums">{money(row.totalCents, row.currency)}</td>
            </tr>
          ))}
        </Table>
      </Card>
    </Page>
  );
}
