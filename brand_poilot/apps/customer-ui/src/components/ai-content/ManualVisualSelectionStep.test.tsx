import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ManualVisualSelectionStep } from "./ManualVisualSelectionStep";

describe("ManualVisualSelectionStep", () => {
  it("shows product text without requiring an image and allows explicit style/avatar none", async () => {
    const onStylePresetChange = vi.fn();
    const onAvatarChange = vi.fn();
    const onGenerate = vi.fn();
    render(<ManualVisualSelectionStep
      product={{
        id: "product-1", workspaceId: "w", brandId: "b", kind: "service", displayName: "브랜드 운영",
        status: "active", activeVersionId: "version-1", draft: null,
        activeVersion: {
          id: "version-1", workspaceId: "w", brandId: "b", productServiceId: "product-1",
          sourceAnalysisId: null, version: 1, status: "approved", evidence: [], approvedAt: null, updatedAt: "now",
          profile: { contractVersion: "product-service.v1", name: "브랜드 운영", kind: "service", description: "전략과 제작을 함께 제공합니다.", features: ["전략"], benefits: ["일관성"], cautions: [], audiences: [], appealsByTarget: {}, evergreenPurchaseInfo: "문의", sourceUrls: [] },
        },
      }}
      productImages={[]}
      stylePresets={[{
        id: "preset-1", workspaceId: "w", brandId: "b", name: "에디토리얼", description: "선명한 카드",
        visualTokens: { colors: ["red"], fonts: ["sans"], notes: ["high contrast"] }, referenceItemIds: ["ref-1"],
        isDefault: true, status: "active", revision: 3, createdAt: "now", updatedAt: "now",
      }]}
      avatars={[{
        id: "avatar-1", workspaceId: "w", brandId: "b", revision: 2, name: "브랜드 모델", description: "설명하는 인물",
        isDefault: true, status: "active", createdByUserId: "u", createdAt: "now", updatedAt: "now",
        images: [{ id: "image-1", position: 1, representative: true, storagePath: "avatar.png", storageUrl: "https://blob.example/avatar.png", mimeType: "image/png", sizeBytes: 10, checksum: "a".repeat(64) }],
      }]}
      selectedStylePresetId="preset-1"
      selectedAvatarId="avatar-1"
      userImageInstruction=""
      loading={false}
      loadError={null}
      submitting={false}
      attachmentsReady
      selectedProposalTitle="콘텐츠 방향"
      attachmentCount={0}
      attachmentUploader={<div>첨부 도구</div>}
      onStylePresetChange={onStylePresetChange}
      onAvatarChange={onAvatarChange}
      onUserImageInstructionChange={vi.fn()}
      onRetry={vi.fn()}
      onGenerate={onGenerate}
    />);

    expect(screen.getByText("전략과 제작을 함께 제공합니다.")).toBeVisible();
    expect(screen.getByText("등록된 제품 이미지가 없습니다. 설명 정보는 그대로 사용됩니다.")).toBeVisible();
    await userEvent.click(screen.getByRole("radio", { name: "스타일 사용 안 함" }));
    await userEvent.click(screen.getByRole("radio", { name: "아바타 사용 안 함" }));
    expect(onStylePresetChange).toHaveBeenCalledWith(null);
    expect(onAvatarChange).toHaveBeenCalledWith(null);
    await userEvent.click(screen.getByRole("button", { name: "콘텐츠 생성 시작" }));
    expect(onGenerate).toHaveBeenCalledOnce();
  });

  it("blocks generation after a brand asset load failure", async () => {
    const onGenerate = vi.fn();
    render(<ManualVisualSelectionStep
      product={null} productImages={[]} stylePresets={[]} avatars={[]}
      selectedStylePresetId={null} selectedAvatarId={null} userImageInstruction=""
      loading={false} loadError="브랜드 자료 조회 실패" submitting={false} attachmentsReady
      selectedProposalTitle="콘텐츠 방향" attachmentCount={0}
      attachmentUploader={<button type="button">첨부 도구</button>}
      onStylePresetChange={vi.fn()} onAvatarChange={vi.fn()}
      onUserImageInstructionChange={vi.fn()} onRetry={vi.fn()} onGenerate={onGenerate}
    />);
    const generate = screen.getByRole("button", { name: "콘텐츠 생성 시작" });
    expect(generate).toBeDisabled();
    await userEvent.click(generate);
    expect(onGenerate).not.toHaveBeenCalled();
  });

  it("locks visual choices while generation is being submitted", () => {
    render(<ManualVisualSelectionStep
      product={null} productImages={[]} stylePresets={[]} avatars={[]}
      selectedStylePresetId={null} selectedAvatarId={null} userImageInstruction=""
      loading={false} loadError={null} submitting attachmentsReady
      selectedProposalTitle="콘텐츠 방향" attachmentCount={0}
      attachmentUploader={<button type="button">첨부 도구</button>}
      onStylePresetChange={vi.fn()} onAvatarChange={vi.fn()}
      onUserImageInstructionChange={vi.fn()} onRetry={vi.fn()} onGenerate={vi.fn()}
    />);
    expect(screen.getByRole("radio", { name: "스타일 사용 안 함" })).toBeDisabled();
    expect(screen.getByRole("radio", { name: "아바타 사용 안 함" })).toBeDisabled();
    expect(screen.getByRole("textbox", { name: "이미지 추가 요청 (선택)" })).toBeDisabled();
  });
});
