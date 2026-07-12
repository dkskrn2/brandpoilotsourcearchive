"use client";

import { useFormStatus } from "react-dom";

export function AdminPendingSubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();

  return (
    <button className="admin-save-button" type="submit" disabled={pending} aria-busy={pending}>
      {pending ? "저장 중…" : label}
    </button>
  );
}
