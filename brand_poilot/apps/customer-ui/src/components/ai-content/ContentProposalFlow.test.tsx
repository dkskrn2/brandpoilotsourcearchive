import "@testing-library/jest-dom/vitest";
import { StrictMode } from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMockAiContentGateway } from "../../features/ai-content/mockAiContentGateway";
import { createChannelCapabilityGateway } from "../../features/channels/channelCapabilityGateway";
import type { ChannelCapability } from "../../types";
import type { ContentProposalRecord } from "../../features/ai-content/types";
import type { ProductServiceItem } from "../../features/libraries/libraryGateway";
import { ApiRequestError } from "../../lib/apiClient";
import type { ContentSuggestionList } from "../../features/content-suggestions/contentSuggestionGateway";
import { ContentProposalFlow } from "./ContentProposalFlow";

afterEach(cleanup);

const proposals = [1, 2, 3].map((position) => ({
  id: `proposal-${position}`,
  batchId: "batch-1",
  proposal: {
    conceptKey: `concept-${position}`,
    title: position === 1 ? "여름 피부 3단계 관리" : position === 2 ? "흔한 실수 체크리스트" : "고객 질문 Q&A",
    informationalType: position === 1 ? "how_to" : "checklist",
    oneLineIntent: "실행 순서를 명확히 안내합니다.",
    differentiator: `상황별 차별점 ${position}`,
    differentiationAxes: [position === 1 ? "situation" : "question"],
    target: "민감성 피부 고객",
    customerContext: `계절 변화 상황 ${position}`,
    hook: "덥고 습할수록 덜어내세요",
    keyMessage: "세 단계면 충분합니다.",
    selectionReason: "바로 적용할 수 있습니다.",
    evidenceIds: [],
    referenceIds: [],
    outline: [{ index: 1, role: "article", headline: "문제", purpose: "공감" }, { index: 2, role: "guide", headline: "해결", purpose: "실행" }],
    outputFormat: "blog",
    channelTargets: ["blog_export"],
    assetCount: null,
    purposeDetails: {
      kind: "informational",
      question: "무엇부터 바꿔야 하나요?",
      value: "실행 순서",
      whyNow: "계절 변화",
      learningPoints: ["세안", "보습"],
    },
  },
  status: "suggested",
  generationId: null,
  createdAt: "2026-07-28T00:00:00.000Z",
})) as unknown as ContentProposalRecord[];

const capabilities: ChannelCapability[] = [
  {
    channel: "instagram",
    catalogStatus: "available",
    enabled: true,
    connectionStatus: "connected",
    canGenerate: true,
    generationFormats: ["card_news", "reel"],
    exportModes: ["image"],
    publishModes: ["instagram_feed_carousel", "instagram_feed_single", "instagram_story"],
    readiness: "ready",
    reasonCode: null,
  },
  {
    channel: "threads",
    catalogStatus: "available",
    enabled: true,
    connectionStatus: "not_connected",
    canGenerate: false,
    generationFormats: ["channel_text"],
    exportModes: ["text"],
    publishModes: [],
    readiness: "needs_connection",
    reasonCode: "not_connected",
  },
];

const approvedProduct: ProductServiceItem = {
  id: "product-1",
  workspaceId: "workspace-1",
  brandId: "brand-demo",
  kind: "product",
  displayName: "승인 세럼",
  status: "active",
  activeVersionId: "product-version-1",
  activeVersion: {
    id: "product-version-1",
    workspaceId: "workspace-1",
    brandId: "brand-demo",
    productServiceId: "product-1",
    sourceAnalysisId: null,
    version: 1,
    status: "approved",
    profile: {
      contractVersion: "product-service.v1",
      name: "승인 세럼",
      kind: "product",
      description: "민감 피부용",
      features: [], benefits: [], cautions: [], audiences: [], appealsByTarget: {},
      evergreenPurchaseInfo: "", sourceUrls: [],
    },
    evidence: [],
    approvedAt: "2026-07-28T00:00:00.000Z",
    updatedAt: "2026-07-28T00:00:00.000Z",
  },
  draft: null,
};

