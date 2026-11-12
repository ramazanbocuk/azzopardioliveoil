import Link from "next/link";
import { Badge, Card, Check, Field, Flash, Page, Select, Submit, TextArea, cellLink } from "@/components/admin/ui";
import { adminCtx } from "@/server/adminSession";
import { SUPPLIER_KINDS, listSuppliers } from "@/server/backoffice";
import { removeSupplier, saveSupplier } from "../actions";

export const metadata = { title: "Suppliers" };

type Supplier = Awaited<ReturnType<typeof listSuppliers>>[number];

function SupplierForm({ supplier }: { supplier?: Supplier }) {
  return (
    <form action={saveSupplier.bind(null, supplier?.id ?? null)} className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <Field label="Name" name="name" required defaultValue={supplier?.name ?? ""} className="xl:col-span-2" />
      <Select label="Supplies" name="kind" defaultValue={supplier?.kind ?? "Grower"}>
        {SUPPLIER_KINDS.map((kind) => (
          <option key={kind} value={kind}>
            {kind}
          </option>
        ))}
      </Select>
      <Field label="Country (two letters)" name="countryCode" maxLength={2} defaultValue={supplier?.countryCode ?? ""} />
      <Field label="Contact person" name="contactName" defaultValue={supplier?.contactName ?? ""} />
      <Field label="Email" name="email" type="email" defaultValue={supplier?.email ?? ""} />
      <Field label="Phone" name="phone" type="tel" defaultValue={supplier?.phone ?? ""} />
      <Field label="VAT number" name="vatNumber" defaultValue={supplier?.vatNumber ?? ""} />
      <TextArea label="Address" name="address" rows={2} defaultValue={supplier?.address ?? ""} className="sm:col-span-2" />
      <TextArea label="Notes" name="notes" rows={2} defaultValue={supplier?.notes ?? ""} className="sm:col-span-2" />
      <Check label="Active supplier" name="isActive" defaultChecked={supplier?.isActive ?? true} />
      <div className="sm:col-span-2 xl:col-span-4">
        <Submit>{supplier ? "Save supplier" : "Add supplier"}</Submit>
      </div>
    </form>
  );
}

export default async function SuppliersPage({ searchParams }: PageProps<"/admin/suppliers">) {
  const ctx = await adminCtx();
  if (!ctx.admin) return null;
  const [suppliers, params] = await Promise.all([listSuppliers(ctx), searchParams]);

  return (
    <Page title="Suppliers" eyebrow={`${suppliers.filter((supplier) => supplier.isActive).length} active`}>
      <Flash params={params} />
      <Card title="Add a supplier" description="Growers, mills, bottlers and packaging suppliers. Internal records: nothing here is shown to customers. Link a supplier to a lot under Food traceability.">
        <SupplierForm />
      </Card>
      {suppliers.map((supplier) => (
        <Card key={supplier.id}>
          <details>
            <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-4">
              <span className="font-medium">
                {supplier.name}
                <span className="text-small ml-3 font-normal text-stone-700">
                  {supplier.kind}
                  {supplier.countryCode ? ` · ${supplier.countryCode}` : ""} · {supplier._count.batches} lot{supplier._count.batches === 1 ? "" : "s"}
                </span>
              </span>
              <Badge tone={supplier.isActive ? "PAID" : undefined}>{supplier.isActive ? "ACTIVE" : "INACTIVE"}</Badge>
            </summary>
            <div className="mt-5 border-t border-ink/10 pt-5">
              {supplier.batches.length > 0 && (
                <p className="mb-4 text-stone-700">
                  Recent lots:{" "}
                  {supplier.batches.map((batch, index) => (
                    <span key={batch.id}>
                      {index > 0 && ", "}
                      <Link href={`/admin/traceability?lot=${batch.lotNumber}`} className={cellLink}>
                        {batch.lotNumber}
                      </Link>
                    </span>
                  ))}
                </p>
              )}
              <SupplierForm supplier={supplier} />
              <form action={removeSupplier.bind(null, supplier.id)} className="mt-4">
                <Submit variant="danger">{supplier._count.batches > 0 ? "Deactivate supplier" : "Delete supplier"}</Submit>
              </form>
            </div>
          </details>
        </Card>
      ))}
    </Page>
  );
}
