import type { OutboxJob } from "@/generated/prisma/client";
import { refreshTracking } from "./fulfilment";
import { releaseExpiredReservations } from "./checkout";
import type { Db } from "./db";
import { ChannelError, NotConfigured, sendEmail, sendSms, sendWhatsAppTemplate, type Env, type Transport } from "./notifications/channels";
import { contactEmail, customerConfirmationEmail, customerShippedEmail, newsletterConfirmEmail, ownerEmail, ownerText, ownerWhatsAppParameters, passwordResetEmail } from "./notifications/messages";

/**
 * Background jobs (the outbox).
 *
 * A job row is written in the same database transaction as the business
 * change that causes it — an order is marked paid AND its notifications are
 * queued, or neither. This worker then delivers them:
 *
 *   exactly-once queuing   `dedupeKey` is unique, so a paid order has one
 *                          WhatsApp job, one email job, however many times
 *                          the payment webhook is delivered.
 *   one worker per job     jobs are claimed with FOR UPDATE SKIP LOCKED.
 *   retries with backoff   1m, 5m, 30m, 2h, 12h, then FAILED for a person to see.
 *   honest skipping        a channel that is switched off or has no
 *                          credentials is recorded as SKIPPED, never as sent.
 */

const BACKOFF_MINUTES = [1, 5, 30, 120, 720];
export const MAX_ATTEMPTS = BACKOFF_MINUTES.length + 1;
const STALE_LOCK_MINUTES = 10;

/** Thrown by a handler when the job should not be sent at all. */
export class Skip extends Error {}

type Options = { env?: Env; transport?: Transport; now?: Date; limit?: number };
type Settings = { emailRecipient?: string | null; whatsappRecipient?: string | null; smsRecipient?: string | null; notifyByEmail?: boolean; notifyByWhatsapp?: boolean; notifyBySms?: boolean };

async function notificationSettings(db: Db): Promise<Settings> {
  return ((await db.setting.findUnique({ where: { key: "notifications" } }))?.value ?? {}) as Settings;
}

async function paidOrder(db: Db, job: OutboxJob) {
  const orderId = (job.payload as { orderId?: string }).orderId;
  const order = orderId ? await db.order.findUnique({ where: { id: orderId }, include: { items: true, shipments: { orderBy: { createdAt: "desc" }, take: 1 } } }) : null;
  if (!order) throw new Skip("The order no longer exists.");
  return order;
}

type Handler = (db: Db, job: OutboxJob, options: Options) => Promise<void>;

const handlers: Record<string, Handler> = {
  async "notify.owner.whatsapp"(db, job, { env, transport }) {
    const settings = await notificationSettings(db);
    if (settings.notifyByWhatsapp === false) throw new Skip("WhatsApp notifications are switched off in Settings.");
    if (!settings.whatsappRecipient) throw new Skip("No WhatsApp recipient is set in Settings.");
    await sendWhatsAppTemplate(settings.whatsappRecipient, ownerWhatsAppParameters(await paidOrder(db, job)), env, transport);
  },

  async "notify.owner.email"(db, job, { env, transport }) {
    const settings = await notificationSettings(db);
    if (settings.notifyByEmail === false) throw new Skip("Email notifications are switched off in Settings.");
    if (!settings.emailRecipient) throw new Skip("No email recipient is set in Settings.");
    await sendEmail(ownerEmail(await paidOrder(db, job), settings.emailRecipient), job.dedupeKey, env, transport);
  },

  async "notify.owner.sms"(db, job, { env, transport }) {
    const settings = await notificationSettings(db);
    if (settings.notifyBySms !== true) throw new Skip("SMS notifications are switched off in Settings.");
    if (!settings.smsRecipient) throw new Skip("No SMS recipient is set in Settings.");
    await sendSms(settings.smsRecipient, ownerText(await paidOrder(db, job)), env, transport);
  },

  async "notify.customer.confirmation"(db, job, { env, transport }) {
    await sendEmail(customerConfirmationEmail(await paidOrder(db, job)), job.dedupeKey, env, transport);
  },

  async "notify.customer.shipped"(db, job, { env, transport }) {
    const order = await paidOrder(db, job);
    // An order can leave in several shipments; each email is about the one that triggered it.
    const shipmentId = (job.payload as { shipmentId?: string }).shipmentId;
    await sendEmail(customerShippedEmail(order, order.shipments.find((shipment) => shipment.id === shipmentId) ?? order.shipments[0] ?? null), job.dedupeKey, env, transport);
  },

  async "email.newsletter.confirm"(db, job, { env, transport }) {
    const id = (job.payload as { subscriberId?: string }).subscriberId;
    const subscriber = id ? await db.newsletterSubscriber.findUnique({ where: { id } }) : null;
    if (!subscriber || subscriber.status !== "PENDING") throw new Skip("The address is no longer waiting for confirmation.");
    const email = newsletterConfirmEmail(subscriber);
    if (!email) throw new NotConfigured("Signed links (APP_SECRET of at least 32 characters)");
    await sendEmail(email, job.dedupeKey, env, transport);
  },

  async "email.password.reset"(db, job, { env, transport, now }) {
    const id = (job.payload as { customerId?: string }).customerId;
    const customer = id ? await db.customer.findUnique({ where: { id } }) : null;
    if (!customer || customer.erasedAt) throw new Skip("The account no longer exists.");
    const email = passwordResetEmail(customer, now);
    if (!email) throw new NotConfigured("Signed links (APP_SECRET of at least 32 characters)");
    await sendEmail(email, job.dedupeKey, env, transport);
  },

  async "email.contact"(db, job, { env, transport }) {
    const store = ((await db.setting.findUnique({ where: { key: "store" } }))?.value ?? {}) as { email?: string | null };
    const to = store.email || (await notificationSettings(db)).emailRecipient;
    if (!to) throw new Skip("No contact email is set in Settings.");
    await sendEmail(contactEmail(job.payload as { name: string; email: string; reference?: string; body: string }, to), job.dedupeKey, env, transport);
  },
};

