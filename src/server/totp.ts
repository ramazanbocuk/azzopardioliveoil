import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { AppError } from "./errors";

/**
 * Two-factor sign-in for staff: time-based one-time codes (TOTP, RFC 6238),
 * the kind every authenticator app produces. SHA-1, 30-second steps, six
 * digits — the parameters those apps expect.
 *
 * The shared secret is stored encrypted with APP_SECRET, so a copy of the
 * database alone cannot produce codes. A code is accepted for the current
 * step and one step either side, to allow for clock drift.
 */

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(bytes: Buffer): string {
  let bits = "";
  for (const byte of bytes) bits += byte.toString(2).padStart(8, "0");
  let out = "";
  for (let index = 0; index < bits.length; index += 5) out += BASE32[parseInt(bits.slice(index, index + 5).padEnd(5, "0"), 2)];
  return out;
}

export function base32Decode(text: string): Buffer {
  let bits = "";
  for (const char of text.toUpperCase().replace(/[^A-Z2-7]/g, "")) bits += BASE32.indexOf(char).toString(2).padStart(5, "0");
  const bytes: number[] = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) bytes.push(parseInt(bits.slice(index, index + 8), 2));
  return Buffer.from(bytes);
}

export function totpCode(secret: string, atMs: number, stepOffset = 0): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(atMs / 30_000) + stepOffset));
  const digest = createHmac("sha1", base32Decode(secret)).update(counter).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const value = ((digest[offset] & 0x7f) << 24) | (digest[offset + 1] << 16) | (digest[offset + 2] << 8) | digest[offset + 3];
  return String(value % 1_000_000).padStart(6, "0");
}

export function verifyTotp(secret: string, code: string, atMs = Date.now()): boolean {
  const given = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(given)) return false;
  return [-1, 0, 1].some((offset) => timingSafeEqual(Buffer.from(totpCode(secret, atMs, offset)), Buffer.from(given)));
}

function key(env: Record<string, string | undefined>): Buffer {
  if (!env.APP_SECRET || env.APP_SECRET.length < 32) throw new AppError("BAD_INPUT", "Two-factor sign-in needs APP_SECRET (32+ characters) to be set on the server.");
  return createHash("sha256").update(`totp:${env.APP_SECRET}`).digest();
}

export function sealSecret(secret: string, env: Record<string, string | undefined> = process.env): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(env), iv);
  const body = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), body].map((part) => part.toString("base64url")).join(".");
}

export function openSecret(sealed: string, env: Record<string, string | undefined> = process.env): string {
  const [iv, tag, body] = sealed.split(".").map((part) => Buffer.from(part, "base64url"));
  const decipher = createDecipheriv("aes-256-gcm", key(env), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
}

/** Checks the second factor at sign-in. Returns true when the account has none. Throws when a code is required and missing or wrong. */
export function checkSecondFactor(admin: { totpSecret: string | null; totpEnabledAt: Date | null }, code: string | null | undefined): void {
  if (!admin.totpEnabledAt || !admin.totpSecret) return;
  if (!code || !code.trim()) throw new AppError("INVALID_CREDENTIALS", "Enter the 6-digit code from your authenticator app.", "code");
  let secret: string;
  try {
    secret = openSecret(admin.totpSecret);
  } catch {
    throw new AppError("INVALID_CREDENTIALS", "Two-factor sign-in cannot be checked on this server. Ask an administrator to reset it.");
  }
  if (!verifyTotp(secret, code)) throw new AppError("INVALID_CREDENTIALS", "That code is not right, or has expired. Enter the current 6-digit code.", "code");
}

