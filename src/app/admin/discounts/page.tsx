import { Badge, Card, Check, Field, Flash, Page, Select, Submit, euros, isoDay } from "@/components/admin/ui";
import { requireAdmin } from "@/server/auth";
import { adminCtx } from "@/server/adminSession";
import { saveDiscount } from "../actions";

export const metadata = { title: "Discounts" };

export default async function DiscountsPage({ searchParams }: PageProps<"/admin/discounts">) {
  const ctx = await adminCtx();
  if (!ctx.admin) return null;
  requireAdmin(ctx, "VIEW", "discounts");
  const [discounts, params] = await Promise.all([ctx.db.discount.findMany({ orderBy: { createdAt: "desc" } }), searchParams]);

  const form = (discount: (typeof discounts)[number] | null) => (
    <form action={saveDiscount.bind(null, discount?.id ?? null)} className="grid items-end gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <Field label="Code" name="code" required defaultValue={discount?.code} placeholder="WELCOME10" />
      <Select label="Type" name="kind" defaultValue={discount?.kind ?? "PERCENT"}>
        <option value="PERCENT">Percentage off</option>
        <option value="FIXED">Amount off (€)</option>
        <option value="FREE_SHIPPING">Free shipping</option>
      </Select>
      <Field label="Value" name="value" inputMode="decimal" defaultValue={discount ? (discount.kind === "FIXED" ? euros(discount.value) : discount.value) : ""} hint="Percent, or euros for an amount. Ignored for free shipping." />
      <Field label="Minimum order (€)" name="minSubtotalCents" inputMode="decimal" defaultValue={euros(discount?.minSubtotalCents ?? 0)} />
      <Field label="Starts" name="startsAt" type="date" defaultValue={isoDay(discount?.startsAt)} />
      <Field label="Ends" name="endsAt" type="date" defaultValue={isoDay(discount?.endsAt)} />
      <Field label="Maximum uses" name="usageLimit" inputMode="numeric" defaultValue={discount?.usageLimit ?? ""} hint="Empty for unlimited." />
      <div className="flex items-end justify-between gap-4">
        <Check label="Active" name="isActive" defaultChecked={discount?.isActive ?? true} />
        <Submit variant={discount ? "secondary" : "primary"}>{discount ? "Save" : "Create code"}</Submit>
      </div>
    </form>
  );

  return (
    <Page title="Discounts" eyebrow="Marketing">
      <Flash params={params} />
      <Card title="New discount code">{form(null)}</Card>
      {discounts.map((discount) => (
        <Card key={discount.id} title={discount.code}>
          <div className="mb-4 flex items-center gap-3">
            <Badge tone={discount.isActive ? "PAID" : "CANCELLED"}>{discount.isActive ? "Active" : "Inactive"}</Badge>
            <span className="text-small text-stone-700">
              Used {discount.usedCount}
              {discount.usageLimit ? ` of ${discount.usageLimit}` : ""} time{discount.usedCount === 1 ? "" : "s"}
            </span>
          </div>
          {form(discount)}
        </Card>
      ))}
    </Page>
  );
}