export const JOB_KINDS = Object.keys(handlers);

export type JobReport = { claimed: number; done: number; skipped: number; retried: number; failed: number };

/** Claims due jobs and runs them. Safe to call from several places at once. */
export async function processJobs(db: Db, options: Options = {}): Promise<JobReport> {
  const now = options.now ?? new Date();
  const limit = options.limit ?? 25;
  const stale = new Date(now.getTime() - STALE_LOCK_MINUTES * 60_000);

  // A worker that died mid-job leaves a lock behind; hand those jobs back.
  await db.outboxJob.updateMany({ where: { status: "PROCESSING", lockedAt: { lt: stale } }, data: { status: "PENDING", lockedAt: null } });

  const jobs = await db.$queryRaw<OutboxJob[]>`
    UPDATE "OutboxJob" SET "status" = 'PROCESSING'::"JobStatus", "attempts" = "attempts" + 1, "lockedAt" = ${now}
    WHERE "id" IN (
      SELECT "id" FROM "OutboxJob" WHERE "status" = 'PENDING'::"JobStatus" AND "runAfter" <= ${now}
      ORDER BY "createdAt" LIMIT ${limit} FOR UPDATE SKIP LOCKED
    ) RETURNING *`;

  const report: JobReport = { claimed: jobs.length, done: 0, skipped: 0, retried: 0, failed: 0 };

  for (const job of jobs) {
    const finish = (data: { status: "DONE" | "SKIPPED" | "FAILED" | "PENDING"; lastError?: string | null; runAfter?: Date }) =>
      db.outboxJob.update({ where: { id: job.id }, data: { ...data, lockedAt: null, doneAt: data.status === "DONE" ? new Date() : null, lastError: data.lastError ?? null } });
    try {
      const handler = handlers[job.kind];
      if (!handler) throw new Skip(`No handler for job kind "${job.kind}".`);
      await handler(db, job, options);
      await finish({ status: "DONE" });
      report.done += 1;
    } catch (error) {
      const message = (error instanceof Error ? error.message : String(error)).slice(0, 500);
      if (error instanceof Skip || error instanceof NotConfigured) {
        await finish({ status: "SKIPPED", lastError: message });
        report.skipped += 1;
      } else if ((error instanceof ChannelError && !error.retryable) || job.attempts >= MAX_ATTEMPTS) {
        await finish({ status: "FAILED", lastError: message });
        report.failed += 1;
      } else {
        const wait = BACKOFF_MINUTES[Math.min(job.attempts - 1, BACKOFF_MINUTES.length - 1)];
        await finish({ status: "PENDING", lastError: message, runAfter: new Date(now.getTime() + wait * 60_000) });
        report.retried += 1;
      }
    }
  }
  return report;
}

/** Puts a failed or skipped job back in the queue (for example after connecting a channel). */
export async function requeueJob(db: Db, id: string): Promise<void> {
  await db.outboxJob.updateMany({ where: { id, status: { in: ["FAILED", "SKIPPED"] } }, data: { status: "PENDING", attempts: 0, runAfter: new Date(), lastError: null } });
}

/** Removes data that has no further use: expired sessions, old rate-limit counters, long-abandoned carts, old finished jobs. */
export async function purgeExpired(db: Db, now = new Date()) {
  const days = (n: number) => new Date(now.getTime() - n * 86_400_000);
  const [sessions, adminSessions, counters, carts, jobs] = await db.$transaction([
    db.customerSession.deleteMany({ where: { expiresAt: { lt: now } } }),
    db.adminSession.deleteMany({ where: { expiresAt: { lt: now } } }),
    db.rateLimit.deleteMany({ where: { windowStart: { lt: days(2) } } }),
    db.cart.deleteMany({ where: { updatedAt: { lt: days(60) } } }),
    db.outboxJob.deleteMany({ where: { status: { in: ["DONE", "SKIPPED"] }, createdAt: { lt: days(90) } } }),
  ]);
  return { sessions: sessions.count + adminSessions.count, counters: counters.count, carts: carts.count, jobs: jobs.count };
}

/** Everything the scheduler does on each tick. */
export async function runScheduledWork(db: Db, options: Options = {}) {
  const released = await releaseExpiredReservations(db, options.now);
  const jobs = await processJobs(db, options);
  const purged = await purgeExpired(db, options.now);
  const tracking = await refreshTracking(db, options.now);
  return { releasedOrders: released, jobs, purged, tracking };
}
