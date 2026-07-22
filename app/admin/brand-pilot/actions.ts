"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Route } from "next";
import { requireAdminSession } from "@/lib/admin-auth";
import { updateBrandPilotBrandStatus, updateBrandPilotPublishing } from "@/lib/brand-pilot-admin";

export async function updateBrandStatusAction(brandId: string, formData: FormData) {
  const returnPath = `/admin/brand-pilot/brands/${brandId}` as Route;
  const session = await requireAdminSession(returnPath);
  const status = formData.get("status");
  const reason = String(formData.get("reason") ?? "").trim();
  if ((status !== "active" && status !== "paused") || !reason || reason.length > 500) {
    redirect(`${returnPath}?error=${encodeURIComponent("변경 상태와 사유를 확인해 주세요.")}` as Route);
  }
  try {
    await updateBrandPilotBrandStatus(session.username, { brandId, status, reason });
  } catch (error) {
    const message = error instanceof Error ? error.message : "브랜드 상태를 변경하지 못했습니다.";
    redirect(`${returnPath}?error=${encodeURIComponent(message)}` as Route);
  }
  revalidatePath("/admin/brand-pilot");
  revalidatePath("/admin/brand-pilot/brands");
  revalidatePath(returnPath);
  redirect(`${returnPath}?notice=${encodeURIComponent("브랜드 상태를 변경했습니다.")}` as Route);
}

export async function updatePublishingStatusAction(queueId: string, formData: FormData) {
  const returnPath = `/admin/brand-pilot/publishing/${queueId}` as Route;
  const session = await requireAdminSession(returnPath);
  const action = formData.get("action");
  const reason = String(formData.get("reason") ?? "").trim();
  if ((action !== "retry" && action !== "cancel") || !reason || reason.length > 500) {
    redirect(`${returnPath}?error=${encodeURIComponent("변경 사유와 작업을 확인해 주세요.")}` as Route);
  }
  try {
    await updateBrandPilotPublishing(session.username, { queueId, action, reason });
  } catch (error) {
    const message = error instanceof Error ? error.message : "게시 작업 상태를 변경하지 못했습니다.";
    redirect(`${returnPath}?error=${encodeURIComponent(message)}` as Route);
  }
  revalidatePath("/admin/brand-pilot");
  revalidatePath("/admin/brand-pilot/publishing");
  revalidatePath("/admin/brand-pilot/audit");
  revalidatePath(returnPath);
  const notice = action === "retry" ? "게시 작업을 다시 대기열에 등록했습니다." : "게시 작업을 취소했습니다.";
  redirect(`${returnPath}?notice=${encodeURIComponent(notice)}` as Route);
}
