import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ManualVisualSelectionStep } from "./ManualVisualSelectionStep";

const base = {
  product: null,
  productImages: [],
  visualPresets: [],
  selectedPresetId: null,
  userImageInstruction: "",
  loading: false,
  loadError: null,
  submitting: false,
  attachmentsReady: true,
  selectedProposalTitle: "콘텐츠 방향",
  attachmentCount: 0,
  attachmentUploader: <div>첨부 도구</div>,
  onPresetChange: vi.fn(),
  onUserImageInstructionChange: vi.fn(),
  onRetry: vi.fn(),
  onGenerate: vi.fn(),
};

describe("ManualVisualSelectionStep", () => {
  it("shows one combined preset choice and disables unusable presets", async () => {
    const onPresetChange = vi.fn();
    render(<ManualVisualSelectionStep {...base} onPresetChange={onPresetChange} visualPresets={[
      { id: "ready", workspaceId: "w", brandId: "b", name: "사용 가능", designStyleId: "s1", avatarId: null, revision: 2, isDefault: true, usability: { usable: true, reason: null }, createdAt: "now", updatedAt: "now" },
      { id: "queued", workspaceId: "w", brandId: "b", name: "분석 중", designStyleId: "s2", avatarId: null, revision: 1, isDefault: false, usability: { usable: false, reason: "style_analyzing" }, createdAt: "now", updatedAt: "now" },
    ]} selectedPresetId="ready" />);
    expect(screen.getByRole("radio", { name: /분석 중/ })).toBeDisabled();
    await userEvent.click(screen.getByRole("radio", { name: "프리셋 사용 안 함" }));
    expect(onPresetChange).toHaveBeenCalledWith(null);
    expect(screen.queryByRole("group", { name: "아바타" })).not.toBeInTheDocument();
  });

  it("blocks generation while assets failed to load", () => {
    render(<ManualVisualSelectionStep {...base} loadError="조회 실패" />);
    expect(screen.getByRole("button", { name: "콘텐츠 생성 시작" })).toBeDisabled();
  });
});
