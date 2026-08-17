import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BrandStylePresetPanel } from "./BrandStylePresetPanel";

afterEach(cleanup);

describe("BrandStylePresetPanel", () => {
  it("creates a named default preset from approved uploaded image references", async () => {
    const created = {
      id: "preset-1", workspaceId: "workspace-1", brandId: "brand-1", revision: 1,
      name: "에디토리얼", description: "선명한 숫자 중심",
      visualTokens: { colors: ["red", "white"], fonts: ["sans"], notes: ["high contrast"] },
      referenceItemIds: ["reference-1"], isDefault: true, status: "active",
      createdAt: "2026-08-14T00:00:00.000Z", updatedAt: "2026-08-14T00:00:00.000Z",
    };
    const gateway = {
      listStylePresets: vi.fn().mockResolvedValue([]),
      listReferenceItems: vi.fn().mockResolvedValue([{
        id: "reference-1", kind: "upload", title: "red-card.png", previewUrl: "https://example.com/red.png",
        format: "image/png", archivedAt: null,
      }]),
      createStylePreset: vi.fn().mockResolvedValue(created),
      updateStylePreset: vi.fn(), setDefaultStylePreset: vi.fn(), archiveStylePreset: vi.fn(),
    };
    const user = userEvent.setup();
    render(<BrandStylePresetPanel brandId="brand-1" gateway={gateway as never} />);

    expect(await screen.findByLabelText("스타일 설명")).toHaveAttribute("maxlength", "1000");
    await user.type(await screen.findByLabelText("스타일 이름"), "에디토리얼");
    await user.type(screen.getByLabelText("스타일 설명"), "선명한 숫자 중심");
    await user.type(screen.getByLabelText("대표 색상"), "red, white");
    await user.type(screen.getByLabelText("폰트 방향"), "sans");
    await user.type(screen.getByLabelText("레이아웃 메모"), "high contrast");
    await user.click(screen.getByRole("checkbox", { name: "red-card.png" }));
    await user.click(screen.getByRole("checkbox", { name: "기본 스타일로 사용" }));
    await user.click(screen.getByRole("button", { name: "스타일 저장" }));

    await waitFor(() => expect(gateway.createStylePreset).toHaveBeenCalledWith("brand-1", {
      contractVersion: "brand-style-preset.v1",
      name: "에디토리얼",
      description: "선명한 숫자 중심",
      visualTokens: { colors: ["red", "white"], fonts: ["sans"], notes: ["high contrast"] },
      referenceItemIds: ["reference-1"],
      isDefault: true,
    }));
    expect(await screen.findByText("저장했습니다.")).toBeVisible();
  });
});
