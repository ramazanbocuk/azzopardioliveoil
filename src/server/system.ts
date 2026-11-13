import { createHash } from "node:crypto";
import { assistantState } from "./ai/assistant";
import { requireAdmin, twoFactorRequired } from "./auth";
import type { Ctx } from "./context";
import type { Db } from "./db";
import { appEnvironment, type AppEnvironment } from "./environment";
import { AppError } from "./errors";
import { carrierStates } from "./shipping/registry";

/**
 * Knowing whether the shop is healthy without an outside service.
 *
 * Three things live here:
 *   the environment   production, staging or development, and what staging forbids
 *   error reports     every unhandled server error, stored once per distinct error, with an email to the shop
 *   system status     one list of checks, shown to staff and served to a monitor
 *
 * None of it replaces an uptime monitor outside the host: a server that is
 * down cannot report that it is down.
 */

type Env = Record<string, string | undefined>;

export { adminHostRule, appEnvironment, emailAllowed, type AppEnvironment } from "./environment";

// ───────────────────────────── error reports ─────────────────────────────

export const ERROR_LIMITS = { rows: 500, emailsPerDay: 8 } as const;

/** Refusals that are part of normal use (not signed in, wrong role, not found) are not failures of the server. */
const EXPECTED = new Set(["UNAUTHENTICATED", "FORBIDDEN", "NOT_FOUND", "BAD_INPUT", "RATE_LIMITED"]);

/** What is safe to keep of an error message: no email addresses, no long identifiers, and not too much of it. */
export function scrub(text: string): string {
  return text
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
    .replace(/\b(?:sk|rk|pk|whsec|re)_[A-Za-z0-9_]{8,}\b/g, "[key]")
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, "[id]")
    .slice(0, 400);
}

export type ErrorReport = { message?: string; code?: string; digest?: string; stack?: string; path?: string; method?: string; route?: string; kind?: string };

/**
 * Stores an unhandled error and, the first time each distinct error is seen
 * on a day, queues one email to the shop. Never throws: a failure to record
 * a failure must not become a second failure.
 */
export async function recordError(db: Db, report: ErrorReport, now = new Date()): Promise<"recorded" | "ignored" | "failed"> {
  try {
    if (report.code && EXPECTED.has(report.code)) return "ignored";
    const message = scrub(report.message || "Unknown error");
    // Next.js signals redirects and not-found pages by throwing; those are not errors.
    if (/^NEXT_(REDIRECT|NOT_FOUND|HTTP_ERROR_FALLBACK)/.test(report.digest ?? "") || /^NEXT_/.test(message)) return "ignored";
    const route = report.route?.slice(0, 200) ?? null;
    const fingerprint = createHash("sha256").update(`${message.replace(/\d+/g, "#")}|${route ?? ""}|${report.kind ?? ""}`).digest("hex").slice(0, 32);
    const stack = report.stack ? scrub(report.stack.split("\n").slice(0, 8).join("\n")).slice(0, 2000) : null;
    const seen = { lastSeenAt: now, lastPath: report.path?.split("?")[0].slice(0, 300) ?? null, lastDigest: report.digest?.slice(0, 60) ?? null };
    // Someone provoking errors on purpose must not be able to fill the table: beyond the cap, only errors already known are counted.
    if ((await db.errorEvent.count()) >= ERROR_LIMITS.rows && !(await db.errorEvent.findUnique({ where: { fingerprint }, select: { id: true } }))) return "ignored";
    const event = await db.errorEvent.upsert({
      where: { fingerprint },
      create: { fingerprint, message, route, kind: report.kind?.slice(0, 40) ?? null, method: report.method?.slice(0, 10) ?? null, stack, firstSeenAt: now, ...seen },
      // An error marked resolved that happens again is not resolved.
      update: { count: { increment: 1 }, resolvedAt: null, resolvedById: null, stack: stack ?? undefined, ...seen },
    });
    const day = now.toISOString().slice(0, 10);
    // Nor fill the owner's inbox: a few emails a day, then the status page is where to look.
    if ((await db.outboxJob.count({ where: { dedupeKey: { startsWith: "notify.owner.notice:error:", endsWith: `:${day}` } } })) >= ERROR_LIMITS.emailsPerDay) return "recorded";
    await db.outboxJob.createMany({
      data: [{ kind: "notify.owner.notice", dedupeKey: `notify.owner.notice:error:${fingerprint}:${day}`, payload: { subject: `Website error: ${message.slice(0, 80)}`, lines: [`The website reported an error it could not handle${route ? ` on ${route}` : ""}.`, message, `It has happened ${event.count} time${event.count === 1 ? "" : "s"}. Visitors saw an apology page${seen.lastDigest ? ` with the code ${seen.lastDigest}` : ""}.`, "Open Admin → System status to see it. A developer will need the details shown there."], path: "/admin/system" } }],
      skipDuplicates: true,
    });
    return "recorded";
  } catch (failure) {
    console.error("[system] an error could not be recorded", failure);
    return "failed";
  }
}

