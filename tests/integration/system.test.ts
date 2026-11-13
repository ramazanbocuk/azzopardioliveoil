import { beforeEach, describe, expect, it } from "vitest";
import type { AdminRole } from "@/generated/prisma/client";
import { GET as statusRoute } from "@/app/api/status/route";
import type { Ctx } from "@/server/context";
import { checkEnvironment } from "@/server/env";
import { AppError } from "@/server/errors";
import { processJobs, runScheduledWork } from "@/server/jobs";
import { sendEmail, Withheld } from "@/server/notifications/channels";
import { ERROR_LIMITS, adminHostRule, appEnvironment, emailAllowed, purgeOldErrors, recordError, resolveError, scrub, systemChecks, systemOverview } from "@/server/system";
import { db, resetDb, seedCatalog } from "../helpers";

/**
 * Production readiness: knowing the environment, keeping and reporting
 * errors, and one list of checks that says in plain words what is wrong.
 */

async function as(role: AdminRole): Promise<Ctx> {
  const user = await db.adminUser.create({ data: { email: `${role}-${Math.random().toString(36).slice(2)}@test.local`, name: role, role, passwordHash: "x" } });
  return { db, ip: "10.9.9.9", userAgent: null, cookies: {}, setCookies: [], customer: null, admin: user };
}
const refused = async (promise: Promise<unknown>, expected: string) => expect(await promise.then(() => "resolved", (error: { code?: string }) => error.code)).toBe(expected);

const LIVE = {
  NODE_ENV: "production",
  DATABASE_URL: "postgresql://example",
  APP_URL: "https://shop.example",
  APP_SECRET: "a".repeat(40),
  CRON_SECRET: "c".repeat(30),
  STRIPE_SECRET_KEY: "sk_live_placeholder",
  STRIPE_WEBHOOK_SECRET: "whsec_placeholder",
  RESEND_API_KEY: "re_placeholder",
  EMAIL_FROM: "shop@shop.example",
};
const stateOf = (result: Awaited<ReturnType<typeof systemChecks>>, key: string) => result.checks.find((check) => check.key === key)?.state;

beforeEach(async () => {
  await resetDb();
  await seedCatalog();
});

