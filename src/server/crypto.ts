import { createHash, randomBytes } from "node:crypto";
import { hash, verify } from "@node-rs/argon2";

/** OWASP-recommended Argon2id parameters (19 MiB, 2 iterations, 1 lane). */
const ARGON2 = { memoryCost: 19456, timeCost: 2, parallelism: 1, outputLen: 32 } as const;

export function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

let dummyHash: Promise<string> | undefined;
/**
 * Verifies against a throwaway hash when no account exists, so a login for
 * an unknown email takes as long as one for a known email.
 */
export async function burnPasswordCheck(password: string): Promise<void> {
  dummyHash ??= hashPassword("not-a-real-password");
  await verifyPassword(await dummyHash, password);
}

/** 256-bit random token for sessions, carts and email links. */
export function newToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Tokens are stored hashed: a leaked database cannot be replayed as sessions. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
