import { adminCtx } from "@/server/adminSession";
import { AppError } from "@/server/errors";
import { getLabel } from "@/server/fulfilment";

/** A carrier label exactly as the carrier issued it, for printing. Staff only; each print is written to the audit log. */
export async function GET(_request: Request, { params }: RouteContext<"/admin/shipments/[id]/label/[position]">) {
  const { id, position } = await params;
  try {
    const label = await getLabel(await adminCtx(), id, Number(position) || 0);
    const extension = label.mime === "application/pdf" ? "pdf" : (label.mime.split("/")[1] ?? "bin");
    return new Response(new Uint8Array(label.data), {
      headers: { "content-type": label.mime, "content-disposition": `inline; filename="label-${label.trackingNumber ?? label.shipment.trackingNumber ?? id}.${extension}"`, "cache-control": "private, no-store" },
    });
  } catch (error) {
    if (error instanceof AppError) return new Response(error.message, { status: error.code === "NOT_FOUND" ? 404 : error.code === "UNAUTHENTICATED" ? 401 : 403 });
    throw error;
  }
}
