import crypto from "node:crypto";

export function hashSourceUrl(url: string): string {
  return crypto.createHash("sha256").update(url.trim().toLowerCase()).digest("hex");
}
