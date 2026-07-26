import { beforeEach, describe, expect, it } from "vitest";
import { decryptToken, encryptToken } from "./token-crypto";

describe("Gmail token encryption", () => {
  beforeEach(() => { process.env.TOKEN_ENCRYPTION_KEY = "test-only-key-that-is-long-enough-for-aes-256"; });
  it("round trips without storing plaintext", () => {
    const encrypted = encryptToken("refresh-secret");
    expect(encrypted).not.toContain("refresh-secret");
    expect(encrypted.startsWith("v1.")).toBe(true);
    expect(decryptToken(encrypted)).toBe("refresh-secret");
  });
  it("rejects corrupted authenticated ciphertext", () => {
    const encrypted = encryptToken("refresh-secret");
    expect(() => decryptToken(`${encrypted.slice(0, -1)}x`)).toThrow();
  });
  it("uses a unique IV", () => {
    expect(encryptToken("same")).not.toBe(encryptToken("same"));
  });
});
