import { randomBytes } from "node:crypto";
import { audit } from "./admin";
import { requireAdmin } from "./auth";
import type { Ctx } from "./context";
import { hashToken, verifyPassword } from "./crypto";
import { AppError } from "./errors";
import { can } from "./permissions";
import { enforce } from "./rateLimit";
import { base32Encode, openSecret, sealSecret, verifyTotp } from "./totp";

/** Enrolling in, confirming and removing two-factor sign-in, and managing staff sessions. The codes themselves are in totp.ts. */

/** Starts enrolment: makes a new secret and returns it once, for the authenticator app. Not enforced until confirmed. */
export async function beginTotp(ctx: Ctx) {
  const admin = requireAdmin(ctx, "STAFF", "security");
  if (admin.totpEnabledAt) throw new AppError("BAD_INPUT", "Two-factor sign-in is already on. Turn it off first to set it up again.");
  const secret = base32Encode(randomBytes(20));
  await ctx.db.adminUser.update({ where: { id: admin.id }, data: { totpSecret: sealSecret(secret) } });
  await audit(ctx, "admin.2fa.begin", "AdminUser", admin.id);
  const label = encodeURIComponent(`Azzopardi Admin:${admin.email}`);
  return { secret, uri: `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent("Azzopardi Admin")}&algorithm=SHA1&digits=6&period=30` };
}

/** The secret of an enrolment that has been started but not confirmed, so the setup screen can show it again. */
export async function pendingTotp(ctx: Ctx) {
  const admin = requireAdmin(ctx, "STAFF", "security");
  if (admin.totpEnabledAt || !admin.totpSecret) return null;
  try {
    const secret = openSecret(admin.totpSecret);
    return { secret, uri: `otpauth://totp/${encodeURIComponent(`Azzopardi Admin:${admin.email}`)}?secret=${secret}&issuer=${encodeURIComponent("Azzopardi Admin")}&algorithm=SHA1&digits=6&period=30` };
  } catch {
    return null;
  }
}

/** Finishes enrolment by proving the app produces the right code. From now on sign-in needs a code. */
export async function confirmTotp(ctx: Ctx, code: string) {
  const admin = requireAdmin(ctx, "STAFF", "security");
  await enforce(ctx.db, `admin-2fa:${admin.id}`, 10, 900);
  if (admin.totpEnabledAt || !admin.totpSecret) throw new AppError("BAD_INPUT", "Start two-factor setup first.");
  if (!verifyTotp(openSecret(admin.totpSecret), code)) throw new AppError("BAD_INPUT", "That code is not right. Check the time on your phone and enter the current code.", "code");
  await ctx.db.adminUser.update({ where: { id: admin.id }, data: { totpEnabledAt: new Date() } });
  await audit(ctx, "admin.2fa.enabled", "AdminUser", admin.id);
}

/** Turns your own second factor off. Needs your password, so an unattended screen cannot do it. */
export async function disableTotp(ctx: Ctx, password: string) {
  const admin = requireAdmin(ctx, "STAFF", "security");
  await enforce(ctx.db, `admin-2fa:${admin.id}`, 10, 900);
  if (!(await verifyPassword(admin.passwordHash, password))) throw new AppError("BAD_INPUT", "That password is not right.", "password");
  await ctx.db.adminUser.update({ where: { id: admin.id }, data: { totpSecret: null, totpEnabledAt: null } });
  await audit(ctx, "admin.2fa.disabled", "AdminUser", admin.id);
}

/** An administrator clears someone else's second factor, for a lost phone. That person is signed out everywhere. */
export async function resetTotpFor(ctx: Ctx, adminUserId: string) {
  requireAdmin(ctx, "ADMINISTRATOR", "security");
  await ctx.db.$transaction([ctx.db.adminUser.update({ where: { id: adminUserId }, data: { totpSecret: null, totpEnabledAt: null } }), ctx.db.adminSession.deleteMany({ where: { adminUserId } })]);
  await audit(ctx, "admin.2fa.reset", "AdminUser", adminUserId);
}

// ── Sessions ──

export async function securityOverview(ctx: Ctx) {
  const admin = requireAdmin(ctx, "STAFF", "security");
  const everyone = can(admin.role, "ADMINISTRATOR", "security");
  const current = ctx.cookies["azz_admin"] ? hashToken(ctx.cookies["azz_admin"]) : null;
  const dayAgo = new Date(Date.now() - 86_400_000);
  const [sessions, staff, failures, recent] = await Promise.all([
    ctx.db.adminSession.findMany({ where: { expiresAt: { gt: new Date() }, ...(everyone ? {} : { adminUserId: admin.id }) }, orderBy: { createdAt: "desc" }, include: { adminUser: { select: { name: true, email: true } } } }),
    everyone ? ctx.db.adminUser.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, email: true, role: true, isActive: true, totpEnabledAt: true, lastLoginAt: true } }) : [],
    ctx.db.auditLog.count({ where: { action: "admin.login.failed", createdAt: { gt: dayAgo } } }),
    everyone ? ctx.db.auditLog.findMany({ where: { action: { in: ["admin.login", "admin.login.failed", "admin.2fa.enabled", "admin.2fa.disabled", "admin.2fa.reset", "admin.session.revoked", "admin.password.reset_cli"] } }, orderBy: { createdAt: "desc" }, take: 25 }) : [],
  ]);
  return {
    me: { totpOn: !!admin.totpEnabledAt, pending: await pendingTotp(ctx) },
    sessions: sessions.map((session) => ({ id: session.id, who: session.adminUser.name, email: session.adminUser.email, ip: session.ip, userAgent: session.userAgent, createdAt: session.createdAt, expiresAt: session.expiresAt, current: session.tokenHash === current })),
    staff,
    failedSignIns24h: failures,
    recent,
    everyone,
  };
}

/** Signs a device out. Staff may end their own sessions; administrators may end anyone's. */
export async function revokeSession(ctx: Ctx, sessionId: string) {
  const admin = requireAdmin(ctx, "STAFF", "security");
  const session = await ctx.db.adminSession.findUnique({ where: { id: sessionId } });
  if (!session || (session.adminUserId !== admin.id && !can(admin.role, "ADMINISTRATOR", "security"))) throw new AppError("NOT_FOUND", "Session not found.");
  await ctx.db.adminSession.delete({ where: { id: sessionId } });
  await audit(ctx, "admin.session.revoked", "AdminUser", session.adminUserId);
}
