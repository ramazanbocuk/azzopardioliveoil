import { beforeEach, describe, expect, it } from "vitest";
import { adminLogin, requestStaffPasswordReset, resetPassword, resetStaffPassword } from "@/server/auth";
import type { Ctx } from "@/server/context";
import { hashToken, newToken } from "@/server/crypto";
import { processJobs } from "@/server/jobs";
import type { Transport } from "@/server/notifications/channels";
import { staffPasswordResetEmail } from "@/server/notifications/messages";
import { createAdmin, db, resetDb } from "../helpers";

/**
 * "Forgot my password" on the staff sign-in screen. What must hold: the form
 * tells nobody who is a member of staff; the link works once and for a short
 * time; it changes the password and nothing else, so the second factor still
 * stands between a stolen mailbox and the panel; every device is signed out.
 */

const ENV = { RESEND_API_KEY: "re_test_placeholder", EMAIL_FROM: "shop@example.com" };
const OLD = "correct horse battery";
const NEW = "a brand new long password";
let ip = 0;
const visitor = (): Ctx => ({ db, ip: `10.7.0.${++ip}`, userAgent: null, cookies: {}, setCookies: [], customer: null, admin: null });
/** A staff account as the database holds it. */
const staff = async (role: Parameters<typeof createAdmin>[0]) => db.adminUser.findUniqueOrThrow({ where: { email: (await createAdmin(role)).email } });
const outcome = (promise: Promise<unknown>) => promise.then(() => "ok", (error: { code?: string }) => error.code ?? "threw");

/** Sends what is waiting and returns the emails, as { to, text }. */
async function deliver() {
  const sent: { to: string; text: string }[] = [];
  const transport: Transport = async (_url, init) => {
    const body = JSON.parse(init.body) as { to: string | string[]; text: string };
    sent.push({ to: [body.to].flat()[0], text: body.text });
    return { ok: true, status: 200, text: async () => "" };
  };
  await processJobs(db, { env: ENV, transport });
  return sent;
}
const linkIn = (text: string) => {
  const url = new URL(text.split("\n").find((line) => line.startsWith("http")) ?? "");
  return { url, id: url.searchParams.get("reset") ?? "", exp: url.searchParams.get("exp") ?? "", sig: url.searchParams.get("sig") ?? "" };
};
async function askFor(email: string) {
  await requestStaffPasswordReset(visitor(), email);
  const sent = await deliver();
  return sent.length ? linkIn(sent[0].text) : null;
}

beforeEach(async () => {
  await resetDb();
  process.env.APP_SECRET = "s".repeat(40);
  delete process.env.ADMIN_HOST;
});

