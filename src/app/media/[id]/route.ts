import { getPrisma } from "@/server/db";

/**
 * Serves an uploaded product photo. Public, like any image on the shop, but
 * only for products that are visible: photos of hidden or deleted products
 * are not served. The id never changes for a given image, so it can be cached
 * for a long time.
 */
export async function GET(_request: Request, { params }: RouteContext<"/media/[id]">) {
  const { id } = await params;
  if (!/^[a-z0-9]{10,40}$/.test(id)) return new Response("Not found", { status: 404 });
  const image = await getPrisma().productImage.findFirst({ where: { id, data: { not: null }, product: { isVisible: true, deletedAt: null } }, select: { data: true, mime: true } });
  if (!image?.data || !image.mime) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(image.data), { headers: { "content-type": image.mime, "cache-control": "public, max-age=31536000, immutable", "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'" } });
}
