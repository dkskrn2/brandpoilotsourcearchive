import { ApiRequestError } from "../../lib/apiClient";
import type { AttachmentLifecycleAction } from "./types";

export interface AttachmentLifecycleGuidance {
  message: string;
  action: AttachmentLifecycleAction;
  retryable: boolean;
}

const guidanceByCode: Record<string, AttachmentLifecycleGuidance> = {
  ai_content_attachment_limit_exceeded: {
    message: "첨부 파일은 최대 5개입니다.",
    action: "none",
    retryable: false,
  },
  ai_content_upload_session_expired: {
    message: "업로드 시간이 만료되었습니다. 파일을 다시 선택해 주세요.",
    action: "reselect",
    retryable: false,
  },
  ai_content_attachments_locked: {
    message: "첨부가 잠겼습니다. 새 콘텐츠 생성을 시작해 주세요.",
    action: "new_generation",
    retryable: false,
  },
  ai_content_attachment_storage_unavailable: {
    message: "저장소 연결이 원활하지 않습니다. 현재 파일은 유지됩니다. 다시 시도해 주세요.",
    action: "retry",
    retryable: true,
  },
  ai_content_attachment_upload_in_progress: {
    message: "첨부 파일 업로드를 완료하거나 실패한 파일을 다시 시도해 주세요.",
    action: "retry",
    retryable: true,
  },
};

export function attachmentLifecycleGuidance(error: unknown) {
  if (error instanceof ApiRequestError && error.errorCode) {
    const guidance = guidanceByCode[error.errorCode];
    if (guidance) return guidance;
  }
  return null;
}

export function attachmentErrorGuidance(error: unknown, fileName?: string) {
  const lifecycleGuidance = attachmentLifecycleGuidance(error);
  if (lifecycleGuidance) return lifecycleGuidance.message;
  return fileName
    ? `${fileName} 파일을 업로드하지 못했습니다. 현재 파일은 유지됩니다. 다시 시도해 주세요.`
    : "첨부 파일 작업을 완료하지 못했습니다. 현재 입력은 유지됩니다. 다시 시도해 주세요.";
}