describe("the environment", () => {
  it("knows production, staging and development apart", () => {
    expect(appEnvironment({ NODE_ENV: "production" })).toBe("production");
    expect(appEnvironment({ NODE_ENV: "production", APP_ENV: "staging" })).toBe("staging");
    expect(appEnvironment({ NODE_ENV: "development" })).toBe("development");
    expect(appEnvironment({ NODE_ENV: "production", APP_ENV: "anything-else" })).toBe("production"); // a typo never switches protections off
  });

  it("on staging, writes only to the people the owner listed, and refuses live payment keys", async () => {
    const staging = { ...LIVE, APP_ENV: "staging", STRIPE_SECRET_KEY: "sk_test_placeholder", STAGING_EMAIL_ALLOW: "owner@shop.example, @agency.example" };
    expect(emailAllowed("owner@shop.example", staging)).toBe(true);
    expect(emailAllowed("Anyone@Agency.Example", staging)).toBe(true);
    expect(emailAllowed("customer@gmail.example", staging)).toBe(false);
    expect(emailAllowed("owner@shop.example.evil.example", staging)).toBe(false);
    expect(emailAllowed("customer@gmail.example", { ...staging, STAGING_EMAIL_ALLOW: "" })).toBe(false); // nothing listed: nobody
    expect(emailAllowed("customer@gmail.example", LIVE)).toBe(true); // the live site writes to its customers

    // The channel itself refuses, so no job handler can forget to ask.
    const sent: { to: string[]; subject: string }[] = [];
    const transport = async (_url: string, init: { body: string }) => (sent.push(JSON.parse(init.body)), { ok: true, status: 200, text: async () => "" });
    const email = { to: "customer@gmail.example", subject: "Your order", html: "<p>Hi</p>", text: "Hi" };
    await expect(sendEmail(email, "key-1", staging, transport)).rejects.toBeInstanceOf(Withheld);
    await sendEmail({ ...email, to: "owner@shop.example" }, "key-2", staging, transport);
    await sendEmail(email, "key-3", LIVE, transport);
    expect(sent.map((message) => [message.to[0], message.subject])).toEqual([["owner@shop.example", "[Staging] Your order"], ["customer@gmail.example", "Your order"]]);

    // A withheld message is recorded as skipped with the reason, not as sent and not as a failure.
    await db.setting.create({ data: { key: "notifications", value: { emailRecipient: "stranger@elsewhere.example" } } });
    await db.outboxJob.create({ data: { kind: "notify.owner.notice", dedupeKey: "notify.owner.notice:test", payload: { subject: "Hello", lines: ["A line"], path: "/admin" } } });
    expect(await processJobs(db, { env: staging, transport })).toMatchObject({ skipped: 1, failed: 0, done: 0 });
    expect(await db.outboxJob.findFirstOrThrow()).toMatchObject({ status: "SKIPPED", lastError: expect.stringContaining("STAGING_EMAIL_ALLOW") });

    const messages = (env: Record<string, string>) => checkEnvironment(env).map((finding) => `${finding.level}: ${finding.message}`);
    expect(messages({ ...staging, STRIPE_SECRET_KEY: "sk_live_placeholder" })).toContainEqual(expect.stringMatching(/^error: APP_ENV is staging but STRIPE_SECRET_KEY is a LIVE key/));
    expect(messages(staging).filter((line) => line.startsWith("error"))).toEqual([]);
    expect(messages({ ...staging, STAGING_EMAIL_ALLOW: "" })).toContainEqual(expect.stringMatching(/^warning: APP_ENV is staging and STAGING_EMAIL_ALLOW is empty/));
  });

  it("serves the admin panel only on its own host when one is set", () => {
    const admin = "admin.shop.example";
    // No admin host configured: nothing changes anywhere.
    expect(adminHostRule("shop.example", "/admin/orders", undefined)).toBe("pass");
    expect(adminHostRule("shop.example", "/en/shop", "")).toBe("pass");
    // On the shop's host the panel and its API do not exist; the shop and its own API do.
    expect(adminHostRule("shop.example", "/admin", admin)).toBe("not-found");
    expect(adminHostRule("shop.example", "/admin/orders/abc", admin)).toBe("not-found");
    expect(adminHostRule("shop.example", "/api/admin/graphql", admin)).toBe("not-found");
    expect(adminHostRule("shop.example", "/en/shop", admin)).toBe("pass");
    expect(adminHostRule("shop.example", "/api/graphql", admin)).toBe("pass");
    expect(adminHostRule("shop.example", "/administration", admin)).toBe("pass"); // not the panel
    // On the admin host: the panel, the APIs and files; everything else goes to the panel.
    expect(adminHostRule("admin.shop.example", "/admin/orders", admin)).toBe("pass");
    expect(adminHostRule("ADMIN.shop.example:443", "/admin", admin)).toBe("pass");
    expect(adminHostRule("admin.shop.example", "/api/webhooks/stripe", admin)).toBe("pass");
    expect(adminHostRule("admin.shop.example", "/_next/static/chunk.js", admin)).toBe("pass");
    expect(adminHostRule("admin.shop.example", "/", admin)).toBe("to-admin");
    expect(adminHostRule("admin.shop.example", "/en/shop", admin)).toBe("to-admin");
    expect(adminHostRule(null, "/admin", admin)).toBe("not-found"); // no host header: not the admin host
  });
});