describe("a member of staff who forgot their password", () => {
  it("is answered the same way as a stranger, and only a real, active account is emailed", async () => {
    const admin = await staff("MANAGER");
    const off = await staff("STAFF");
    await db.adminUser.update({ where: { id: off.id }, data: { isActive: false } });

    expect(await outcome(requestStaffPasswordReset(visitor(), "nobody@example.com"))).toBe("ok");
    expect(await outcome(requestStaffPasswordReset(visitor(), off.email))).toBe("ok");
    expect(await deliver()).toEqual([]);

    expect(await outcome(requestStaffPasswordReset(visitor(), `  ${admin.email.toUpperCase()} `))).toBe("ok");
    // Asking again straight away does not send a second email.
    await requestStaffPasswordReset(visitor(), admin.email);
    const sent = await deliver();
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe(admin.email);
    expect(linkIn(sent[0].text).url.pathname).toBe("/admin");
    expect(sent[0].text).toContain("30 minutes");
    expect(sent[0].text).not.toContain(admin.passwordHash);

    // Every request is on record, whether the address was known or not.
    const log = await db.auditLog.findMany({ where: { action: "admin.password.reset_requested" } });
    expect(log.map((entry) => (entry.data as { known: boolean }).known).sort()).toEqual([false, false, true, true]);
  });

  it("chooses a new password with the link, once, and is signed out everywhere", async () => {
    const admin = await staff("ADMINISTRATOR");
    await db.adminSession.create({ data: { tokenHash: hashToken(newToken()), adminUserId: admin.id, expiresAt: new Date(Date.now() + 3_600_000) } });
    const link = (await askFor(admin.email))!;

    expect(await outcome(resetStaffPassword(visitor(), { ...link, password: NEW, repeat: "something else entirely" }))).toBe("BAD_INPUT");
    expect(await outcome(resetStaffPassword(visitor(), { ...link, password: "too short", repeat: "too short" }))).toBe("BAD_INPUT");
    expect(await outcome(resetStaffPassword(visitor(), { ...link, sig: `${link.sig.slice(0, -2)}xx`, password: NEW, repeat: NEW }))).toBe("BAD_INPUT");
    // A later expiry than the one that was signed is a different link.
    expect(await outcome(resetStaffPassword(visitor(), { ...link, exp: String(Number(link.exp) + 60_000), password: NEW, repeat: NEW }))).toBe("BAD_INPUT");
    expect(await db.adminSession.count()).toBe(1);

    const ctx = visitor();
    expect(await outcome(resetStaffPassword(ctx, { ...link, password: NEW, repeat: NEW }))).toBe("ok");
    expect(ctx.admin).toBeNull(); // changing the password signs nobody in
    expect(await db.adminSession.count()).toBe(0);
    expect(await outcome(adminLogin(visitor(), { email: admin.email, password: OLD }))).toBe("INVALID_CREDENTIALS");
    expect(await outcome(adminLogin(visitor(), { email: admin.email, password: NEW }))).toBe("ok");

    // The same link a second time: the password it was signed against is gone.
    expect(await outcome(resetStaffPassword(visitor(), { ...link, password: "yet another long password", repeat: "yet another long password" }))).toBe("BAD_INPUT");
    expect(await db.auditLog.count({ where: { action: "admin.password.reset", actorId: admin.id } })).toBe(1);
  });

  it("stops working after thirty minutes, and for an account switched off meanwhile", async () => {
    const admin = await staff("MANAGER");
    // The email as it was written thirty-one minutes ago.
    const old = linkIn(staffPasswordResetEmail(admin, new Date(Date.now() - 31 * 60_000))!.text);
    expect(await outcome(resetStaffPassword(visitor(), { ...old, password: NEW, repeat: NEW }))).toBe("BAD_INPUT");

    const other = await staff("STAFF");
    const link = (await askFor(other.email))!;
    await db.adminUser.update({ where: { id: other.id }, data: { isActive: false } });
    expect(await outcome(resetStaffPassword(visitor(), { ...link, password: NEW, repeat: NEW }))).toBe("BAD_INPUT");
  });

  it("leaves two-factor sign-in in place: the new password alone does not open the panel", async () => {
    const admin = await staff("ADMINISTRATOR");
    await db.adminUser.update({ where: { id: admin.id }, data: { totpSecret: "not-a-real-secret", totpEnabledAt: new Date() } });
    const link = (await askFor(admin.email))!;
    await resetStaffPassword(visitor(), { ...link, password: NEW, repeat: NEW });

    const after = await db.adminUser.findUniqueOrThrow({ where: { id: admin.id } });
    expect(after.totpEnabledAt).not.toBeNull();
    expect(after.totpSecret).toBe("not-a-real-secret");
    expect(await outcome(adminLogin(visitor(), { email: admin.email, password: NEW }))).not.toBe("ok");
  });

  it("cannot be done with a customer's reset link, and a staff link is no use on a customer account", async () => {
    const admin = await staff("MANAGER");
    const link = (await askFor(admin.email))!;
    expect(await outcome(resetPassword(visitor(), { ...link, password: NEW }))).toBe("BAD_INPUT");
    expect(await outcome(adminLogin(visitor(), { email: admin.email, password: OLD }))).toBe("ok");
  });

  it("tells the owners when a staff password has been changed this way, and points the link at the panel's own host", async () => {
    process.env.ADMIN_HOST = "panel.example.com";
    const admin = await staff("STAFF");
    const link = (await askFor(admin.email))!;
    expect(link.url.origin).toBe("https://panel.example.com");
    await resetStaffPassword(visitor(), { ...link, password: NEW, repeat: NEW });
    expect(await db.outboxJob.count({ where: { kind: "notify.owner.notice", dedupeKey: { startsWith: `notify.owner.notice:staff-password:${admin.id}` } } })).toBe(1);
  });

  it("asks for no code on a test site where the owners switched two-factor off, and still does everywhere else", async () => {
    const admin = await staff("ADMINISTRATOR");
    await db.adminUser.update({ where: { id: admin.id }, data: { totpSecret: "not-a-real-secret", totpEnabledAt: new Date() } });
    const before = { APP_ENV: process.env.APP_ENV, ADMIN_TWO_FACTOR: process.env.ADMIN_TWO_FACTOR };
    try {
      process.env.ADMIN_TWO_FACTOR = "off"; // without APP_ENV=staging the switch does nothing
      expect(await outcome(adminLogin(visitor(), { email: admin.email, password: OLD }))).toBe("INVALID_CREDENTIALS");
      process.env.APP_ENV = "staging";
      expect(await outcome(adminLogin(visitor(), { email: admin.email, password: OLD }))).toBe("ok");
      expect(await outcome(adminLogin(visitor(), { email: admin.email, password: "the wrong password" }))).toBe("INVALID_CREDENTIALS"); // the password is still checked
      delete process.env.ADMIN_TWO_FACTOR;
      expect(await outcome(adminLogin(visitor(), { email: admin.email, password: OLD }))).toBe("INVALID_CREDENTIALS"); // staging without the switch: the code is needed
    } finally {
      for (const [key, value] of Object.entries(before)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });

  it("limits how often it can be asked for", async () => {
    const admin = await staff("MANAGER");
    const results: string[] = [];
    for (let attempt = 0; attempt < 5; attempt += 1) results.push(await outcome(requestStaffPasswordReset(visitor(), admin.email)));
    expect(results).toEqual(["ok", "ok", "ok", "RATE_LIMITED", "RATE_LIMITED"]);
    const one = visitor();
    const same: string[] = [];
    for (let attempt = 0; attempt < 6; attempt += 1) same.push(await outcome(requestStaffPasswordReset({ ...one }, `person${attempt}@example.com`)));
    expect(same.at(-1)).toBe("RATE_LIMITED");
  });
});
