import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { VisualPresetPanel } from "./VisualPresetPanel";

describe("VisualPresetPanel", () => {
  it("saves an analyzing style combination but prevents making it default", async () => {
    const user = userEvent.setup();
    const style = {
      id: "style-1", workspaceId: "workspace-1", brandId: "brand-1", name: "비교 카드",
      revision: 1, analysisStatus: "processing" as const, analysisContractVersion: null,
      analysis: null, analysisSha256: null, analysisErrorCode: null, referenceItemIds: ["reference-1"],
      createdAt: "now", updatedAt: "now",
    };
    const analyzingPreset = {
      id: "preset-1", workspaceId: "workspace-1", brandId: "brand-1", name: "비교형",
      designStyleId: "style-1", avatarId: null, revision: 1, isDefault: false,
      usability: { usable: false as const, reason: "style_analyzing" as const },
      createdAt: "now", updatedAt: "now",
    };
    const gateway = {
      listDesignStyles: vi.fn(async () => [style]), listAvatars: vi.fn(async () => []),
      listVisualPresets: vi.fn(async () => [analyzingPreset]),
      createVisualPreset: vi.fn(async () => analyzingPreset), updateVisualPreset: vi.fn(),
      setDefaultVisualPreset: vi.fn(),
    };
    render(<VisualPresetPanel brandId="brand-1" gateway={gateway as never} />);

    expect(await screen.findByText("스타일 분석 중")).toBeVisible();
    expect(screen.getByRole("button", { name: "기본으로 설정" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "새 프리셋" }));
    await user.type(screen.getByLabelText("프리셋 이름"), "분석 중 저장");
    await user.selectOptions(screen.getByLabelText("디자인 스타일 선택"), "style-1");
    await user.click(screen.getByRole("button", { name: "프리셋 저장" }));

    await waitFor(() => expect(gateway.createVisualPreset).toHaveBeenCalledWith("brand-1", {
      contractVersion: "visual-preset-input.v1", name: "분석 중 저장", designStyleId: "style-1",
      avatarId: null, isDefault: false,
    }));
    expect(gateway.setDefaultVisualPreset).not.toHaveBeenCalled();
  });
});
