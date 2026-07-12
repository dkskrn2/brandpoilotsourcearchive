"use client";

import { useFormStatus } from "react-dom";
import { useAdminImageUpload } from "@/components/admin-image-upload";

export function AdminPendingSubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  const { isUploading } = useAdminImageUpload();
  const disabled = pending || isUploading;

  return (
    <button className="admin-save-button" type="submit" disabled={disabled} aria-busy={disabled}>
      {pending ? "저장 중…" : isUploading ? "이미지 업로드 중…" : label}
    </button>
  );
}
