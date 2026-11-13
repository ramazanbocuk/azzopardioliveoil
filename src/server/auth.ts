import { z } from "zod";
import type { AdminUser, Customer } from "@/generated/prisma/client";
import { COOKIE, TTL, clearCookie, setCookie, type Ctx, rememberLocale } from "./context";
import { LOCALE_COOKIE, isLocale } from "@/i18n/config";
import { burnPasswordCheck, hashPassword, hashToken, newToken, verifyPassword } from "./crypto";
import { AppError, parse } from "./errors";
import { resetPurpose, verifyLink } from "./notifications/messages";
import { eraseCustomerData } from "./privacy";
import { can, type Area, type Level } from "./permissions";
import { enforce } from "./rateLimit";
import { checkSecondFactor } from "./totp";

const email = z.string().trim().toLowerCase().email("Enter a valid email address.").max(254);
const password = z.string().min(12, "Use at least 12 characters.").max(128, "Use at most 128 characters.");
const name = z.string().trim().min(1, "This field is required.").max(80);

const registerInput = z.object({ email, password, firstName: name, lastName: name, marketingOptIn: z.boolean().nullish().transform((value) => value ?? false) });
const loginInput = z.object({ email, password: z.string().min(1).max(128) });
const adminLoginInput = loginInput.extend({ code: z.string().trim().max(12).nullish() });

const INVALID = "The email address or password is incorrect.";

async function startCustomerSession(ctx: Ctx, customer: Customer) {
  const token = newToken();
  await ctx.db.customerSession.create({
    data: { tokenHash: hashToken(token), customerId: customer.id, expiresAt: new Date(Date.now() + TTL.session * 1000), ip: ctx.ip, userAgent: ctx.userAgent?.slice(0, 300) },
  });
  setCookie(ctx, COOKIE.session, token, TTL.session);
  ctx.customer = customer;

  // A cart filled before signing in follows the customer.
  const cartToken = ctx.cookies[COOKIE.cart];
  if (cartToken) await ctx.db.cart.updateMany({ where: { tokenHash: hashToken(cartToken), customerId: null }, data: { customerId: customer.id } });
}

export async function register(ctx: Ctx, input: unknown): Promise<Customer> {
  const data = parse(registerInput, input);
  await enforce(ctx.db, `register:ip:${ctx.ip}`, 10, 3600);

  if (await ctx.db.customer.findUnique({ where: { email: data.email }, select: { id: true } })) {
    throw new AppError("EMAIL_TAKEN", "An account with this email address already exists.", "email");
  }
  const customer = await ctx.db.customer.create({
    data: { email: data.email, passwordHash: await hashPassword(data.password), firstName: data.firstName, lastName: data.lastName, marketingOptIn: data.marketingOptIn, locale: ctx.locale ?? "en" },
  });
  await startCustomerSession(ctx, customer);
  return customer;
}

export async function login(ctx: Ctx, input: unknown): Promise<Customer> {
  const data = parse(loginInput, input);
  // Two windows: one per address (stops spraying), one per account (stops guessing).
  await enforce(ctx.db, `login:ip:${ctx.ip}`, 20, 900);
  await enforce(ctx.db, `login:email:${data.email}`, 8, 900);

  const customer = await ctx.db.customer.findUnique({ where: { email: data.email } });
  if (!customer || customer.erasedAt) {
    await burnPasswordCheck(data.password);
    throw new AppError("INVALID_CREDENTIALS", INVALID);
  }
  if (!(await verifyPassword(customer.passwordHash, data.password))) throw new AppError("INVALID_CREDENTIALS", INVALID);

  await startCustomerSession(ctx, customer);
  // A returning customer who has not chosen a language on this device gets the one saved on their account.
  if (!ctx.cookies[LOCALE_COOKIE] && isLocale(customer.locale)) rememberLocale(ctx, customer.locale);
  return customer;
}

/** Records an explicit language choice: on this device, and on the account when signed in. */
export async function chooseLanguage(ctx: Ctx, value: string): Promise<string> {
  if (!isLocale(value)) throw new AppError("BAD_INPUT", "That language is not available.");
  rememberLocale(ctx, value);
  if (ctx.customer) await ctx.db.customer.update({ where: { id: ctx.customer.id }, data: { locale: value } });
  return value;
}

