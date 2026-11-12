import Link from "next/link";
import { Badge, Card, Field, Flash, Page, Select, Stat, Submit, TextArea, cellLink, money } from "@/components/admin/ui";
import { adminCtx } from "@/server/adminSession";
import { listWholesale } from "@/server/backoffice";
import { addWholesale, saveWholesale } from "../actions";

export const metadata = { title: "Wholesale / B2B" };

type Account = Awaited<ReturnType<typeof listWholesale>>[number];

function Terms({ account }: { account?: Account }) {
  return (
    <>
      <Field label="Company name" name="companyName" defaultValue={account?.companyName ?? ""} />
      <Field label="Company VAT number" name="companyVatNumber" defaultValue={account?.companyVatNumber ?? ""} />
      <Field label="Discount on goods (%)" name="discountPercent" inputMode="decimal" defaultValue={account ? String(account.wholesaleDiscountBps / 100) : ""} hint="Applied automatically at checkout. 0 to 60." />
      <Select label="Status" name="wholesaleStatus" defaultValue={account?.wholesaleStatus ?? "APPROVED"}>
        <option value="APPROVED">Approved: terms apply</option>
        <option value="REQUESTED">Requested: under review</option>
        <option value="REJECTED">Rejected</option>
        <option value="NONE">Not a wholesale account</option>
      </Select>
      <TextArea label="Internal note" name="wholesaleNote" rows={2} defaultValue={account?.wholesaleNote ?? ""} className="sm:col-span-2 xl:col-span-4" />
    </>
  );
}

export default async function WholesalePage({ searchParams }: PageProps<"/admin/wholesale">) {
  const ctx = await adminCtx();
  if (!ctx.admin) return null;
  const [accounts, params] = await Promise.all([listWholesale(ctx), searchParams]);
  const approved = accounts.filter((account) => account.wholesaleStatus === "APPROVED");

  return (
    <Page title="Wholesale / B2B" eyebrow={`${approved.length} approved account${approved.length === 1 ? "" : "s"}`}>
      <Flash params={params} />
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Approved accounts" value={String(approved.length)} />
        <Stat label="Waiting for review" value={String(accounts.filter((account) => account.wholesaleStatus === "REQUESTED").length)} />
        <Stat label="Paid by wholesale accounts" value={money(approved.reduce((sum, account) => sum + account.spentCents, 0))} note="All their paid orders, VAT included" />
      </div>

      <Card title="How it works">
        <p className="max-w-[80ch] text-stone-700">
          A wholesale account is an ordinary customer account with trade terms. Once approved, its discount on goods comes off automatically when that customer is signed in; it does not combine with a discount code (the larger of the two applies). They can enter a company invoice address and VAT number at checkout. Payment is still by the shop’s normal checkout: invoice payment terms, minimum order quantities, tiered price lists and a customer-facing application form are not built.
        </p>
      </Card>

      <Card title="Open a wholesale account" description="The business must first create a customer account on the shop with this email address.">
        <form action={addWholesale} className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Field label="Customer account email" name="email" type="email" required className="sm:col-span-2 xl:col-span-4" />
          <Terms />
          <div className="sm:col-span-2 xl:col-span-4">
            <Submit>Save wholesale account</Submit>
          </div>
        </form>
      </Card>

      {accounts.map((account) => (
        <Card key={account.id}>
          <details>
            <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-4">
              <span className="font-medium">
                {account.companyName ?? `${account.firstName} ${account.lastName}`}
                <span className="text-small ml-3 font-normal text-stone-700">
                  {account.email} · {account.wholesaleDiscountBps / 100}% · {account.paidOrders} paid order{account.paidOrders === 1 ? "" : "s"} · {money(account.spentCents)}
                </span>
              </span>
              <Badge tone={account.wholesaleStatus === "APPROVED" ? "PAID" : account.wholesaleStatus === "REJECTED" ? "FAILED" : "UNPAID"}>{account.wholesaleStatus}</Badge>
            </summary>
            <form action={saveWholesale.bind(null, account.id, "/admin/wholesale")} className="mt-5 grid gap-4 border-t border-ink/10 pt-5 sm:grid-cols-2 xl:grid-cols-4">
              <Terms account={account} />
              <div className="flex items-center gap-4 sm:col-span-2 xl:col-span-4">
                <Submit>Save terms</Submit>
                <Link href={`/admin/customers/${account.id}`} className={cellLink}>
                  Customer record
                </Link>
              </div>
            </form>
          </details>
        </Card>
      ))}
    </Page>
  );
}
