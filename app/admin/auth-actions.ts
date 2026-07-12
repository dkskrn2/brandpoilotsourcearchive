"use server";

import type { Route } from "next";
import { redirect } from "next/navigation";
import {
  createAdminSession,
  deleteAdminSession,
  verifyAdminCredentials
} from "@/lib/admin-auth";
import { isAdminConfigured } from "@/lib/admin-session";

function safeNextPath(value: FormDataEntryValue | null) {
  const path = typeof value === "string" ? value : "/admin";
  return path.startsWith("/admin") && !path.startsWith("//") && path !== "/admin/login" ? path : "/admin";
}

export async function loginAdminAction(formData: FormData) {
  const username = String(formData.get("username") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const nextPath = safeNextPath(formData.get("next"));

  if (!isAdminConfigured()) {
    redirect(`/admin/login?error=config&next=${encodeURIComponent(nextPath)}` as Route);
  }
  if (!verifyAdminCredentials(username, password)) {
    await new Promise((resolve) => setTimeout(resolve, 650));
    redirect(`/admin/login?error=invalid&next=${encodeURIComponent(nextPath)}` as Route);
  }

  await createAdminSession(username);
  redirect(nextPath as Route);
}

export async function logoutAdminAction() {
  await deleteAdminSession();
  redirect("/admin/login" as Route);
}