export async function logout(ctx: Ctx): Promise<void> {
  const token = ctx.cookies[COOKIE.session];
  if (token) await ctx.db.customerSession.deleteMany({ where: { tokenHash: hashToken(token) } });
  clearCookie(ctx, COOKIE.session);
  ctx.customer = null;
}

/**
 * Always answers the same way, whether or not the address has an account,
 * so the form cannot be used to discover who is a customer.
 */
export async function requestPasswordReset(ctx: Ctx, rawEmail: string): Promise<void> {
  await enforce(ctx.db, `reset:ip:${ctx.ip}`, 5, 3600);
  const address = rawEmail.trim().toLowerCase();
  await enforce(ctx.db, `reset:email:${address}`, 3, 3600);
  const customer = await ctx.db.customer.findUnique({ where: { email: address }, select: { id: true, erasedAt: true } });
  if (!customer || customer.erasedAt) return;
  const window = Math.floor(Date.now() / 600_000); // at most one email per account per ten minutes
  await ctx.db.outboxJob.createMany({ data: [{ kind: "email.password.reset", dedupeKey: `email.password.reset:${customer.id}:${window}`, payload: { customerId: customer.id } }], skipDuplicates: true });
}

const resetInput = z.object({ id: z.string().min(1).max(60), exp: z.coerce.number().int().positive(), sig: z.string().min(1).max(200), password });

export async function resetPassword(ctx: Ctx, input: unknown): Promise<void> {
  const data = parse(resetInput, input);
  await enforce(ctx.db, `reset-use:ip:${ctx.ip}`, 10, 3600);
  const invalid = new AppError("BAD_INPUT", "This reset link is no longer valid. Please request a new one.");
  const customer = await ctx.db.customer.findUnique({ where: { id: data.id } });
  if (!customer || customer.erasedAt || data.exp < Date.now() || !verifyLink(resetPurpose(data.exp, customer.passwordHash), customer.id, data.sig)) throw invalid;

  await ctx.db.$transaction([
    ctx.db.customer.update({ where: { id: customer.id }, data: { passwordHash: await hashPassword(data.password) } }),
    // Anyone signed in with the old password, on any device, is signed out.
    ctx.db.customerSession.deleteMany({ where: { customerId: customer.id } }),
    ctx.db.auditLog.create({ data: { actorType: "customer", actorId: customer.id, action: "customer.password.reset", entity: "Customer", entityId: customer.id, ip: ctx.ip } }),
  ]);
}

/** The customer deletes their own account. Requires the current password, so a borrowed session cannot do it. */
export async function deleteOwnAccount(ctx: Ctx, currentPassword: string): Promise<void> {
  const customer = requireCustomer(ctx);
  await enforce(ctx.db, `delete-account:${customer.id}`, 5, 3600);
  if (!(await verifyPassword(customer.passwordHash, currentPassword))) throw new AppError("INVALID_CREDENTIALS", "That password is not correct.", "password");
  await eraseCustomerData(ctx.db, customer.id);
  await ctx.db.auditLog.create({ data: { actorType: "customer", actorId: customer.id, action: "customer.self_erase", entity: "Customer", entityId: customer.id, ip: ctx.ip } });
  clearCookie(ctx, COOKIE.session);
  ctx.customer = null;
}

// ── Administration ──

