import Link from "next/link";
import { Badge, Card, Flash, Page, Stat, Table, cellLink } from "@/components/admin/ui";
import { adminCtx } from "@/server/adminSession";
import { intelligenceOverview } from "@/server/provenance";

export const metadata = { title: "Laboratory results" };

export default async function LabPage({ searchParams }: PageProps<"/admin/lab">) {
  const ctx = await adminCtx();
  if (!ctx.admin) return null;
  const [data, params] = await Promise.all([intelligenceOverview(ctx), searchParams]);

  return (
    <Page title="Laboratory results" eyebrow="Certificates and measured values per lot">
      <Flash params={params} />
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Lots fully documented" value={`${data.lotsComplete} of ${data.lots.length}`} note="Harvest year, a verified analysis certificate, and verified polyphenols, acidity and peroxide." />
        <Stat label="Results waiting for verification" value={String(data.waiting)} note="Entered but not yet checked against the certificate. Customers cannot see them." />
        <Stat label="Products with gaps" value={String(data.incomplete.length)} note="Missing origin, producer, variety or tasting notes." />
      </div>

      <Card title="Lots" description="A measured value is shown to customers only when it is verified and its lot is published. Open a lot to upload its certificate, enter the values and verify them.">
        <Table head={["Lot", "Product", "Harvest", "State", "Results", "Still missing"]} empty={data.lots.length === 0 ? "No lot has been created yet. Create one under Lots." : undefined}>
          {data.lots.map((lot) => (
            <tr key={lot.id}>
              <td>
                <Link href={`/admin/lots/${lot.id}`} className={cellLink}>
                  {lot.lotNumber}
                </Link>
              </td>
              <td>{lot.product}</td>
              <td className="tabular-nums">{lot.harvestYear ?? "—"}</td>
              <td>
                <Badge tone={lot.isPublished ? "PAID" : "CANCELLED"}>{lot.isPublished ? "Published" : "Draft"}</Badge>
              </td>
              <td className="whitespace-nowrap">
                {lot.verifiedResults} verified{lot.waiting > 0 ? `, ${lot.waiting} waiting` : ""}
              </td>
              <td className="text-stone-700">{lot.missing.length === 0 ? "Nothing" : lot.missing.join(", ")}</td>
            </tr>
          ))}
        </Table>
      </Card>

      <Card title="Products with missing provenance" description="Each of these shows a dash on the product page where the information is missing. Nothing is filled in automatically.">
        <Table head={["Product", "On the shop", "Missing"]} empty={data.incomplete.length === 0 ? "Every product has its origin, producer, variety and tasting notes." : undefined}>
          {data.incomplete.map((product) => (
            <tr key={product.id}>
              <td>
                <Link href={`/admin/products/${product.id}`} className={cellLink}>
                  {product.name}
                </Link>
              </td>
              <td>{product.isVisible ? "Visible" : "Hidden"}</td>
              <td className="text-stone-700">{product.missing.join(", ")}</td>
            </tr>
          ))}
        </Table>
      </Card>
    </Page>
  );
}
