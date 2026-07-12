import { jwtVerify, SignJWT } from "jose";

export const ADMIN_SESSION_COOKIE = "growthline_admin_session";
export const ADMIN_SESSION_MAX_AGE = 60 * 60 * 8;

type AdminSession = {
  username: string;
  role: "admin";
};

function sessionSecret() {
  const secret = process.env.ADMIN_SESSION_SECRET?.trim() ?? "";
  return secret.length >= 32 ? new TextEncoder().encode(secret) : undefined;
}

export function isAdminConfigured() {
  return Boolean(
    process.env.ADMIN_USERNAME?.trim() &&
    process.env.ADMIN_PASSWORD &&
    sessionSecret()
  );
}

export async function createAdminToken(username: string) {
  const secret = sessionSecret();
  if (!secret) throw new Error("ADMIN_SESSION_SECRET은 32자 이상이어야 합니다.");
  return new SignJWT({ role: "admin" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(username)
    .setIssuedAt()
    .setExpirationTime(`${ADMIN_SESSION_MAX_AGE}s`)
    .sign(secret);
}

export async function verifyAdminToken(token?: string): Promise<AdminSession | null> {
  const secret = sessionSecret();
  if (!secret || !token) return null;
  try {
    const { payload } = await jwtVerify(token, secret, { algorithms: ["HS256"] });
    if (payload.role !== "admin" || typeof payload.sub !== "string") return null;
    return { username: payload.sub, role: "admin" };
  } catch {
    return null;
  }
}
