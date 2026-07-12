import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";
import type { Route } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  ADMIN_SESSION_COOKIE,
  ADMIN_SESSION_MAX_AGE,
  createAdminToken,
  isAdminConfigured,
  verifyAdminToken
} from "@/lib/admin-session";

function safeEqual(left: string, right: string) {
  const leftHash = createHash("sha256").update(left).digest();
  const rightHash = createHash("sha256").update(right).digest();
  return timingSafeEqual(leftHash, rightHash);
}

export function verifyAdminCredentials(username: string, password: string) {
  const expectedUsername = process.env.ADMIN_USERNAME?.trim() ?? "";
  const expectedPassword = process.env.ADMIN_PASSWORD ?? "";
  if (!isAdminConfigured()) return false;
  return safeEqual(username, expectedUsername) && safeEqual(password, expectedPassword);
}

export async function createAdminSession(username: string) {
  const token = await createAdminToken(username);
  (await cookies()).set(ADMIN_SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge: ADMIN_SESSION_MAX_AGE,
    path: "/"
  });
}

export async function deleteAdminSession() {
  (await cookies()).delete(ADMIN_SESSION_COOKIE);
}

export async function getAdminSession() {
  const token = (await cookies()).get(ADMIN_SESSION_COOKIE)?.value;
  return verifyAdminToken(token);
}

export async function requireAdminSession(nextPath = "/admin") {
  const session = await getAdminSession();
  if (!session) redirect(`/admin/login?next=${encodeURIComponent(nextPath)}` as Route);
  return session;
}
