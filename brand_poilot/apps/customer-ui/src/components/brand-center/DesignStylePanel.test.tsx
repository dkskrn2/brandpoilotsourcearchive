import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DesignStylePanel } from "./DesignStylePanel";

describe("DesignStylePanel", () => {
  it("accepts only a name and one to five images, then queues analysis", async () => {
    const user = userEvent.setup();
    const saved = {
      id: "style-1", workspaceId: "workspace-1", brandId: "brand-1", name: "비교 카드",
      revision: 1, analysisStatus: "queued" as const, analysisContractVersion: null,
      analysis: null, analysisSha256: null, analysisErrorCode: null, referenceItemIds: ["reference-1"],
      createdAt: "2026-08-27T00:00:00.000Z", updatedAt: "2026-08-27T00:00:00.000Z",
    };
    const gateway = {
      listDesignStyles: vi.fn(async () => []),
      uploadReferenceFile: vi.fn(async () => ({ reference: { id: "reference-1" } })),
      createDesignStyle: vi.fn(async () => saved),
      updateDesignStyle: vi.fn(), retryDesignStyle: vi.fn(),
    };
    render(<DesignStylePanel brandId="brand-1" gateway={gateway as never} />);

    await waitFor(() => expect(gateway.listDesignStyles).toHaveBeenCalledWith("brand-1"));
    expect(screen.queryByLabelText("대표 색상")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("폰트 방향")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("레이아웃 메모")).not.toBeInTheDocument();
    await user.type(screen.getByLabelText("스타일 이름"), "비교 카드");
    const file = new File(["image"], "comparison.png", { type: "image/png" });
    await user.upload(screen.getByLabelText("참고 이미지"), file);
    await user.click(screen.getByRole("button", { name: "스타일 저장" }));

    await waitFor(() => expect(gateway.createDesignStyle).toHaveBeenCalledWith("brand-1", {
      contractVersion: "design-style-input.v1", name: "비교 카드", referenceItemIds: ["reference-1"],
    }));
    expect(await screen.findByText(/분석 대기 중/)).toBeVisible();
  });
});
