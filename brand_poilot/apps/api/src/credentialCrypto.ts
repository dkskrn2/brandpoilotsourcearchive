import crypto from "node:crypto";

const CIPHER = "aes-256-gcm";
const PREFIX = "v1";
const DEV_KEY_SEED = "brand-pilot-local-dev-credential-key";

function resolveKey(keyMaterial = process.env.CREDENTIAL_ENCRYPTION_KEY) {
  if (keyMaterial) {
    const base64 = Buffer.from(keyMaterial, "base64");
    if (base64.length === 32) return base64;

    const hex = Buffer.from(keyMaterial, "hex");
    if (hex.length === 32) return hex;

    if (Buffer.byteLength(keyMaterial, "utf8") >= 32) {
      return crypto.createHash("sha256").update(keyMaterial).digest();
    }
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error("credential_encryption_key_required");
  }

  return crypto.createHash("sha256").update(DEV_KEY_SEED).digest();
}

export function encryptCredential(plainText: string, keyMaterial?: string) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(CIPHER, resolveKey(keyMaterial), iv);
  const encrypted = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    PREFIX,
    iv.toString("base64url"),
    tag.toString("base64url"),
    encrypted.toString("base64url")
  ].join(":");
}

export function decryptCredential(payload: string, keyMaterial?: string) {
  const [version, iv, tag, encrypted] = payload.split(":");
  if (version !== PREFIX || !iv || !tag || !encrypted) {
    throw new Error("invalid_encrypted_credential");
  }

  const decipher = crypto.createDecipheriv(CIPHER, resolveKey(keyMaterial), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encrypted, "base64url")),
    decipher.final()
  ]).toString("utf8");
}

export function isEncryptedCredential(value: string) {
  return value.startsWith(`${PREFIX}:`);
}