describe("error reports", () => {
  it("keeps one row per distinct error, without personal data, and tells the shop once a day", async () => {
    const now = new Date("2026-11-19T10:00:00Z");
    const report = { message: "Cannot read properties of undefined (reading 'aggregate') for customer greta@example.com", digest: "1816558115", stack: "TypeError: boom\n    at spentThisMonth (assistant.ts:40:34)\n    at Assistant (StoreChrome.tsx:42:45)", path: "/en/shop?utm=1", method: "GET", route: "/[locale]/shop", kind: "render" };
    expect(await recordError(db, report, now)).toBe("recorded");
    expect(await recordError(db, { ...report, digest: "208500320", path: "/en/cart" }, new Date(now.getTime() + 60_000))).toBe("recorded");
    expect(await recordError(db, { ...report, route: "/[locale]/cart" }, now)).toBe("recorded"); // another route: another error

    const rows = await db.errorEvent.findMany({ orderBy: { count: "desc" } });
    expect(rows.map((row) => [row.route, row.count])).toEqual([["/[locale]/shop", 2], ["/[locale]/cart", 1]]);
    expect(rows[0]).toMatchObject({ message: "Cannot read properties of undefined (reading 'aggregate') for customer [email]", lastPath: "/en/cart", lastDigest: "208500320", method: "GET", kind: "render", resolvedAt: null });
    expect(JSON.stringify(rows)).not.toContain("greta@example.com");
    expect(JSON.stringify(rows)).not.toContain("utm=1"); // the query string is not kept

    // One email per distinct error per day, however often it happens.
    expect(await db.outboxJob.count({ where: { kind: "notify.owner.notice" } })).toBe(2);
    await recordError(db, report, new Date(now.getTime() + 86_400_000));
    expect(await db.outboxJob.count({ where: { kind: "notify.owner.notice" } })).toBe(3);
    const job = await db.outboxJob.findFirstOrThrow({ orderBy: { createdAt: "asc" } });
    expect(job.payload).toMatchObject({ subject: expect.stringContaining("Website error: Cannot read properties"), path: "/admin/system" });
  });

  it("does not count ordinary refusals or page redirects as errors, and never throws itself", async () => {
    expect(await recordError(db, { message: "Your role does not allow this action.", code: "FORBIDDEN" })).toBe("ignored");
    expect(await recordError(db, { message: "Please sign in.", code: "UNAUTHENTICATED" })).toBe("ignored");
    expect(await recordError(db, { message: "NEXT_REDIRECT", digest: "NEXT_REDIRECT;replace;/en;307;" })).toBe("ignored");
    expect(await recordError(db, { message: new AppError("OUT_OF_STOCK", "Sold out.").message, code: "INTERNAL" })).toBe("recorded"); // anything else is kept
    expect(await db.errorEvent.count()).toBe(1);
    // A database that cannot be written to does not turn one failure into two.
    const broken = { errorEvent: { count: () => Promise.reject(new Error("database down")) } } as unknown as typeof db;
    expect(await recordError(broken, { message: "Something" })).toBe("failed");

    expect(scrub("key sk_live_abcdefghijklmnop and token 0123456789abcdef0123456789abcdef0123 for a@b.example")).toBe("key [key] and token [id] for [email]");
    expect(scrub("word ".repeat(300))).toHaveLength(400);
  });

  it("cannot be used to fill the database or the owner's inbox", async () => {
    const now = new Date("2026-11-19T10:00:00Z");
    for (let index = 0; index < ERROR_LIMITS.emailsPerDay + 4; index += 1) await recordError(db, { message: `Failure of kind ${"abcdefghijklmnop"[index]}`, route: "/x" }, now);
    expect(await db.errorEvent.count()).toBe(ERROR_LIMITS.emailsPerDay + 4);
    expect(await db.outboxJob.count({ where: { kind: "notify.owner.notice" } })).toBe(ERROR_LIMITS.emailsPerDay); // the rest are on the status page only

    await db.errorEvent.createMany({ data: Array.from({ length: ERROR_LIMITS.rows }, (_, index) => ({ fingerprint: `filler-${index}`, message: "filler" })) });
    expect(await recordError(db, { message: "A brand new failure", route: "/y" }, now)).toBe("ignored");
    expect(await recordError(db, { message: "Failure of kind a", route: "/x" }, now)).toBe("recorded"); // one already known is still counted
    expect((await db.errorEvent.findFirstOrThrow({ where: { message: "Failure of kind a" } })).count).toBe(2);
  });

  it("is resolved by a manager, reopens if it happens again, and is deleted 90 days after being resolved", async () => {
    await recordError(db, { message: "A failure", route: "/x" });
    const error = await db.errorEvent.findFirstOrThrow();
    await refused(resolveError(await as("STAFF"), error.id), "FORBIDDEN");
    const manager = await as("OPERATIONS_MANAGER");
    await refused(resolveError(manager, error.id), "FORBIDDEN"); // integrations are view-only for an operations manager
    const boss = await as("ADMINISTRATOR");
    await resolveError(boss, error.id);
    await refused(resolveError(boss, error.id), "NOT_FOUND");
    expect(await db.errorEvent.findFirstOrThrow()).toMatchObject({ resolvedById: boss.admin!.id });

    await recordError(db, { message: "A failure", route: "/x" });
    expect(await db.errorEvent.findFirstOrThrow()).toMatchObject({ resolvedAt: null, count: 2 });

    await resolveError(boss, error.id);
    const later = (days: number) => new Date(Date.now() + days * 86_400_000);
    expect(await purgeOldErrors(db, later(89))).toBe(0);
    expect(await purgeOldErrors(db, later(91))).toBe(1);
  });
});

