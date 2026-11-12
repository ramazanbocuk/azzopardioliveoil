import { requireAdmin } from "@/server/auth";
import { adminCtx } from "@/server/adminSession";
import { AppError } from "@/server/errors";

/** Staff preview of an uploaded photo, including for products not yet visible on the shop. */
export async function GET(_request: Request, { params }: RouteContext<"/admin/products/[id]/photo/[photoId]">) {
  const { id, photoId } = await params;
  try {
    const ctx = await adminCtx();
    requireAdmin(ctx, "VIEW", "catalog");
    const image = await ctx.db.productImage.findFirst({ where: { id: photoId, productId: id, data: { not: null } }, select: { data: true, mime: true } });
    if (!image?.data || !image.mime) return new Response("Not found", { status: 404 });
    return new Response(new Uint8Array(image.data), { headers: { "content-type": image.mime, "cache-control": "private, no-store", "x-content-type-options": "nosniff" } });
  } catch (error) {
    if (error instanceof AppError) return new Response(error.message, { status: 401 });
    throw error;
  }
}
