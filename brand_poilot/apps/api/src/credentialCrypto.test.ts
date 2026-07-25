import { describe, expect, it } from "vitest";
import { decryptCredential, encryptCredential, isEncryptedCredential } from "./credentialCrypto";

describe("credentialCrypto", () => {
  it("encrypts credential values before storage and can decrypt them with the same key", () => {
    const key = "0123456789abcdef0123456789abcdef";
    const encrypted = encryptCredential("raw-token-value", key);

    expect(encrypted).not.toBe("raw-token-value");
    expect(isEncryptedCredential(encrypted)).toBe(true);
    expect(decryptCredential(encrypted, key)).toBe("raw-token-value");
  });
});
