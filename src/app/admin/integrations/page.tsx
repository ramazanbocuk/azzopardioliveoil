import { Badge, Card, Flash, Page, Stat, Table } from "@/components/admin/ui";
import { adminCtx } from "@/server/adminSession";
import { integrationStatus } from "@/server/integrations";

export const metadata = { title: "Integrations" };

export default async function IntegrationsPage({ searchParams }: PageProps<"/admin/integrations">) {
  const ctx = await adminCtx();
  if (!ctx.admin) return null;
  const [integrations, params] = [integrationStatus(ctx), await searchParams];
  const connected = integrations.filter((integration) => integration.connected).length;

  return (
    <Page title="Integrations" eyebrow={`${connected} of ${integrations.length} configured`}>
      <Flash params={params} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Stat label="Configured" value={String(connected)} />
        <Stat label="Not configured" value={String(integrations.length - connected)} />
      </div>
      <Card description="An integration is configured when its credentials are in the server environment. Credentials are never stored in the database or shown here, and are changed where the site is hosted, not from this screen. “Configured” means the credentials are present, not that the provider has been tested.">
        <Table head={["Service", "Used for", "State", "Detail", "Missing settings"]}>
          {integrations.map((integration) => (
            <tr key={integration.name}>
              <td className="font-medium">{integration.name}</td>
              <td>{integration.purpose}</td>
              <td>
                <Badge tone={integration.connected ? "PAID" : "UNPAID"}>{integration.connected ? "CONFIGURED" : "NOT CONFIGURED"}</Badge>
              </td>
              <td className="max-w-96 text-stone-700">{integration.detail}</td>
              <td className="font-mono text-[0.75rem] text-stone-700">{integration.missing.join(", ")}</td>
            </tr>
          ))}
        </Table>
      </Card>
      <Card title="Not available">
        <p className="text-stone-700">Mollie (planned as a second payment provider), accounting software, marketplaces and email-marketing tools are not integrated. Data can be exported as CSV from Orders, Customers, Inventory, Analytics and Accounting.</p>
      </Card>
    </Page>
  );
}
