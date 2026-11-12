import { timingSafeEqual } from "node:crypto";
import { getPrisma } from "@/server/db";
import { runScheduledWork } from "@/server/jobs";

/**
 * Scheduler endpoint: delivers queued notifications (with retries) and
 * releases stock held by orders that were never paid. Call it every few
 * minutes with `Authorization: Bearer <CRON_SECRET>`; without the secret set,
 * or with the wrong one, it does nothing.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const given = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret ?? ""}`;
  if (!secret || secret.length < 24 || given.length !== expected.length || !timingSafeEqual(Buffer.from(given), Buffer.from(expected))) {
    return new Response("Unauthorized", { status: 401 });
  }
  return Response.json(await runScheduledWork(getPrisma()));
}
