import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMockAiContentGateway } from "../../features/ai-content/mockAiContentGateway";
import { createChannelCapabilityGateway } from "../../features/channels/channelCapabilityGateway";
import type { ChannelCapability } from "../../types";
import type { ContentProposalRecord } from "../../features/ai-content/types";
import { ApiRequestError } from "../../lib/apiClient";
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

const capabilities: ChannelCapability[] = [
  {
    channel: "instagram",
    catalogStatus: "available",
    connectionStatus: "connected",
    canGenerate: true,
    generationFormats: ["card_news", "single_image"],
    exportModes: ["image"],
    publishModes: ["instagram_feed_carousel", "instagram_feed_single", "instagram_story"],
    readiness: "ready",
    reasonCode: null,
  },
  {
    channel: "threads",
    catalogStatus: "available",
    connectionStatus: "not_connected",
    canGenerate: false,
    generationFormats: ["channel_text"],
    exportModes: ["text"],
    publishModes: [],
    readiness: "needs_connection",
    reasonCode: "not_connected",
  },
];

function renderFlow(options: {
  initialBatchId?: string;
  initialSeedReferenceId?: string;
  batchRequest?: Record<string, unknown>;
  onSeedReferenceInvalid?: () => void;
} = {}) {
  const gateway = createMockAiContentGateway();
  const create = vi.spyOn(gateway, "createProposalBatch").mockResolvedValue({ batchId: "batch-1", status: "queued" });
  const getBatch = vi.spyOn(gateway, "getProposalBatch").mockResolvedValue({
    id: "batch-1", workspaceId: "workspace-1", brandId: "brand-demo", origin: "manual",
    contentFamily: "informational", request: options.batchRequest ?? {}, sourceSnapshots: [{ title: "브랜드 가이드" }],
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
  const uploadAttachment = vi.spyOn(gateway, "uploadAttachment").mockImplementation(async (_brandId, _generationId, attachment) => ({
    ...attachment,
    id: "one-time-receipt-1",
    file: undefined,
    storageUrl: "https://blob.example/one-time.png",
    storagePath: "one-time.png",
    uploadStatus: "confirmed",
  }));
  const libraries = {
    listProductServices: vi.fn().mockResolvedValue([]),
    listWikiItems: vi.fn().mockResolvedValue([]),
    listAvatars: vi.fn().mockResolvedValue([
      {
        id: "avatar-1", workspaceId: "workspace-1", brandId: "brand-demo", name: "브랜드 모델",
        description: "대표 모델", isDefault: true, status: "active", createdByUserId: "user-1",
        createdAt: "2026-07-28T00:00:00.000Z", updatedAt: "2026-07-28T00:00:00.000Z",
        images: [{ id: "image-1", position: 0, representative: true, storagePath: "avatar.jpg", storageUrl: "https://example.com/avatar.jpg", mimeType: "image/jpeg", sizeBytes: 1, checksum: "a" }],
      },
    ]),
  };
  const channelCapabilities = createChannelCapabilityGateway(async () => capabilities);

  render(<MemoryRouter><ContentProposalFlow
    brandId="brand-demo"
    gateway={gateway}
    libraries={libraries}
    channelCapabilities={channelCapabilities}
    initialBatchId={options.initialBatchId}
    initialSeedReferenceId={options.initialSeedReferenceId}
    onSeedReferenceInvalid={options.onSeedReferenceInvalid}
  /></MemoryRouter>);
  return { gateway, create, getBatch, listReferences, libraries, selectProposal, updateGeneration, startGeneration, uploadAttachment };
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
    await user.click(screen.getByRole("checkbox", { name: /블로그 내보내기/ }));
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

  it("hydrates the frozen setup input when a proposal batch is resumed", async () => {
    renderFlow({
      initialBatchId: "batch-1",
      batchRequest: {
        contractVersion: "content-proposal-request.v1",
        contentFamily: "informational",
        subjectInput: {
          mode: "brand_topic",
          topic: "복원된 브랜드 주제",
          wikiItemIds: ["wiki-1"],
        },
        channelTargets: ["blog_export"],
        outputFormats: ["blog"],
        brief: "근거를 간결하게",
      },
    });

    expect(await screen.findByText("복원된 브랜드 주제")).toBeVisible();
    expect(screen.getByText("blog")).toBeVisible();
    expect(screen.getByText("blog_export")).toBeVisible();
    expect(screen.getByText("여름 피부 3단계 관리")).toBeVisible();
  });

  it("validates a seed reference in the active brand result and selects it only after proposal selection", async () => {
    const user = userEvent.setup();
    const { listReferences } = renderFlow({ initialBatchId: "batch-1", initialSeedReferenceId: "reference-1" });

    expect(await screen.findByText("여름 피부 3단계 관리")).toBeVisible();
    expect(listReferences).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "구현안 선택: 여름 피부 3단계 관리" }));

    expect(await screen.findByRole("button", { name: "선택 해제: 지난 여름 가이드" })).toBePressed();
    expect(screen.getByText("선택 1 / 5")).toBeVisible();
  });

  it("removes an unavailable seed reference without blocking proposal selection", async () => {
    const user = userEvent.setup();
    const onSeedReferenceInvalid = vi.fn();
    renderFlow({ initialBatchId: "batch-1", initialSeedReferenceId: "missing-reference", onSeedReferenceInvalid });

    await user.click(await screen.findByRole("button", { name: "구현안 선택: 여름 피부 3단계 관리" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("활성 레퍼런스가 아니어서");
    expect(screen.getByText("선택 0 / 5")).toBeVisible();
    expect(onSeedReferenceInvalid).toHaveBeenCalledTimes(1);
  });

  it("enables channel choices from the real capability response for the selected format", async () => {
    const user = userEvent.setup();
    renderFlow();

    await user.click(screen.getByRole("radio", { name: /^정보성/ }));
    await user.click(screen.getByRole("button", { name: "목적 완료" }));
    await user.type(screen.getByLabelText("브랜드 주제"), "여름 피부 관리");
    await user.click(screen.getByRole("button", { name: "주제·자료 완료" }));
    await user.selectOptions(screen.getByLabelText("출력 형식"), "single_image");

    expect(await screen.findByRole("checkbox", { name: /Instagram/ })).toBeEnabled();
    expect(screen.getByRole("checkbox", { name: /Threads/ })).toBeDisabled();
    await user.selectOptions(screen.getByLabelText("출력 형식"), "channel_text");
    expect(screen.getByText(/먼저 채널을 연결/)).toBeVisible();
  });

  it("blocks generation when a selected reference was archived after it was loaded", async () => {
    const user = userEvent.setup();
    const { listReferences, selectProposal } = renderFlow({ initialBatchId: "batch-1" });

    await user.click(await screen.findByRole("button", { name: "구현안 선택: 여름 피부 3단계 관리" }));
    await user.click(await screen.findByRole("button", { name: "레퍼런스 선택: 지난 여름 가이드" }));
    listReferences.mockResolvedValueOnce([]);
    await user.click(screen.getByRole("button", { name: "이 구현안으로 생성" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("보관되었거나 찾을 수 없습니다");
    expect(selectProposal).not.toHaveBeenCalled();
  });

  it("passes the selected proposal recommendation to the tenant-scoped reference query", async () => {
    const user = userEvent.setup();
    const { listReferences } = renderFlow({ initialBatchId: "batch-1" });

    await user.click(await screen.findByRole("button", { name: "구현안 선택: 여름 피부 3단계 관리" }));

    await waitFor(() => expect(listReferences).toHaveBeenCalledWith("brand-demo", {
      strategies: ["how_to"],
      formats: ["blog"],
      tags: ["여름"],
    }));
  });

  it("uploads a one-time avatar into the selected generation and starts with its receipt snapshot", async () => {
    const user = userEvent.setup();
    const { uploadAttachment, updateGeneration, startGeneration } = renderFlow({ initialBatchId: "batch-1" });

    await user.click(await screen.findByRole("button", { name: "구현안 선택: 여름 피부 3단계 관리" }));
    await user.upload(
      await screen.findByLabelText("이번 생성에만 사용할 아바타"),
      new File(["person"], "campaign-person.png", { type: "image/png" }),
    );
    await user.click(screen.getByRole("button", { name: "이 구현안으로 생성" }));

    await waitFor(() => expect(uploadAttachment).toHaveBeenCalledWith(
      "brand-demo",
      expect.any(String),
      expect.objectContaining({ role: "person", fileName: "campaign-person.png" }),
    ));
    expect(updateGeneration).toHaveBeenCalledWith(
      "brand-demo",
      expect.any(String),
      expect.objectContaining({
        orchestration: expect.objectContaining({
          avatar: {
            mode: "one_time",
            id: "one-time-receipt-1",
            snapshot: expect.objectContaining({
              fileName: "campaign-person.png",
              storageUrl: "https://blob.example/one-time.png",
            }),
          },
        }),
      }),
    );
    expect(startGeneration).toHaveBeenCalledWith(
      "brand-demo",
      expect.any(String),
      expect.objectContaining({
        orchestration: expect.objectContaining({
          avatar: expect.objectContaining({ mode: "one_time", id: "one-time-receipt-1" }),
        }),
      }),
    );
  });

  it("maps the generation quota code to Korean and preserves the selected proposal", async () => {
    const user = userEvent.setup();
    const { startGeneration } = renderFlow({ initialBatchId: "batch-1" });
    startGeneration.mockRejectedValueOnce(
      new ApiRequestError({ status: 429, errorCode: "ai_content_limit_reached" }),
    );

    await user.click(await screen.findByRole("button", { name: "구현안 선택: 여름 피부 3단계 관리" }));
    await user.click(await screen.findByRole("button", { name: "이 구현안으로 생성" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("오늘 AI 콘텐츠 생성 10회를 모두 사용했습니다");
    expect(screen.getByText("여름 피부 3단계 관리")).toBeVisible();
    expect(screen.getByRole("heading", { name: "레퍼런스와 아바타" })).toBeVisible();
  });
});
