import crypto from "node:crypto";

export function normalizeSourceDomain(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

export function normalizeSourceUrl(url: string): string {
  const trimmed = url.trim();
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error("unsupported_protocol");
    }
    return trimmed;
  } catch {
    throw new Error("source_url_invalid");
  }
}

function canonicalSourceUrl(url: string): string {
  const trimmed = url.trim();
  const parts = trimmed.match(/^([a-z][a-z\d+.-]*):\/\/([^/?#]*)([\s\S]*)$/i);
  if (!parts) return trimmed;

  try {
    const parsed = new URL(trimmed);
    const rawAuthority = parts[2];
    const userInfoEnd = rawAuthority.lastIndexOf("@");
    const userInfo = userInfoEnd >= 0 ? rawAuthority.slice(0, userInfoEnd + 1) : "";
    const suffix = parts[3];
    return `${parsed.protocol.toLowerCase()}//${userInfo}${parsed.host}${suffix}`;
  } catch {
    return trimmed;
  }
}

export function hashSourceUrl(url: string): string {
  return crypto.createHash("sha256").update(canonicalSourceUrl(url)).digest("hex");
}
