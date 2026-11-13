import { getPrisma } from "@/server/db";
import { readDocument } from "@/server/provenance";

/**
 * Serves a laboratory report or certificate to the public, but only one that
 * staff have verified, for a published lot of a visible product. Anything
 * else answers "not found", exactly as if it did not exist.
 */
export async function GET(_request: Request, { params }: RouteContext<"/media/certificate/[id]">) {
  const { id } = await params;
  if (!/^[a-z0-9]{10,40}$/.test(id)) return new Response("Not found", { status: 404 });
  const document = await readDocument(getPrisma(), id, "public");
  if (!document) return new Response("Not found", { status: 404 });
  // Short cache: verification can be withdrawn, and the file must then disappear promptly.
  return new Response(new Uint8Array(document.data), {
    headers: { "content-type": document.mime, "content-disposition": "inline", "cache-control": "public, max-age=300", "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; object-src 'self'; style-src 'unsafe-inline'", "x-robots-tag": "noindex" },
  });
}
