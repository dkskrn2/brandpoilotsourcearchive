import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMockAiContentGateway } from "../../features/ai-content/mockAiContentGateway";
import type { ContentProposalRecord } from "../../features/ai-content/types";
import { ContentProposalFlow } from "./ContentProposalFlow";

afterEach(cleanup);

const proposals: ContentProposalRecord[] = [1, 2].map((position) => ({
  id: `proposal-${position}`,
  batchId: "batch-1",
  proposal: {
    contractVersion: "content-proposal.v1",
    title: position === 1 ? "여름 피부 3단계 관리" : "흔한 실수 체크리스트",
    reasonToCreateNow: "여름 검색 수요가 늘고 있습니다.",
    contentFamily: "informational",
    topic: "여름 피부 관리",
    target: { label: "민감성 피부 고객" },
    messageStrategy: position === 1 ? "how_to" : "problem_solution",
    hook: "덥고 습할수록 덜어내세요",
    keyMessage: "세 단계면 충분합니다.",
    evidence: [{ sourceSnapshotId: "snapshot-1", summary: "브랜드 관리 가이드" }],
    outline: [{ heading: "문제", purpose: "공감" }, { heading: "해결", purpose: "실행" }],
    outputFormat: "blog",
    channelTargets: ["blog_export"],
    recommendedReferenceQuery: { strategies: ["how_to"], formats: ["blog"], tags: ["여름"] },
  },
  status: "suggested",
  generationId: null,
  createdAt: "2026-07-28T00:00:00.000Z",
}));

function renderFlow() {
  const gateway = createMockAiContentGateway();
  const create = vi.spyOn(gateway, "createProposalBatch").mockResolvedValue({ batchId: "batch-1", status: "queued" });
  const getBatch = vi.spyOn(gateway, "getProposalBatch").mockResolvedValue({
    id: "batch-1", workspaceId: "workspace-1", brandId: "brand-demo", origin: "manual",
    contentFamily: "informational", request: {}, sourceSnapshots: [{ title: "브랜드 가이드" }],
    status: "ready", proposals, errorCode: null, errorMessage: null,
    createdAt: "2026-07-28T00:00:00.000Z", updatedAt: "2026-07-28T00:00:00.000Z",
  });
  const listReferences = vi.spyOn(gateway, "listReferences").mockResolvedValue([
    {
      id: "reference-1", title: "지난 여름 가이드", previewUrl: "https://example.com/preview.jpg",
      source: "owned", format: "blog", primaryCategory: "가이드", subcategory: null,
      appealIds: [], comparableMetric: { label: "조회", value: 1200 },
    },
  ]);
  const selectProposal = vi.spyOn(gateway, "selectProposal");
  const updateGeneration = vi.spyOn(gateway, "updateGeneration");
  const startGeneration = vi.spyOn(gateway, "startGeneration");
  const libraries = {
    listAvatars: vi.fn().mockResolvedValue([
      {
        id: "avatar-1", workspaceId: "workspace-1", brandId: "brand-demo", name: "브랜드 모델",
        description: "대표 모델", isDefault: true, status: "active", createdByUserId: "user-1",
        createdAt: "2026-07-28T00:00:00.000Z", updatedAt: "2026-07-28T00:00:00.000Z",
        images: [{ id: "image-1", position: 0, representative: true, storagePath: "avatar.jpg", storageUrl: "https://example.com/avatar.jpg", mimeType: "image/jpeg", sizeBytes: 1, checksum: "a" }],
      },
    ]),
  };

  render(<MemoryRouter><ContentProposalFlow brandId="brand-demo" gateway={gateway} libraries={libraries} /></MemoryRouter>);
  return { gateway, create, getBatch, listReferences, libraries, selectProposal, updateGeneration, startGeneration };
}

describe("ContentProposalFlow", () => {
  it("completes setup in three accordions and lazy-loads references and avatars after proposal selection", async () => {
    const user = userEvent.setup();
    const { create, listReferences, libraries, selectProposal, updateGeneration, startGeneration } = renderFlow();

    expect(screen.getAllByRole("listitem").slice(0, 4).map((item) => item.textContent)).toEqual([
      "1콘텐츠 생성", "2구현안 선택", "3생성", "4변경·검토·보완",
    ]);
    expect(screen.getByRole("button", { name: "1. 목적" })).toBeVisible();
    expect(screen.getByRole("button", { name: "2. 주제·자료" })).toBeVisible();
    expect(screen.getByRole("button", { name: "3. 채널·형식" })).toBeVisible();
    expect(screen.queryByText("레퍼런스와 아바타")).not.toBeInTheDocument();
    expect(listReferences).not.toHaveBeenCalled();
    expect(libraries.listAvatars).not.toHaveBeenCalled();

    await user.click(screen.getByRole("radio", { name: /^정보성/ }));
    await user.click(screen.getByRole("button", { name: "목적 완료" }));
    await user.type(screen.getByLabelText("브랜드 주제"), "여름 피부 관리");
    await user.click(screen.getByRole("button", { name: "주제·자료 완료" }));
    await user.selectOptions(screen.getByLabelText("출력 형식"), "blog");
    await user.click(screen.getByRole("checkbox", { name: "블로그 내보내기" }));
    await user.click(screen.getByRole("button", { name: "AI 구성안 만들기" }));

    expect(create).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("여름 피부 3단계 관리")).toBeVisible();
    expect(screen.getByText("흔한 실수 체크리스트")).toBeVisible();
    expect(listReferences).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "구현안 선택: 여름 피부 3단계 관리" }));

    expect(await screen.findByRole("heading", { name: "레퍼런스와 아바타" })).toBeVisible();
    expect(screen.getAllByRole("heading", { name: "레퍼런스와 아바타" })).toHaveLength(1);
    await waitFor(() => expect(listReferences).toHaveBeenCalledTimes(1));
    expect(libraries.listAvatars).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("지난 여름 가이드")).toBeVisible();
    expect(screen.getByText("브랜드 모델")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "레퍼런스 선택: 지난 여름 가이드" }));
    await user.click(screen.getByRole("radio", { name: /브랜드 모델/ }));
    await user.click(screen.getByRole("button", { name: "이 구현안으로 생성" }));

    await waitFor(() => expect(selectProposal).toHaveBeenCalledTimes(1));
    expect(updateGeneration).toHaveBeenCalledWith(
      "brand-demo",
      expect.any(String),
      expect.objectContaining({
        referenceIds: ["reference-1"],
        orchestration: expect.objectContaining({
          contractVersion: "content-orchestration.v1",
          references: [{ referenceItemId: "reference-1", roles: ["planning"] }],
          avatar: expect.objectContaining({ mode: "library", id: "avatar-1" }),
        }),
      }),
    );
    expect(startGeneration).toHaveBeenCalledTimes(1);
  });
});
