import { requireAdmin } from "@/server/auth";
import { adminCtx } from "@/server/adminSession";
import { AppError } from "@/server/errors";
import { readDocument } from "@/server/provenance";

/** Staff view of a lot's document, verified or not. */
export async function GET(_request: Request, { params }: RouteContext<"/admin/lots/[id]/document/[documentId]">) {
  const { documentId } = await params;
  try {
    const ctx = await adminCtx();
    requireAdmin(ctx, "VIEW", "traceability");
    const document = await readDocument(ctx.db, documentId, "staff");
    if (!document) return new Response("Not found", { status: 404 });
    return new Response(new Uint8Array(document.data), { headers: { "content-type": document.mime, "content-disposition": "inline", "cache-control": "private, no-store", "x-content-type-options": "nosniff" } });
  } catch (error) {
    if (error instanceof AppError) return new Response(error.message, { status: 401 });
    throw error;
  }
}
