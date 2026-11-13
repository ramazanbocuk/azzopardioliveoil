import { timingSafeEqual } from "node:crypto";
import { getPrisma } from "@/server/db";
import { systemChecks } from "@/server/system";

/**
 * The system checks as JSON, for a monitoring tool. Unlike /api/health it
 * says what is wrong, so it needs the scheduler's secret:
 * `Authorization: Bearer <CRON_SECRET>`. It never returns a key or any
 * customer data, only states and counts.
 *
 * 200 when nothing is failing (warnings included), 503 when something is.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const given = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret ?? ""}`;
  if (!secret || secret.length < 24 || given.length !== expected.length || !timingSafeEqual(Buffer.from(given), Buffer.from(expected))) {
    return new Response("Unauthorized", { status: 401 });
  }
  const status = await systemChecks(getPrisma());
  return Response.json(status, { status: status.state === "failing" ? 503 : 200, headers: { "cache-control": "no-store" } });
}