export async function resolveError(ctx: Ctx, id: string): Promise<void> {
  const admin = requireAdmin(ctx, "MANAGER", "integrations");
  const done = await ctx.db.errorEvent.updateMany({ where: { id, resolvedAt: null }, data: { resolvedAt: new Date(), resolvedById: admin.id } });
  if (done.count !== 1) throw new AppError("NOT_FOUND", "That error is not open.");
  await ctx.db.auditLog.create({ data: { actorType: "admin", actorId: admin.id, action: "system.error.resolve", entity: "ErrorEvent", entityId: id, ip: ctx.ip } });
}

/** Resolved errors are deleted after 90 days; open ones are kept until someone looks. */
export async function purgeOldErrors(db: Db, now = new Date()): Promise<number> {
  return (await db.errorEvent.deleteMany({ where: { resolvedAt: { lt: new Date(now.getTime() - 90 * 86_400_000) } } })).count;
}

// ───────────────────────────── status ─────────────────────────────

export type CheckState = "ok" | "warning" | "failing";
export type Check = { key: string; label: string; state: CheckState; detail: string };

const SCHEDULER_KEY = "scheduler";
const minutes = (from: Date, to: Date) => Math.round((to.getTime() - from.getTime()) / 60_000);

/** Called by the scheduler on every run, so its silence can be noticed. */
export async function recordSchedulerRun(db: Db, summary: object, now = new Date()): Promise<void> {
  const value = { lastRunAt: now.toISOString(), summary: JSON.parse(JSON.stringify(summary)) };
  await db.setting.upsert({ where: { key: SCHEDULER_KEY }, create: { key: SCHEDULER_KEY, value }, update: { value } });
}

/**
 * Every check, worst first. Each says what is wrong in words a shop owner
 * can act on. It reads states, never secrets: a key is "set" or "not set".
 */