describe("system status", () => {
  it("says in words what is wrong on a live site, worst first, and never shows a key", async () => {
    const now = new Date("2026-11-19T10:00:00Z");
    // A live site where nothing has been connected.
    const bare = await systemChecks(db, { NODE_ENV: "production", APP_URL: "http://shop.example" }, now);
    expect(bare.environment).toBe("production");
    expect(bare.state).toBe("failing");
    expect(Object.fromEntries(bare.checks.map((check) => [check.key, check.state]))).toMatchObject({ database: "ok", scheduler: "failing", payments: "failing", email: "failing", address: "failing", secret: "failing", carriers: "warning", messages: "ok", errors: "ok" });
    expect(bare.checks[0].state).toBe("failing");
    expect(bare.checks.at(-1)!.state).toBe("ok");

    // Connected, but the scheduler has never run.
    const connected = await systemChecks(db, LIVE, now);
    expect(stateOf(connected, "scheduler")).toBe("failing");
    expect(connected.checks.find((check) => check.key === "scheduler")!.detail).toContain("never run");
    expect(stateOf(connected, "payments")).toBe("ok");
    expect(JSON.stringify(connected)).not.toMatch(/sk_live|whsec_|re_placeholder|aaaaaaaa|cccccccc/);

    // The scheduler runs: its heartbeat is noticed, and so is its silence afterwards.
    const report = await runScheduledWork(db, { now, env: LIVE });
    expect(report.purged).toMatchObject({ errors: 0 });
    expect(stateOf(await systemChecks(db, LIVE, new Date(now.getTime() + 5 * 60_000)), "scheduler")).toBe("ok");
    const silent = await systemChecks(db, LIVE, new Date(now.getTime() + 45 * 60_000));
    expect(silent.checks.find((check) => check.key === "scheduler")).toMatchObject({ state: "failing", detail: expect.stringContaining("45 minutes ago") });

    // A test key on the live site takes no money; a live key on staging takes real money for test orders.
    expect(stateOf(await systemChecks(db, { ...LIVE, STRIPE_SECRET_KEY: "sk_test_placeholder" }, now), "payments")).toBe("failing");
    expect(stateOf(await systemChecks(db, { ...LIVE, APP_ENV: "staging" }, now), "payments")).toBe("failing");
    expect(stateOf(await systemChecks(db, { ...LIVE, APP_ENV: "staging", STRIPE_SECRET_KEY: "sk_test_placeholder" }, now), "payments")).toBe("ok");

    // A failed message and an error each raise a warning.
    await db.outboxJob.create({ data: { kind: "notify.customer.confirmation", dedupeKey: "x", payload: {}, status: "FAILED", lastError: "Mailbox full" } });
    await recordError(db, { message: "A failure", route: "/x" }, now);
    const troubled = await systemChecks(db, LIVE, new Date(now.getTime() + 60_000));
    expect(stateOf(troubled, "messages")).toBe("warning");
    expect(stateOf(troubled, "errors")).toBe("warning");

    // Staff without a second factor are counted; on a live site they can do nothing until they enrol.
    await as("STAFF");
    expect((await systemChecks(db, LIVE, now)).checks.find((check) => check.key === "staff")).toMatchObject({ state: "ok", detail: expect.stringContaining("1 account(s) have not set it up yet") });
    expect(stateOf(await systemChecks(db, { NODE_ENV: "development" }, now), "staff")).toBe("warning");
  });

  it("is shown to staff who may see integrations, and served to a monitor only with the scheduler's secret", async () => {
    await refused(systemOverview(await as("WAREHOUSE_MANAGER")), "FORBIDDEN");
    const overview = await systemOverview(await as("OPERATIONS_MANAGER"));
    expect(overview.checks.length).toBeGreaterThan(8);
    expect(overview).toMatchObject({ errors: [], scheduler: null });

    const secretBefore = process.env.CRON_SECRET;
    process.env.CRON_SECRET = "monitor-secret-monitor-secret-01";
    try {
      const call = (authorization?: string) => statusRoute(new Request("http://localhost:3000/api/status", { headers: authorization ? { authorization } : {} }));
      expect((await call()).status).toBe(401);
      expect((await call("Bearer wrong-secret-wrong-secret-wrong1")).status).toBe(401);
      const answer = await call("Bearer monitor-secret-monitor-secret-01");
      expect([200, 503]).toContain(answer.status);
      expect(answer.headers.get("cache-control")).toBe("no-store");
      const body = (await answer.json()) as { environment: string; state: string; checks: { key: string }[] };
      expect(body.checks.map((check) => check.key)).toContain("database");
      expect(JSON.stringify(body)).not.toContain("monitor-secret");
    } finally {
      if (secretBefore === undefined) delete process.env.CRON_SECRET;
      else process.env.CRON_SECRET = secretBefore;
    }
  });
});
