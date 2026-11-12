import { describe, expect, it } from "vitest";
import { hashPassword, hashToken, newToken, verifyPassword } from "@/server/crypto";

describe("crypto", () => {
  it("hashes passwords with Argon2id and verifies them", async () => {
    const hash = await hashPassword("a long enough password");
    expect(hash).toMatch(/^\$argon2id\$/);
    expect(hash).not.toContain("a long enough password");
    expect(await verifyPassword(hash, "a long enough password")).toBe(true);
    expect(await verifyPassword(hash, "a wrong password")).toBe(false);
    expect(await verifyPassword("not-a-hash", "anything")).toBe(false);
  });

  it("salts: the same password never hashes the same twice", async () => {
    expect(await hashPassword("same password twice")).not.toBe(await hashPassword("same password twice"));
  });

  it("issues unguessable tokens and stores only their hash", () => {
    const a = newToken();
    expect(a).not.toBe(newToken());
    expect(a.length).toBeGreaterThanOrEqual(43);
    expect(hashToken(a)).toMatch(/^[a-f0-9]{64}$/);
    expect(hashToken(a)).toBe(hashToken(a));
  });
});