export async function systemChecks(db: Db, env: Env = process.env, now = new Date()): Promise<{ environment: AppEnvironment; state: CheckState; checks: Check[] }> {
  const environment = appEnvironment(env);
  const live = environment === "production";
  const checks: Check[] = [];
  const add = (key: string, label: string, state: CheckState, detail: string) => checks.push({ key, label, state, detail });

  // Database and migrations.
  try {
    const [failed] = await db.$queryRaw<{ count: bigint }[]>`SELECT COUNT(*)::bigint AS count FROM "_prisma_migrations" WHERE "finished_at" IS NULL AND "rolled_back_at" IS NULL`;
    if (Number(failed?.count ?? 0) > 0) add("database", "Database", "failing", "A database migration started and did not finish. The site may be running on a half-changed database: a developer must look before anything else is deployed.");
    else add("database", "Database", "ok", "Reachable, and every migration has finished.");
  } catch {
    add("database", "Database", "failing", "The database did not answer.");
    return { environment, state: "failing", checks };
  }

  // Scheduler: it sends email, releases unpaid stock holds, refreshes tracking and deletes expired data.
  const heartbeat = ((await db.setting.findUnique({ where: { key: SCHEDULER_KEY } }))?.value ?? null) as { lastRunAt?: string } | null;
  const lastRun = heartbeat?.lastRunAt ? new Date(heartbeat.lastRunAt) : null;
  if (!env.CRON_SECRET || env.CRON_SECRET.length < 24) add("scheduler", "Scheduler", live ? "failing" : "warning", "CRON_SECRET is not set, so the scheduler cannot run: no email is sent, unpaid orders keep their stock, and tracking is not refreshed.");
  else if (!lastRun) add("scheduler", "Scheduler", live ? "failing" : "warning", "It has never run. The host must call /api/cron/jobs every few minutes.");
  else if (minutes(lastRun, now) > 20) add("scheduler", "Scheduler", live ? "failing" : "warning", `It last ran ${minutes(lastRun, now)} minutes ago. It should run every 5 minutes: email, stock release and tracking are waiting.`);
  else add("scheduler", "Scheduler", "ok", `Last ran ${minutes(lastRun, now)} minute(s) ago.`);

  // Messages waiting or failed.
  const [failedJobs, oldest] = await Promise.all([db.outboxJob.count({ where: { status: "FAILED" } }), db.outboxJob.findFirst({ where: { status: "PENDING", runAfter: { lte: now }, attempts: 0 }, orderBy: { createdAt: "asc" }, select: { createdAt: true } })]);
  const waiting = oldest ? minutes(oldest.createdAt, now) : 0;
  if (failedJobs > 0) add("messages", "Messages", "warning", `${failedJobs} message(s) could not be sent after every retry. See Notifications: each shows the provider's reason and can be retried.`);
  else if (waiting > 30) add("messages", "Messages", "warning", `A message has been waiting ${waiting} minutes to be sent. The scheduler may not be running.`);
  else add("messages", "Messages", "ok", "Nothing has failed and nothing is waiting too long.");

  // Errors.
  const [open, recent] = await Promise.all([db.errorEvent.count({ where: { resolvedAt: null } }), db.errorEvent.count({ where: { resolvedAt: null, lastSeenAt: { gte: new Date(now.getTime() - 86_400_000) } } })]);
  if (recent > 0) add("errors", "Website errors", "warning", `${recent} different error(s) in the last 24 hours, ${open} open in all. They are listed below.`);
  else if (open > 0) add("errors", "Website errors", "warning", `${open} error(s) from before the last 24 hours have not been marked resolved.`);
  else add("errors", "Website errors", "ok", "No open error.");

  // Payments.
  const stripe = env.STRIPE_SECRET_KEY ?? "";
  if (!stripe || !env.STRIPE_WEBHOOK_SECRET) add("payments", "Payments (Stripe)", live ? "failing" : "warning", "Not connected: orders are created unpaid and nobody can pay.");
  else if (live && /^(sk|rk)_test_/.test(stripe)) add("payments", "Payments (Stripe)", "failing", "A TEST key is in use on the live site: customers see a payment page but no real money is taken.");
  else if (environment === "staging" && /^(sk|rk)_live_/.test(stripe)) add("payments", "Payments (Stripe)", "failing", "A LIVE key is in use on staging: test orders would take real money.");
  else add("payments", "Payments (Stripe)", "ok", /^(sk|rk)_test_/.test(stripe) ? "Connected in test mode: no real money." : "Connected with a live key.");

  // Email.
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM) add("email", "Email", live ? "failing" : "warning", "Not connected: no order confirmation, shipping notice, password reset or alert is sent.");
  else if (environment === "staging") add("email", "Email", "ok", env.STAGING_EMAIL_ALLOW ? "Connected. On staging, email goes only to the addresses listed in STAGING_EMAIL_ALLOW." : "Connected, but STAGING_EMAIL_ALLOW is empty, so on staging no email is sent to anyone.");
  else add("email", "Email", "ok", "Connected.");

  // Carriers.
  const carriers = carrierStates(env).filter((carrier) => carrier.connected);
  add("carriers", "Carriers", carriers.length > 0 ? "ok" : "warning", carriers.length > 0 ? `Connected: ${carriers.map((carrier) => `${carrier.name} (${carrier.environment})`).join(", ")}.` : "None connected: labels cannot be booked, and shipments and tracking numbers are entered by hand.");

  // Staff sign-in.
  const withoutSecondFactor = await db.adminUser.count({ where: { isActive: true, totpEnabledAt: null } });
  if (!twoFactorRequired(env)) add("staff", "Staff sign-in", "warning", `Two-factor sign-in is not enforced here (it always is on a production server). ${withoutSecondFactor} active account(s) have none.`);
  else add("staff", "Staff sign-in", "ok", withoutSecondFactor > 0 ? `Two-factor sign-in is compulsory. ${withoutSecondFactor} account(s) have not set it up yet and can do nothing else until they do.` : "Two-factor sign-in is compulsory and every active account has it.");

  // Configuration basics.
  const address = env.APP_URL ?? "";
  if (!address) add("address", "Site address", "failing", "APP_URL is not set: links in emails and the sitemap have no address.");
  else if (live && !address.startsWith("https://")) add("address", "Site address", "failing", "APP_URL does not start with https://.");
  else add("address", "Site address", "ok", environment === "staging" ? "Set. Staging tells search engines not to index it." : "Set.");
  if (!env.APP_SECRET || env.APP_SECRET.length < 32) add("secret", "Signing secret", live ? "failing" : "warning", "APP_SECRET is missing or too short: password-reset links, newsletter links and two-factor keys cannot be protected.");

  // Assistants: off is a choice, not a fault; a spent budget is worth knowing.
  const assistant = await assistantState(db, "customer", now);
  if (assistant.reason === "budget_spent") add("assistant", "Assistants", "warning", "This month's budget is used up, so both assistants have stopped answering.");
  else add("assistant", "Assistants", "ok", assistant.reason === "not_connected" ? "Not connected (no API key). The shop shows no assistant." : assistant.available ? "The customer assistant is answering." : "Connected; the customer assistant is switched off or has no budget.");

  const rank: Record<CheckState, number> = { failing: 0, warning: 1, ok: 2 };
  checks.sort((a, b) => rank[a.state] - rank[b.state]);
  return { environment, state: checks[0]?.state ?? "ok", checks };
}

/** The status screen: the checks, the open errors, and the scheduler's last report. */
export async function systemOverview(ctx: Ctx, now = new Date()) {
  requireAdmin(ctx, "VIEW", "integrations");
  const [status, errors, heartbeat, jobs] = await Promise.all([
    systemChecks(ctx.db, process.env, now),
    ctx.db.errorEvent.findMany({ orderBy: [{ resolvedAt: { sort: "asc", nulls: "first" } }, { lastSeenAt: "desc" }], take: 60 }),
    ctx.db.setting.findUnique({ where: { key: SCHEDULER_KEY } }),
    ctx.db.outboxJob.groupBy({ by: ["status"], _count: true }),
  ]);
  return { ...status, errors, scheduler: (heartbeat?.value ?? null) as { lastRunAt: string; summary: unknown } | null, jobs: Object.fromEntries(jobs.map((row) => [row.status, row._count])) as Record<string, number> };
}
