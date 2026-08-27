import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { VisualPresetPanel } from "./VisualPresetPanel";

describe("VisualPresetPanel", () => {
  it("reloads styles and avatars when the shared library revision changes", async () => {
    const firstStyle = {
      id: "style-1", workspaceId: "workspace-1", brandId: "brand-1", name: "첫 스타일",
      revision: 1, analysisStatus: "ready" as const, analysisContractVersion: "design-style-analysis.v1",
      analysis: null, analysisSha256: "a".repeat(64), analysisErrorCode: null,
      referenceItemIds: ["reference-1"], createdAt: "now", updatedAt: "now",
    };
    const secondStyle = { ...firstStyle, id: "style-2", name: "새 스타일" };
    const gateway = {
      listDesignStyles: vi.fn()
        .mockResolvedValueOnce([firstStyle])
        .mockResolvedValueOnce([firstStyle, secondStyle]),
      listAvatars: vi.fn(async () => []), listVisualPresets: vi.fn(async () => []),
      createVisualPreset: vi.fn(), updateVisualPreset: vi.fn(), setDefaultVisualPreset: vi.fn(),
    };
    const view = render(<VisualPresetPanel brandId="brand-1" gateway={gateway as never} libraryRevision={0} />);
    expect(await screen.findByRole("option", { name: "첫 스타일 · 사용 가능" })).toBeVisible();

    view.rerender(<VisualPresetPanel brandId="brand-1" gateway={gateway as never} libraryRevision={1} />);

    expect(await screen.findByRole("option", { name: "새 스타일 · 사용 가능" })).toBeVisible();
    expect(gateway.listDesignStyles).toHaveBeenCalledTimes(2);
    expect(gateway.listAvatars).toHaveBeenCalledTimes(2);
  });

  it("labels a failed design style as failed instead of still analyzing", async () => {
    const failedStyle = {
      id: "style-failed", workspaceId: "workspace-1", brandId: "brand-1", name: "실패한 스타일",
      revision: 1, analysisStatus: "failed" as const, analysisContractVersion: null,
      analysis: null, analysisSha256: null, analysisErrorCode: "design_style_analysis_model_failed",
      referenceItemIds: ["reference-1"], createdAt: "now", updatedAt: "now",
    };
    const gateway = {
      listDesignStyles: vi.fn(async () => [failedStyle]), listAvatars: vi.fn(async () => []),
      listVisualPresets: vi.fn(async () => []), createVisualPreset: vi.fn(), updateVisualPreset: vi.fn(),
      setDefaultVisualPreset: vi.fn(),
    };

    render(<VisualPresetPanel brandId="brand-1" gateway={gateway as never} />);

    expect(await screen.findByRole("option", { name: "실패한 스타일 · 분석 실패" })).toBeVisible();
  });

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
