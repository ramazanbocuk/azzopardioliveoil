import { getPrisma } from "@/server/db";

/**
 * Health check for uptime monitors and the host. 200 only when the database
 * answers. Says nothing about the environment beyond up or down.
 */
export async function GET() {
  try {
    await getPrisma().$queryRaw`SELECT 1`;
    return Response.json({ status: "ok" }, { headers: { "cache-control": "no-store" } });
  } catch {
    return Response.json({ status: "unavailable" }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