function renderFlow(options: {
  brandId?: string;
  initialBatchId?: string;
  initialSeedReferenceId?: string;
  batchRequest?: Record<string, unknown>;
  onSeedReferenceInvalid?: () => void;
  productResponses?: ProductServiceItem[][];
  productLoader?: (brandId: string) => Promise<ProductServiceItem[]>;
  stylePresetLoader?: (brandId: string) => Promise<unknown[]>;
  strictMode?: boolean;
  abortFirstBatchLoad?: boolean;
  suggestionList?: ContentSuggestionList;
  initialSuggestionId?: string;
  initialSuggestionView?: boolean;
} = {}) {
  const gateway = createMockAiContentGateway();
  const create = vi.spyOn(gateway, "createProposalBatch").mockResolvedValue({ batchId: "batch-1", status: "queued" });
  const readyBatch: Awaited<ReturnType<typeof gateway.getProposalBatch>> = {
    id: "batch-1", workspaceId: "workspace-1", brandId: "brand-demo", origin: "manual",
    contentFamily: "informational", request: options.batchRequest ?? {}, sourceSnapshots: [{ title: "브랜드 가이드" }],
    status: "ready", proposals, errorCode: null, errorMessage: null,
    createdAt: "2026-07-28T00:00:00.000Z", updatedAt: "2026-07-28T00:00:00.000Z",
  };
  let batchLoadCount = 0;
  const getBatch = vi.spyOn(gateway, "getProposalBatch").mockImplementation((_brandId, _batchId, signal) => {
    batchLoadCount += 1;
    if (options.abortFirstBatchLoad && batchLoadCount === 1) {
      return new Promise((_resolve, reject) => {
        signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
      });
    }
    return Promise.resolve(readyBatch);
  });
  const listReferences = vi.spyOn(gateway, "listReferences").mockResolvedValue([
    {
      id: "reference-1", title: "지난 여름 가이드", previewUrl: "https://example.com/preview.jpg",
      source: "owned", format: "blog", primaryCategory: "가이드", subcategory: null,
      appealIds: [], comparableMetric: { label: "조회", value: 1200 },
    },
  ]);
  const listReferenceSeeds = vi.spyOn(gateway, "listReferenceSeeds").mockResolvedValue([{
    id: "11111111-1111-4111-8111-111111111111",
    source: "brand_output",
    title: "지난 여름 가이드",
    url: "https://example.com/reference",
    previewUrl: "https://example.com/preview.jpg",
    format: "card_news",
    primaryCategory: "뷰티",
    metrics: { exposureCount: 1200, likeCount: 80, commentsCount: 5 },
    checkedAt: "2026-07-28T00:00:00.000Z",
  }]);
  const selectProposal = vi.spyOn(gateway, "selectProposal");
  const updateManualVisualSelection = vi.fn(async () => ({} as never));
  const updateFinalizationDraft = vi.fn(async () => ({} as never));
  const startGenerationV2 = vi.fn(async () => ({} as never));
  Object.assign(gateway, { updateManualVisualSelection, updateFinalizationDraft, startGenerationV2 });
  const uploadAttachment = vi.spyOn(gateway, "uploadAttachment").mockImplementation(async (_brandId, _generationId, attachment) => ({
    ...attachment,
    id: "one-time-receipt-1",
    file: undefined,
    storageUrl: "https://blob.example/one-time.png",
    storagePath: "one-time.png",
    uploadStatus: "confirmed",
  }));
  let productRequest = 0;
  const libraries = {
    listProductServices: vi.fn().mockImplementation(async (brandId: string) => {
      if (options.productLoader) return options.productLoader(brandId);
      const responses = options.productResponses ?? [[]];
      return responses[Math.min(productRequest++, responses.length - 1)];
    }),
    listWikiItems: vi.fn().mockResolvedValue([]),
    listAvatars: vi.fn().mockResolvedValue([
      {
        id: "avatar-1", workspaceId: "workspace-1", brandId: "brand-demo", name: "브랜드 모델",
        revision: 1,
        description: "대표 모델", isDefault: true, status: "active", createdByUserId: "user-1",
        createdAt: "2026-07-28T00:00:00.000Z", updatedAt: "2026-07-28T00:00:00.000Z",
        images: [{ id: "image-1", position: 0, representative: true, storagePath: "avatar.jpg", storageUrl: "https://example.com/avatar.jpg", mimeType: "image/jpeg", sizeBytes: 1, checksum: "a" }],
      },
    ]),
  };
  const defaultStylePreset = {
    id: "style-preset-1",
    workspaceId: "workspace-1",
    brandId: "brand-demo",
    revision: 1,
    name: "차분한 스타일",
    description: "정돈된 편집 디자인",
    visualTokens: { colors: ["#143D2C"], fonts: ["Pretendard"], notes: ["차분한 여백 중심"] },
    referenceItemIds: ["style-1"],
    isDefault: true,
    status: "active",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  } as const;
  const listStylePresets = vi.fn().mockImplementation((requestedBrandId: string) =>
    options.stylePresetLoader ? options.stylePresetLoader(requestedBrandId) : Promise.resolve([defaultStylePreset]));
  const listAvatars = vi.fn().mockImplementation(libraries.listAvatars);
  const listProductImages = vi.fn().mockResolvedValue([]);
  const channelCapabilities = createChannelCapabilityGateway(async () => capabilities);
  const referenceTrendGateway = {
    searchInstagramTrends: vi.fn(),
    saveInstagramTrendSource: vi.fn(),
  };
  const suggestionList: ContentSuggestionList = options.suggestionList ?? {
    category: null,
    personal: [],
    general: [],
  };
  const suggestionGateway = {
    list: vi.fn().mockResolvedValue(suggestionList),
    listForSelection: vi.fn().mockResolvedValue(suggestionList),
    get: vi.fn().mockImplementation(async (_brandId: string, suggestionId: string) => {
      const item = [...suggestionList.personal, ...suggestionList.general].find((candidate) => candidate.id === suggestionId);
      if (!item) throw new Error("content_suggestion_not_found");
      return item;
    }),
  };

  const flow = (brandId: string) => <MemoryRouter><ContentProposalFlow
    brandId={brandId}
    gateway={gateway}
    libraries={libraries}
    channelCapabilities={channelCapabilities}
    initialBatchId={options.initialBatchId}
    initialSeedReferenceId={options.initialSeedReferenceId}
    initialSuggestionId={options.initialSuggestionId}
    initialSuggestionView={options.initialSuggestionView}
    suggestionGateway={suggestionGateway}
    onSeedReferenceInvalid={options.onSeedReferenceInvalid}
    referenceTrendGateway={referenceTrendGateway}
    {...({ assetGateway: { listStylePresets, listAvatars, listProductImages } } as object)}
  /></MemoryRouter>;
  const view = (brandId: string) => options.strictMode
    ? <StrictMode>{flow(brandId)}</StrictMode>
    : flow(brandId);
  const rendered = render(view(options.brandId ?? "brand-demo"));
  return {
    gateway, create, getBatch, listReferences, listReferenceSeeds, libraries,
    selectProposal, uploadAttachment,
    updateManualVisualSelection, updateFinalizationDraft, startGenerationV2,
    listStylePresets, listAvatars, listProductImages, suggestionGateway,
    rerenderBrand: (brandId: string) => rendered.rerender(view(brandId)),
  };
}