export async function adminLogin(ctx: Ctx, input: unknown): Promise<AdminUser> {
  const data = parse(adminLoginInput, input);
  await enforce(ctx.db, `admin-login:ip:${ctx.ip}`, 10, 900);
  await enforce(ctx.db, `admin-login:email:${data.email}`, 5, 900);

  const admin = await ctx.db.adminUser.findUnique({ where: { email: data.email } });
  const ok = admin && admin.isActive ? await verifyPassword(admin.passwordHash, data.password) : (await burnPasswordCheck(data.password), false);
  if (!admin || !ok) {
    await ctx.db.auditLog.create({ data: { actorType: "anonymous", action: "admin.login.failed", entity: "AdminUser", data: { email: data.email }, ip: ctx.ip } });
    throw new AppError("INVALID_CREDENTIALS", INVALID);
  }
  // The password was right; now the second factor, if this account has one. A wrong code counts as a failed sign-in.
  try {
    checkSecondFactor(admin, data.code);
  } catch (error) {
    if (data.code?.trim()) await ctx.db.auditLog.create({ data: { actorType: "anonymous", action: "admin.login.failed", entity: "AdminUser", entityId: admin.id, data: { email: data.email, reason: "second factor" }, ip: ctx.ip } });
    throw error;
  }

  const token = newToken();
  await ctx.db.$transaction([
    ctx.db.adminSession.create({ data: { tokenHash: hashToken(token), adminUserId: admin.id, expiresAt: new Date(Date.now() + TTL.admin * 1000), ip: ctx.ip, userAgent: ctx.userAgent?.slice(0, 300) ?? null } }),
    ctx.db.adminUser.update({ where: { id: admin.id }, data: { lastLoginAt: new Date() } }),
    ctx.db.auditLog.create({ data: { actorType: "admin", actorId: admin.id, action: "admin.login", entity: "AdminUser", entityId: admin.id, ip: ctx.ip } }),
  ]);
  setCookie(ctx, COOKIE.admin, token, TTL.admin, "Strict");
  ctx.admin = admin;
  return admin;
}

export async function adminLogout(ctx: Ctx): Promise<void> {
  const token = ctx.cookies[COOKIE.admin];
  if (token) await ctx.db.adminSession.deleteMany({ where: { tokenHash: hashToken(token) } });
  clearCookie(ctx, COOKIE.admin);
  ctx.admin = null;
}

// ── Guards: every protected resolver calls one of these first ──

export function requireCustomer(ctx: Ctx): Customer {
  if (!ctx.customer) throw new AppError("UNAUTHENTICATED", "Please sign in.");
  return ctx.customer;
}

/**
 * The server-side gate for every staff action. `minimum` is the level the
 * action needs and `area` is the part of the business it belongs to; the
 * person's role must reach that level in that area (see permissions.ts).
 */
export function requireAdmin(ctx: Ctx, minimum: Level = "STAFF", area: Area = "general"): AdminUser {
  if (!ctx.admin) throw new AppError("UNAUTHENTICATED", "Please sign in.");
  // Without a second factor a person may do one thing: set one up (and manage their own sessions).
  if (mustEnrol(ctx.admin) && !(area === "security" && minimum === "STAFF")) throw new AppError("FORBIDDEN", TWO_FACTOR_FIRST);
  if (!can(ctx.admin.role, minimum, area)) throw new AppError("FORBIDDEN", "Your role does not allow this action.");
  return ctx.admin;
}

const TWO_FACTOR_FIRST = "Set up two-factor sign-in before using the admin panel: Admin → Security.";

/**
 * Two-factor sign-in is compulsory for staff. In production there is no way
 * to switch that off. Outside production (tests, a developer's own machine)
 * it applies only when ADMIN_TWO_FACTOR=required, so a fresh local database
 * is not locked before anyone has a phone enrolled.
 */
export const twoFactorRequired = (env: Record<string, string | undefined> = process.env): boolean => env.NODE_ENV === "production" || env.ADMIN_TWO_FACTOR === "required";

/** True when this person must set up a second factor before doing anything else. */
export const mustEnrol = (admin: Pick<AdminUser, "totpEnabledAt">, env: Record<string, string | undefined> = process.env): boolean => twoFactorRequired(env) && !admin.totpEnabledAt;

/** For actions open to every member of staff whatever their role: signed in, and with a second factor where one is required. */
export function requireStaff(ctx: Ctx): AdminUser {
  if (!ctx.admin) throw new AppError("UNAUTHENTICATED", "Please sign in.");
  if (mustEnrol(ctx.admin)) throw new AppError("FORBIDDEN", TWO_FACTOR_FIRST);
  return ctx.admin;
}
