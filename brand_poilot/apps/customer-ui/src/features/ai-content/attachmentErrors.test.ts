import { describe, expect, it } from "vitest";
import { ApiRequestError } from "../../lib/apiClient";
import { attachmentErrorGuidance, attachmentLifecycleGuidance } from "./attachmentErrors";

describe("attachmentErrorGuidance", () => {
  it.each([
    ["ai_content_attachment_limit_exceeded", "첨부 파일은 최대 5개입니다."],
    ["ai_content_upload_session_expired", "업로드 시간이 만료되었습니다. 파일을 다시 선택해 주세요."],
    ["ai_content_attachments_locked", "첨부가 잠겼습니다. 새 콘텐츠 생성을 시작해 주세요."],
    ["ai_content_attachment_storage_unavailable", "저장소 연결이 원활하지 않습니다. 현재 파일은 유지됩니다. 다시 시도해 주세요."],
    ["ai_content_attachment_upload_in_progress", "첨부 파일 업로드를 완료하거나 실패한 파일을 다시 시도해 주세요."],
  ])("maps %s to focused guidance", (errorCode, guidance) => {
    expect(attachmentErrorGuidance(new ApiRequestError({ status: 409, errorCode }), "product.png")).toBe(guidance);
  });

  it("keeps the unrelated fallback scoped to the affected file", () => {
    expect(attachmentErrorGuidance(new Error("network_failed"), "product.png"))
      .toBe("product.png 파일을 업로드하지 못했습니다. 현재 파일은 유지됩니다. 다시 시도해 주세요.");
  });

  it("does not misclassify an unrelated error as a lifecycle error", () => {
    expect(attachmentLifecycleGuidance(new Error("network_failed"))).toBeNull();
  });
});
