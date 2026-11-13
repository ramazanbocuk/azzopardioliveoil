import { notFound } from "next/navigation";
import { Badge, Card, Field, Flash, LinkButton, Page, Select, Submit, Table, date, dateTime } from "@/components/admin/ui";
import { adminCtx } from "@/server/adminSession";
import { AppError } from "@/server/errors";
import { can } from "@/server/permissions";
import { DOCUMENT_KIND_LABEL, MEASURES, MEASURE_KEYS, getBatchDetail } from "@/server/provenance";
import { addLabResult, removeBatchDocument, removeLabResult, uploadBatchDocument, verifyBatchDocument, verifyLabResult } from "../../actions";

export const metadata = { title: "Lot" };

export default async function LotPage({ params, searchParams }: PageProps<"/admin/lots/[id]">) {
  const ctx = await adminCtx();
  if (!ctx.admin) return null;
  const [{ id }, flash] = await Promise.all([params, searchParams]);
  const lot = await getBatchDetail(ctx, id).catch((error) => {
    if (error instanceof AppError && error.code === "NOT_FOUND") notFound();
    throw error;
  });
  const mayEnter = can(ctx.admin.role, "STAFF", "traceability");
  const mayVerify = can(ctx.admin.role, "MANAGER", "traceability");
  const number = (value: number) => value.toLocaleString("en-GB", { maximumFractionDigits: 4 });

  return (
    <Page title={`Lot ${lot.lotNumber}`} eyebrow={`${lot.product.name}${lot.harvestYear ? ` · harvest ${lot.harvestYear}` : ""}`} actions={<LinkButton href="/admin/lots">All lots</LinkButton>}>
      <Flash params={flash} />
      <div className="flex flex-wrap items-center gap-3">
        <Badge tone={lot.isPublished ? "PAID" : "CANCELLED"}>{lot.isPublished ? "Published" : "Draft"}</Badge>
        <span className="text-small text-stone-700">
          {lot.isPublished ? "Verified documents and results below are visible to customers." : "Nothing below is visible to customers until the lot is published, under Lots."}
          {lot.producer ? ` Producer: ${lot.producer.name}.` : ""}
        </span>
      </div>

      <Card title="Documents" description="Upload the laboratory's report and any certificate as a PDF (up to 4 MB). A document can be opened by customers only after a manager has verified that it is the genuine document for this lot.">
        <Table head={["Document", "Kind", "Uploaded", "Verified", ""]} empty={lot.documents.length === 0 ? "No document on file for this lot." : undefined}>
          {lot.documents.map((document) => (
            <tr key={document.id}>
              <td>
                <a href={`/admin/lots/${lot.id}/document/${document.id}`} target="_blank" rel="noreferrer" className="font-medium underline decoration-ink/30 underline-offset-4 hover:decoration-ink">
                  {document.title}
                </a>
                <span className="text-small block text-stone-700">{document.bytes ? `${Math.round(document.bytes / 1024)} KB` : "Link only"}</span>
              </td>
              <td>{DOCUMENT_KIND_LABEL[document.kind]}</td>
              <td>
                {dateTime(document.createdAt)}
                <span className="text-small block text-stone-700">{document.uploadedBy}</span>
              </td>
              <td>
                {document.verifiedAt ? (
                  <>
                    {dateTime(document.verifiedAt)}
                    <span className="text-small block text-stone-700">{document.verifiedBy}</span>
                  </>
                ) : (
                  "Not verified"
                )}
              </td>
              <td>
                {mayVerify && (
                  <div className="flex flex-wrap gap-2">
                    <form action={verifyBatchDocument.bind(null, lot.id, document.id, !document.verifiedAt)}>
                      <Submit variant="secondary">{document.verifiedAt ? "Withdraw" : "Verify"}</Submit>
                    </form>
                    <form action={removeBatchDocument.bind(null, lot.id, document.id)}>
                      <Submit variant="danger">Remove</Submit>
                    </form>
                  </div>
                )}
              </td>
            </tr>
          ))}
        </Table>
        {mayEnter && (
          <form action={uploadBatchDocument.bind(null, lot.id)} className="mt-6 grid gap-4 border-t border-ink/10 pt-6 sm:grid-cols-2 xl:grid-cols-4 xl:items-end">
            <Field label="Title" name="title" required maxLength={200} placeholder="Analysis report, March 2026" />
            <Select label="Kind" name="kind" required defaultValue="ANALYSIS">
              {Object.entries(DOCUMENT_KIND_LABEL).map(([kind, label]) => (
                <option key={kind} value={kind}>
                  {label}
                </option>
              ))}
            </Select>
            <label className="block">
              <span className="text-small font-medium">PDF file</span>
              <input type="file" name="file" accept="application/pdf" required className="mt-1.5 block w-full text-[0.9375rem]" />
            </label>
            <div>
              <Submit>Upload document</Submit>
            </div>
          </form>
        )}
      </Card>

      <Card
        title="Laboratory results"
        description="Enter each value exactly as printed on the laboratory's report, with the report it came from. A value can be verified only when it names the laboratory and the test date and its report is itself verified. A value cannot be edited: remove a wrong one and enter it again."
      >
        <Table head={["Measure", "Value", "Method", "Laboratory", "Tested", "Certificate", "Verified", ""]} empty={lot.labResults.length === 0 ? "No result recorded for this lot. The product page says so rather than showing a figure." : undefined}>
          {lot.labResults.map((result) => (
            <tr key={result.id}>
              <td>{result.name}</td>
              <td className="whitespace-nowrap tabular-nums">
                {number(result.value)} {result.unit}
              </td>
              <td>{result.method ?? "—"}</td>
              <td>{result.laboratory ?? "—"}</td>
              <td className="whitespace-nowrap">{date(result.testedAt)}</td>
              <td>{lot.documents.find((document) => document.id === result.documentId)?.title ?? "—"}</td>
              <td>
                {result.verifiedAt ? (
                  <>
                    <Badge tone="PAID">Verified</Badge>
                    <span className="text-small block text-stone-700">{result.verifiedBy}</span>
                  </>
                ) : (
                  <Badge tone="CANCELLED">Not shown</Badge>
                )}
                <span className="text-small block text-stone-700">Entered by {result.enteredBy}</span>
              </td>
              <td>
                {mayVerify && (
                  <div className="flex flex-wrap gap-2">
                    <form action={verifyLabResult.bind(null, lot.id, result.id, !result.verifiedAt)}>
                      <Submit variant="secondary">{result.verifiedAt ? "Withdraw" : "Verify"}</Submit>
                    </form>
                    <form action={removeLabResult.bind(null, lot.id, result.id)}>
                      <Submit variant="danger">Remove</Submit>
                    </form>
                  </div>
                )}
              </td>
            </tr>
          ))}
        </Table>
        {mayEnter && (
          <form action={addLabResult.bind(null, lot.id)} className="mt-6 grid gap-4 border-t border-ink/10 pt-6 sm:grid-cols-2 xl:grid-cols-4">
            <Select label="Measure" name="measure" required defaultValue="polyphenols">
              {MEASURE_KEYS.map((key) => (
                <option key={key} value={key}>
                  {MEASURES[key].label}
                  {MEASURES[key].unit ? ` (${MEASURES[key].unit})` : ""}
                </option>
              ))}
              <option value="other">Another measure…</option>
            </Select>
            <Field label="Value" name="value" required inputMode="decimal" placeholder="412" hint="In the unit shown beside the measure." />
            <Field label="Method" name="method" placeholder="HPLC (IOC)" hint="As named on the report." />
            <Field label="Laboratory" name="laboratory" />
            <Field label="Test date" name="testedAt" type="date" />
            <Select label="Read from document" name="documentId" defaultValue="">
              <option value="">Not attached</option>
              {lot.documents.map((document) => (
                <option key={document.id} value={document.id}>
                  {document.title}
                </option>
              ))}
            </Select>
            <Field label="Name, for another measure" name="label" hint="Only when “Another measure” is chosen." />
            <Field label="Unit, for another measure" name="unit" />
            <Field label="Internal note" name="note" className="sm:col-span-2" />
            <div className="flex items-end">
              <Submit>Record result</Submit>
            </div>
          </form>
        )}
      </Card>
    </Page>
  );
}