describe("ContentProposalFlow", () => {
  it("turns a selected daily suggestion into an informational V3 proposal request", async () => {
    const user = userEvent.setup();
    const suggestionList: ContentSuggestionList = {
      category: { code: "beauty", name: "뷰티" },
      personal: [{
        id: "suggestion-1",
        subcategoryCode: "skin-care",
        subcategoryName: "스킨케어",
        intent: "trend",
        title: "장벽 케어 루틴의 변화",
        whyNow: "환절기 관심이 늘고 있습니다.",
        contentBrief: "브랜드 코어를 반영해 세 단계로 설명합니다.",
      }],
      general: [],
    };
    const { create, suggestionGateway } = renderFlow({ suggestionList });

    await user.click(screen.getByRole("radio", { name: /^마케팅성/ }));
    await user.click(screen.getByRole("button", { name: "목적 완료" }));
    await user.click(screen.getByRole("button", { name: "오늘의 주제" }));
    expect(await screen.findByText("장벽 케어 루틴의 변화")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "AI 콘텐츠로 만들기" }));

    expect(screen.queryByRole("combobox", { name: "제품·서비스" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("콘텐츠 지시 (선택)")).toHaveValue("브랜드 코어를 반영해 세 단계로 설명합니다.");
    await user.click(screen.getByRole("button", { name: "주제·자료 완료" }));
    await user.click(await screen.findByRole("button", { name: "Instagram" }));
    await user.click(screen.getByRole("button", { name: "AI 구성안 만들기" }));

    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create.mock.calls[0]?.[1].request).toMatchObject({
      purpose: "informational",
      seed: { kind: "topic_text", title: "장벽 케어 루틴의 변화" },
      contentInstruction: "브랜드 코어를 반영해 세 단계로 설명합니다.",
    });
    expect(suggestionGateway.list).toHaveBeenCalledWith("brand-demo", expect.any(AbortSignal));
  });

  it("keeps the suggestion list and clears a stale deep-link selection", async () => {
    const user = userEvent.setup();
    const suggestionList: ContentSuggestionList = {
      category: { code: "beauty", name: "뷰티" },
      personal: [{
        id: "suggestion-valid",
        subcategoryCode: "skin-care",
        subcategoryName: "스킨케어",
        intent: "informational",
        title: "지금 선택할 수 있는 추천",
        whyNow: "현재 유효한 추천입니다.",
        contentBrief: "세 단계로 설명합니다.",
      }],
      general: [],
    };
    const { suggestionGateway } = renderFlow({
      suggestionList,
      initialSuggestionId: "suggestion-stale",
      initialSuggestionView: true,
    });

    await user.click(screen.getByRole("radio", { name: /^정보성/ }));
    await user.click(screen.getByRole("button", { name: "목적 완료" }));

    expect(await screen.findByText("지금 선택할 수 있는 추천")).toBeVisible();
    expect(screen.getByRole("alert")).toHaveTextContent("선택한 오늘의 주제를 찾지 못했습니다");
    expect(screen.getByRole("button", { name: "주제·자료 완료" })).toBeDisabled();
    expect(suggestionGateway.get).toHaveBeenCalledWith(
      "brand-demo",
      "suggestion-stale",
      expect.any(AbortSignal),
    );
  });

  it("clears a selected marketing product when a refreshed list no longer approves it", async () => {
    const user = userEvent.setup();
    renderFlow({
      productResponses: [[approvedProduct], [{ ...approvedProduct, status: "archived" }]],
    });

    await user.click(screen.getByRole("radio", { name: /^마케팅성/ }));
    await user.click(screen.getByRole("button", { name: "목적 완료" }));
    await user.type(screen.getByLabelText("콘텐츠 주제"), "여름 피부 관리");
    await user.selectOptions(await screen.findByRole("combobox", { name: "제품·서비스" }), approvedProduct.id);
    await user.click(screen.getByRole("button", { name: "주제·자료 완료" }));
    await user.click(screen.getByRole("button", { name: /2\. 주제·자료/ }));

    await waitFor(() => expect(screen.queryByRole("option", { name: "승인 세럼" })).not.toBeInTheDocument());
    expect(screen.getByRole("combobox", { name: "제품·서비스" })).toHaveValue("");
    expect(screen.getByRole("button", { name: "주제·자료 완료" })).toBeDisabled();
  });

  it("does not create a marketing proposal when the selected product becomes ineligible", async () => {
    const user = userEvent.setup();
    const mutableProduct = { ...approvedProduct };
    const { create } = renderFlow({ productResponses: [[mutableProduct]] });

    await user.click(screen.getByRole("radio", { name: /^마케팅성/ }));
    await user.click(screen.getByRole("button", { name: "목적 완료" }));
    await user.type(screen.getByLabelText("콘텐츠 주제"), "여름 피부 관리");
    await user.selectOptions(await screen.findByRole("combobox", { name: "제품·서비스" }), mutableProduct.id);
    await user.click(screen.getByRole("button", { name: "주제·자료 완료" }));
    mutableProduct.status = "archived";
    await user.click(await screen.findByRole("button", { name: "Instagram" }));
    await user.click(screen.getByRole("button", { name: "AI 구성안 만들기" }));

    expect(create).not.toHaveBeenCalled();
  });

  it("uses a new idempotency key after the proposal request changes", async () => {
    const user = userEvent.setup();
    const { create } = renderFlow();
    create.mockRejectedValue(new Error("proposal_unavailable"));

    await user.click(screen.getByRole("radio", { name: /^정보성/ }));
    await user.click(screen.getByRole("button", { name: "목적 완료" }));
    await user.type(screen.getByLabelText("콘텐츠 주제"), "첫 번째 주제");
    await user.click(screen.getByRole("button", { name: "주제·자료 완료" }));
    await user.click(await screen.findByRole("button", { name: "Instagram" }));
    await user.click(screen.getByRole("button", { name: "AI 구성안 만들기" }));
    await screen.findByRole("alert");

    await user.click(screen.getByRole("button", { name: /2\. 주제·자료/ }));
    await user.clear(screen.getByLabelText("콘텐츠 주제"));
    await user.type(screen.getByLabelText("콘텐츠 주제"), "두 번째 주제");
    await user.click(screen.getByRole("button", { name: "주제·자료 완료" }));
    await user.click(screen.getByRole("button", { name: "Instagram" }));
    await user.click(screen.getByRole("button", { name: "AI 구성안 만들기" }));

    await waitFor(() => expect(create).toHaveBeenCalledTimes(2));
    const firstKey = create.mock.calls[0]?.[1].idempotencyKey;
    const secondKey = create.mock.calls[1]?.[1].idempotencyKey;
    expect(firstKey).not.toBe(secondKey);
  });

  it("tells the user to approve Brand Rules in Brand Center when proposal preflight blocks", async () => {
    const user = userEvent.setup();
    const { create } = renderFlow();
    create.mockRejectedValueOnce(new ApiRequestError({
      status: 409,
      errorCode: "ai_content_brand_rules_required",
    }));

    await user.click(screen.getByRole("radio", { name: /^정보성/ }));
    await user.click(screen.getByRole("button", { name: "목적 완료" }));
    await user.type(screen.getByLabelText("콘텐츠 주제"), "브랜드 신뢰 원칙");
    await user.click(screen.getByRole("button", { name: "주제·자료 완료" }));
    await user.click(await screen.findByRole("button", { name: "Instagram" }));
    await user.click(screen.getByRole("button", { name: "AI 구성안 만들기" }));

    expect(await screen.findByRole("alert"))
      .toHaveTextContent("브랜드 센터에서 브랜드 규칙을 먼저 승인해 주세요");
    expect(screen.getByText("브랜드 신뢰 원칙")).toBeVisible();
  });

  it("tells the user to repair an unavailable Brand Rules style image", async () => {
    const user = userEvent.setup();
    const { create } = renderFlow();
    create.mockRejectedValueOnce(new ApiRequestError({
      status: 409,
      errorCode: "ai_content_brand_style_required",
    }));

    await user.click(screen.getByRole("radio", { name: /^정보성/ }));
    await user.click(screen.getByRole("button", { name: "목적 완료" }));
    await user.type(screen.getByLabelText("콘텐츠 주제"), "브랜드 스타일 점검");
    await user.click(screen.getByRole("button", { name: "주제·자료 완료" }));
    await user.click(await screen.findByRole("button", { name: "Instagram" }));
    await user.click(screen.getByRole("button", { name: "AI 구성안 만들기" }));

    expect(await screen.findByRole("alert"))
      .toHaveTextContent("브랜드 규칙의 스타일 이미지를 다시 선택해 주세요");
    expect(screen.getByText("브랜드 스타일 점검")).toBeVisible();
  });

  it("serializes the selected reference before proposal creation and loads styles only after proposal selection", async () => {
    const user = userEvent.setup();
    const { create, listReferences, listReferenceSeeds, listStylePresets } = renderFlow();

    expect(screen.getByRole("heading", { name: "어떤 콘텐츠를 만들까요?" })).toBeVisible();
    expect(screen.getAllByRole("listitem").slice(0, 4).map((item) => item.textContent)).toEqual([
      "1콘텐츠 설정목적·원문·형식",
      "2구성안·스타일방향·첨부 선택",
      "3콘텐츠 생성기획·이미지 제작",
      "4결과 확인검토·다운로드·게시",
    ]);
    expect(screen.getByText("콘텐츠 설정").closest("li")).toHaveAttribute("aria-current", "step");
    expect(screen.getByRole("button", { name: "1. 목적" })).toBeVisible();
    expect(screen.getByRole("button", { name: "2. 주제·자료" })).toBeVisible();
    expect(screen.getByRole("button", { name: "3. 채널·형식" })).toBeVisible();
    expect(screen.queryByText(/Wiki/i)).not.toBeInTheDocument();
    expect(listReferences).not.toHaveBeenCalled();
    expect(listStylePresets).not.toHaveBeenCalled();

    await user.click(screen.getByRole("radio", { name: /^정보성/ }));
    await user.click(screen.getByRole("button", { name: "목적 완료" }));
    expect(screen.queryByRole("combobox", { name: "제품·서비스" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "레퍼런스" }));
    expect(await screen.findByText("지난 여름 가이드")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "레퍼런스 선택: 지난 여름 가이드" }));
    await user.click(screen.getByRole("button", { name: "주제·자료 완료" }));
    await user.click(await screen.findByRole("button", { name: "Instagram" }));
    await user.click(screen.getByRole("button", { name: "AI 구성안 만들기" }));

    expect(await screen.findByRole("heading", { name: "어떤 방향으로 만들까요?" })).toBeVisible();
    expect(screen.getByText("분석한 원문")).toBeVisible();
    expect(document.querySelector(".source-strip")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "입력 요약" })).not.toBeInTheDocument();

    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith("brand-demo", {
      idempotencyKey: expect.any(String),
      request: {
        contractVersion: "content-orchestration.v2",
        brandId: "brand-demo",
        purpose: "informational",
        seed: {
          kind: "reference",
          items: [{ referenceId: "11111111-1111-4111-8111-111111111111", roles: ["planning"] }],
        },
        contentInstruction: null,
        productId: null,
        outputSettings: {
          outputFormat: "card_news",
          channelTargets: ["instagram"],
          aspectRatio: "1:1",
          outputCount: 1,
        },
      },
    });
    expect(listReferenceSeeds).toHaveBeenCalledWith("brand-demo", "card_news");
    expect(await screen.findByText("여름 피부 3단계 관리")).toBeVisible();
    expect(screen.getByText("흔한 실수 체크리스트")).toBeVisible();
    expect(listReferences).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "구성안 선택: 여름 피부 3단계 관리" }));

    expect(await screen.findByRole("heading", { name: "제품 정보와 스타일을 확인하세요" })).toBeVisible();
    expect(listStylePresets).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("radio", { name: /차분한 스타일/ })).toBeChecked();
    expect(listReferences).not.toHaveBeenCalled();
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
        },
        channelTargets: ["blog_export"],
        outputFormats: ["blog"],
        brief: "근거를 간결하게",
      },
    });

    expect(await screen.findByText("복원된 브랜드 주제")).toBeVisible();
    expect(screen.getAllByText("블로그")[0]).toBeVisible();
    expect(screen.getAllByText("여름 피부 3단계 관리")[0]).toBeVisible();
  });

  it("validates a seed reference in the active brand result and selects it before proposal creation", async () => {
    const user = userEvent.setup();
    const { listReferenceSeeds } = renderFlow({ initialSeedReferenceId: "11111111-1111-4111-8111-111111111111" });

    await user.click(screen.getByRole("radio", { name: /^정보성/ }));
    await user.click(screen.getByRole("button", { name: "목적 완료" }));
    await user.click(screen.getByRole("button", { name: "레퍼런스" }));

    expect(await screen.findByRole("button", { name: "선택 해제: 지난 여름 가이드" })).toBePressed();
    expect(screen.getByText(/선택 1 \/ 5/)).toBeVisible();
    expect(listReferenceSeeds).toHaveBeenCalledTimes(1);
  });

  it("removes an unavailable seed reference before proposal creation", async () => {
    const user = userEvent.setup();
    const onSeedReferenceInvalid = vi.fn();
    renderFlow({ initialSeedReferenceId: "missing-reference", onSeedReferenceInvalid });

    await user.click(screen.getByRole("radio", { name: /^정보성/ }));
    await user.click(screen.getByRole("button", { name: "목적 완료" }));
    await user.click(screen.getByRole("button", { name: "레퍼런스" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("현재 사용할 수 없어");
    expect(screen.getByText(/선택 0 \/ 5/)).toBeVisible();
    expect(onSeedReferenceInvalid).toHaveBeenCalledTimes(1);
  });

  it("enables channel choices from the real capability response for the selected format", async () => {
    const user = userEvent.setup();
    renderFlow();

    await user.click(screen.getByRole("radio", { name: /^정보성/ }));
    await user.click(screen.getByRole("button", { name: "목적 완료" }));
    await user.type(screen.getByLabelText("콘텐츠 주제"), "여름 피부 관리");
    await user.click(screen.getByRole("button", { name: "주제·자료 완료" }));
    expect(await screen.findByRole("button", { name: "Instagram" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Threads" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: "블로그" }));
    expect(screen.getByRole("button", { name: "블로그 파일 내보내기" })).toBeVisible();
  });

  it("clears references selected for the previous output format", async () => {
    const user = userEvent.setup();
    const { listReferenceSeeds } = renderFlow();

    await user.click(screen.getByRole("radio", { name: /^정보성/ }));
    await user.click(screen.getByRole("button", { name: "목적 완료" }));
    await user.type(screen.getByLabelText("콘텐츠 주제"), "여름 피부 관리");
    await user.click(screen.getByRole("button", { name: "레퍼런스" }));
    await user.click(await screen.findByRole("button", { name: "레퍼런스 선택: 지난 여름 가이드" }));
    expect(screen.getByText(/선택 1 \/ 5/)).toBeVisible();
    await user.click(screen.getByRole("button", { name: "주제·자료 완료" }));
    await user.click(screen.getByRole("radio", { name: "블로그" }));

    await waitFor(() => expect(listReferenceSeeds).toHaveBeenLastCalledWith("brand-demo", "blog"));
    expect(screen.getByText(/선택 0 \/ 5/)).toBeVisible();
    expect(screen.getByRole("button", { name: "주제·자료 완료" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "AI 구성안 만들기" })).not.toBeInTheDocument();
  });

  it("resets brand-scoped wizard state and ignores an old product response", async () => {
    let resolveOldProducts!: (items: ProductServiceItem[]) => void;
    const oldProducts = new Promise<ProductServiceItem[]>((resolve) => { resolveOldProducts = resolve; });
    const newProduct = {
      ...approvedProduct,
      id: "product-new",
      brandId: "brand-new",
      displayName: "새 브랜드 제품",
      activeVersion: approvedProduct.activeVersion && {
        ...approvedProduct.activeVersion,
        id: "product-version-new",
        brandId: "brand-new",
        productServiceId: "product-new",
      },
    };
    const user = userEvent.setup();
    const { rerenderBrand } = renderFlow({
      productLoader: (brandId) => brandId === "brand-demo" ? oldProducts : Promise.resolve([newProduct]),
    });

    await user.click(screen.getByRole("radio", { name: /^마케팅성/ }));
    await user.click(screen.getByRole("button", { name: "목적 완료" }));
    expect(screen.getByText("승인된 제품·서비스를 불러오는 중입니다.")).toBeVisible();

    rerenderBrand("brand-new");
    await waitFor(() => expect(screen.getByRole("radio", { name: /^마케팅성/ })).not.toBeChecked());
    await act(async () => { resolveOldProducts([approvedProduct]); });
    expect(screen.queryByText("승인 세럼")).not.toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: /^마케팅성/ }));
    await user.click(screen.getByRole("button", { name: "목적 완료" }));
    expect(await screen.findByRole("option", { name: "새 브랜드 제품" })).toBeVisible();
    expect(screen.queryByRole("option", { name: "승인 세럼" })).not.toBeInTheDocument();
  });

  it("does not resume the previous brand batch after the brand changes", async () => {
    const { getBatch, rerenderBrand } = renderFlow({ initialBatchId: "batch-1" });
    await waitFor(() => expect(getBatch).toHaveBeenCalledWith("brand-demo", "batch-1", expect.any(AbortSignal)));

    rerenderBrand("brand-new");
    await act(async () => { await Promise.resolve(); });

    expect(getBatch).not.toHaveBeenCalledWith("brand-new", "batch-1", expect.any(AbortSignal));
  });

  it("does not show a proposal error when StrictMode aborts the first resume request", async () => {
    renderFlow({ initialBatchId: "batch-1", strictMode: true, abortFirstBatchLoad: true });

    expect(await screen.findByRole("heading", { name: "어떤 방향으로 만들까요?" })).toBeVisible();
    expect(screen.queryByText("AI 구성안을 불러오지 못했습니다. 입력을 유지한 채 다시 시도해 주세요.")).not.toBeInTheDocument();
  });

  it("surfaces server revalidation when a frozen reference becomes unavailable", async () => {
    const user = userEvent.setup();
    const { updateFinalizationDraft, selectProposal } = renderFlow({
      initialBatchId: "batch-1",
      batchRequest: {
        contractVersion: "content-orchestration.v2",
        brandId: "brand-demo",
        purpose: "informational",
        seed: {
          kind: "reference",
          items: [{ referenceId: "11111111-1111-4111-8111-111111111111", roles: ["planning"] }],
        },
        contentInstruction: null,
        productId: null,
        outputSettings: { outputFormat: "card_news", channelTargets: ["instagram"], aspectRatio: "1:1", outputCount: 1 },
      },
    });

    await user.click(await screen.findByRole("button", { name: "구성안 선택: 여름 피부 3단계 관리" }));
    updateFinalizationDraft.mockRejectedValueOnce(new ApiRequestError({
      status: 409,
      errorCode: "RESOURCE_NOT_AVAILABLE",
      fieldPath: "references",
    }));
    await user.click(await screen.findByRole("button", { name: "콘텐츠 생성 시작" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("레퍼런스 입력을 확인해 주세요");
    expect(selectProposal).toHaveBeenCalledTimes(1);
  });

  it("does not replace the frozen setup references with the legacy recommendation query", async () => {
    const user = userEvent.setup();
    const { listReferences } = renderFlow({ initialBatchId: "batch-1" });

    await user.click(await screen.findByRole("button", { name: "구성안 선택: 여름 피부 3단계 관리" }));

    expect(listReferences).not.toHaveBeenCalled();
  });

  it("uploads a V3 product image and sends only its attachment id in finalization", async () => {
    const user = userEvent.setup();
    const { uploadAttachment, updateFinalizationDraft, startGenerationV2 } = renderFlow({ initialBatchId: "batch-1" });
    const usageChanged = vi.fn();
    window.addEventListener("brand-pilot:publish-calendar-usage-changed", usageChanged, { once: true });

    await user.click(await screen.findByRole("button", { name: "구성안 선택: 여름 피부 3단계 관리" }));
    await user.upload(
      await screen.findByLabelText("제품 이미지"),
      new File(["product"], "campaign-product.png", { type: "image/png" }),
    );

    await waitFor(() => expect(uploadAttachment).toHaveBeenCalledWith(
      "brand-demo",
      expect.any(String),
      expect.objectContaining({ role: "product_image", fileName: "campaign-product.png" }),
      expect.any(Function),
    ));
    await user.click(screen.getByRole("button", { name: "콘텐츠 생성 시작" }));
    expect(updateFinalizationDraft).toHaveBeenCalledWith(
      "brand-demo",
      expect.any(String),
      expect.objectContaining({ attachmentIds: ["one-time-receipt-1"] }),
    );
    expect(startGenerationV2).toHaveBeenCalledTimes(1);
    expect(usageChanged).toHaveBeenCalledTimes(1);
  });

  it("maps the generation quota code to Korean and preserves the selected proposal", async () => {
    const user = userEvent.setup();
    const { startGenerationV2 } = renderFlow({ initialBatchId: "batch-1" });
    startGenerationV2.mockRejectedValueOnce(
      new ApiRequestError({ status: 429, errorCode: "ai_content_limit_reached" }),
    );

    await user.click(await screen.findByRole("button", { name: "구성안 선택: 여름 피부 3단계 관리" }));
    await user.click(await screen.findByRole("button", { name: "콘텐츠 생성 시작" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("오늘 AI 콘텐츠 생성 10회를 모두 사용했습니다");
    expect(screen.getAllByText("여름 피부 3단계 관리")[0]).toBeVisible();
    expect(screen.getByRole("heading", { name: "제품 정보와 스타일을 확인하세요" })).toBeVisible();
  });

  it("maps the subscription weekly generation quota to Korean", async () => {
    const user = userEvent.setup();
    const { startGenerationV2 } = renderFlow({ initialBatchId: "batch-1" });
    startGenerationV2.mockRejectedValueOnce(
      new ApiRequestError({ status: 429, errorCode: "generation_weekly_quota_exceeded" }),
    );

    await user.click(await screen.findByRole("button", { name: "구성안 선택: 여름 피부 3단계 관리" }));
    await user.click(await screen.findByRole("button", { name: "콘텐츠 생성 시작" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("이번 주 콘텐츠 생성 한도를 모두 사용했습니다");
  });

  it("seals the selected proposal before loading current visual selections", async () => {
    const user = userEvent.setup();
    const { selectProposal, listStylePresets, listAvatars, listProductImages } = renderFlow({ initialBatchId: "batch-1" });

    await user.click(await screen.findByRole("button", { name: "구성안 선택: 여름 피부 3단계 관리" }));

    await waitFor(() => expect(listStylePresets).toHaveBeenCalledWith("brand-demo"));
    expect(selectProposal).toHaveBeenCalledWith("brand-demo", "proposal-1", expect.any(String));
    expect(selectProposal.mock.invocationCallOrder[0]).toBeLessThan(listStylePresets.mock.invocationCallOrder[0]!);
    expect(listAvatars).toHaveBeenCalledWith("brand-demo");
    expect(listProductImages).not.toHaveBeenCalled();
    expect(screen.getByRole("radio", { name: /차분한 스타일/ })).toBeChecked();
    expect(screen.queryByText(/샘플 스타일/)).not.toBeInTheDocument();
  });

  it("commits each proposal change after sealing and keeps alternatives selectable before generation starts", async () => {
    let resolveSelection!: (value: { id: string }) => void;
    const pendingSelection = new Promise<{ id: string }>((resolve) => { resolveSelection = resolve; });
    const user = userEvent.setup();
    const { selectProposal } = renderFlow({ initialBatchId: "batch-1" });
    selectProposal
      .mockImplementationOnce(async () => pendingSelection as never)
      .mockResolvedValueOnce({ id: "generation-sealed" } as never);

    const first = await screen.findByRole("button", { name: "구성안 선택: 여름 피부 3단계 관리" });
    const second = screen.getByRole("button", { name: "구성안 선택: 흔한 실수 체크리스트" });
    await user.click(first);

    expect(first).not.toBePressed();
    expect(screen.queryByRole("heading", { name: "제품 정보와 스타일을 확인하세요" })).not.toBeInTheDocument();

    await act(async () => { resolveSelection({ id: "generation-sealed" }); });
    await waitFor(() => expect(first).toBePressed());
    await user.type(screen.getByLabelText("이미지 추가 요청 (선택)"), "기존 이미지 지시 유지");
    expect(second).toBeEnabled();
    await user.click(second);

    await waitFor(() => expect(selectProposal).toHaveBeenCalledTimes(2));
    expect(selectProposal.mock.calls.map((call) => call[1])).toEqual(["proposal-1", "proposal-2"]);
    expect(second).toBePressed();
    expect(first).not.toBePressed();
    expect(screen.getByLabelText("이미지 추가 요청 (선택)")).toHaveValue("기존 이미지 지시 유지");
  });

  it("keeps proposal selection state unchanged when sealing fails", async () => {
    const user = userEvent.setup();
    const { selectProposal } = renderFlow({ initialBatchId: "batch-1" });
    selectProposal.mockRejectedValueOnce(new Error("seal_failed"));

    const first = await screen.findByRole("button", { name: "구성안 선택: 여름 피부 3단계 관리" });
    await user.click(first);

    expect(await screen.findByRole("alert")).toHaveTextContent("구성안을 선택하지 못했습니다");
    expect(first).not.toBePressed();
    expect(screen.queryByRole("heading", { name: "제품 정보와 스타일을 확인하세요" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "구성안 선택: 흔한 실수 체크리스트" })).toBeEnabled();
  });

  it("excludes inactive named style presets from manual generation", async () => {
    const user = userEvent.setup();
    renderFlow({
      initialBatchId: "batch-1",
      stylePresetLoader: async (requestedBrandId) => [{
        id: "archived-style",
        workspaceId: "workspace-1",
        brandId: requestedBrandId,
        revision: 2,
        name: "사용할 수 없는 스타일",
        description: "보관됨",
        visualTokens: { colors: [], fonts: [], notes: [] },
        referenceItemIds: ["style-1"],
        isDefault: false,
        status: "archived",
        createdAt: "2026-08-01T00:00:00.000Z",
        updatedAt: "2026-08-01T00:00:00.000Z",
      }],
    });

    await user.click(await screen.findByRole("button", { name: "구성안 선택: 여름 피부 3단계 관리" }));

    expect(await screen.findByRole("radio", { name: "스타일 사용 안 함" })).toBeChecked();
    expect(screen.queryByRole("radio", { name: /사용할 수 없는 스타일/ })).not.toBeInTheDocument();
  });

  it("updates only the V2 finalization draft and starts one sealed package", async () => {
    const user = userEvent.setup();
    const {
      updateManualVisualSelection, updateFinalizationDraft, startGenerationV2,
    } = renderFlow({ initialBatchId: "batch-1" });

    await user.click(await screen.findByRole("button", { name: "구성안 선택: 여름 피부 3단계 관리" }));
    await user.click(await screen.findByRole("radio", { name: /차분한 스타일/ }));
    await user.type(screen.getByLabelText("이미지 추가 요청 (선택)"), "밝고 정돈된 편집 디자인");
    await user.click(screen.getByRole("button", { name: "콘텐츠 생성 시작" }));

    await waitFor(() => expect(updateManualVisualSelection).toHaveBeenCalledWith(
      "brand-demo",
      expect.any(String),
      {
        contractVersion: "manual-visual-selection.v1",
        product: null,
        stylePreset: { presetId: "style-preset-1", revision: 1 },
        avatar: { avatarId: "avatar-1", revision: 1 },
      },
    ));

    await waitFor(() => expect(updateFinalizationDraft).toHaveBeenCalledWith(
      "brand-demo",
      expect.any(String),
      {
        contractVersion: "content-finalization-draft.v2",
        avatarStyleImageId: null,
        userImageInstruction: "밝고 정돈된 편집 디자인",
        attachmentIds: [],
      },
    ));
    expect(startGenerationV2).toHaveBeenCalledWith("brand-demo", expect.any(String), expect.any(String));
    expect(JSON.stringify(startGenerationV2.mock.calls)).not.toMatch(/outputCount|wiki|faq|logo|avatarSnapshot|referenceIds|product|proposal/i);
  });

  it("shows and retries a real manual visual asset load failure", async () => {
    let attempts = 0;
    const user = userEvent.setup();
    const { listStylePresets } = renderFlow({
      initialBatchId: "batch-1",
      stylePresetLoader: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("style_presets_unavailable");
        return [];
      },
    });

    await user.click(await screen.findByRole("button", { name: "구성안 선택: 여름 피부 3단계 관리" }));
    expect(await screen.findByText("브랜드 제품·스타일·아바타를 불러오지 못했습니다. 다시 시도해 주세요.")).toBeVisible();
    expect(screen.getByRole("button", { name: "콘텐츠 생성 시작" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "다시 시도" }));

    await waitFor(() => expect(listStylePresets).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole("radio", { name: "스타일 사용 안 함" })).toBeChecked();
  });
});
