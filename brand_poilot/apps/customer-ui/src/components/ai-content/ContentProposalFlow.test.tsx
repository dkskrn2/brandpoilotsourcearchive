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
  rulesLoader?: (brandId: string) => Promise<unknown>;
  styleReferenceLoader?: (brandId: string, referenceId: string) => Promise<unknown>;
  strictMode?: boolean;
  abortFirstBatchLoad?: boolean;
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
  const updateFinalizationDraft = vi.fn(async () => ({} as never));
  const startGenerationV2 = vi.fn(async () => ({} as never));
  Object.assign(gateway, { updateFinalizationDraft, startGenerationV2 });
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
        description: "대표 모델", isDefault: true, status: "active", createdByUserId: "user-1",
        createdAt: "2026-07-28T00:00:00.000Z", updatedAt: "2026-07-28T00:00:00.000Z",
        images: [{ id: "image-1", position: 0, representative: true, storagePath: "avatar.jpg", storageUrl: "https://example.com/avatar.jpg", mimeType: "image/jpeg", sizeBytes: 1, checksum: "a" }],
      },
    ]),
  };
  const approvedRules = {
    active: {
      id: "rules-1", version: 1, status: "approved",
      rules: {
        contractVersion: "brand-rules.v1", requiredPhrases: [], forbiddenPhrases: [], exaggerationRules: [],
        ctaRules: { defaultCta: "", allowed: [] }, channelRules: {},
        designRules: {
          colors: [], fonts: [], notes: [],
          referenceImages: [{ referenceItemId: "style-1", description: "차분한 스타일", tags: ["차분함"] }],
        },
        autoApprovalRules: { enabled: false, conditions: [] },
      },
      approvedAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-01T00:00:00.000Z",
    },
    draft: null,
    versions: [],
  };
  const getRules = vi.fn().mockImplementation((requestedBrandId: string) =>
    options.rulesLoader ? options.rulesLoader(requestedBrandId) : Promise.resolve(approvedRules));
  const getReference = vi.fn().mockImplementation((requestedBrandId: string, referenceId: string) => (
    options.styleReferenceLoader
      ? options.styleReferenceLoader(requestedBrandId, referenceId)
      : Promise.resolve({
        id: referenceId,
        workspaceId: "workspace-1",
        brandId: requestedBrandId,
        kind: "upload",
        contentPurpose: "both",
        origin: "Upload",
        title: "차분한 스타일",
        previewUrl: "https://example.com/style.jpg",
        sourceUrl: null,
        format: "image/png",
        metadata: {},
        favorite: false,
        archivedAt: null,
        referenceBrandId: null,
        createdAt: "2026-08-01T00:00:00.000Z",
        updatedAt: "2026-08-01T00:00:00.000Z",
        description: null,
        body: null,
        snapshot: null,
      })
  ));
  const channelCapabilities = createChannelCapabilityGateway(async () => capabilities);
  const referenceTrendGateway = {
    searchInstagramTrends: vi.fn(),
    saveInstagramTrendSource: vi.fn(),
  };

  const flow = (brandId: string) => <MemoryRouter><ContentProposalFlow
    brandId={brandId}
    gateway={gateway}
    libraries={libraries}
    channelCapabilities={channelCapabilities}
    initialBatchId={options.initialBatchId}
    initialSeedReferenceId={options.initialSeedReferenceId}
    onSeedReferenceInvalid={options.onSeedReferenceInvalid}
    referenceTrendGateway={referenceTrendGateway}
    {...({ rulesGateway: { getRules }, assetGateway: { getReference } } as object)}
  /></MemoryRouter>;
  const view = (brandId: string) => options.strictMode
    ? <StrictMode>{flow(brandId)}</StrictMode>
    : flow(brandId);
  const rendered = render(view(options.brandId ?? "brand-demo"));
  return {
    gateway, create, getBatch, listReferences, listReferenceSeeds, libraries,
    selectProposal, uploadAttachment,
    updateFinalizationDraft, startGenerationV2, getRules, getReference,
    rerenderBrand: (brandId: string) => rendered.rerender(view(brandId)),
  };
}

describe("ContentProposalFlow", () => {
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
    const { create, listReferences, listReferenceSeeds, getRules } = renderFlow();

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
    expect(getRules).not.toHaveBeenCalled();

    await user.click(screen.getByRole("radio", { name: /^정보성/ }));
    await user.click(screen.getByRole("button", { name: "목적 완료" }));
    expect(screen.queryByRole("combobox", { name: "제품·서비스" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "레퍼런스" }));
    expect(await screen.findByText("지난 여름 가이드")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "레퍼런스 선택: 지난 여름 가이드" }));
    await user.click(screen.getByRole("button", { name: "주제·자료 완료" }));
    await user.click(await screen.findByRole("button", { name: "Instagram" }));
    await user.click(screen.getByRole("button", { name: "AI 구성안 만들기" }));

    expect(await screen.findByRole("heading", { name: "가장 좋은 방향을 선택하세요" })).toBeVisible();

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

    expect(await screen.findByRole("heading", { name: "브랜드 스타일과 이미지 설정" })).toBeVisible();
    expect(getRules).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("img", { name: "차분한 스타일" })).toBeVisible();
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
    expect(screen.getAllByText("blog")[0]).toBeVisible();
    expect(screen.getAllByText("blog_export")[0]).toBeVisible();
    expect(screen.getByText("여름 피부 3단계 관리")).toBeVisible();
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

    expect(await screen.findByRole("heading", { name: "가장 좋은 방향을 선택하세요" })).toBeVisible();
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
    await user.click(await screen.findByRole("button", { name: "최종 콘텐츠 1개 생성" }));

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
    await user.click(screen.getByRole("button", { name: "최종 콘텐츠 1개 생성" }));
    expect(updateFinalizationDraft).toHaveBeenCalledWith(
      "brand-demo",
      expect.any(String),
      expect.objectContaining({ attachmentIds: ["one-time-receipt-1"] }),
    );
    expect(startGenerationV2).toHaveBeenCalledTimes(1);
  });

  it("maps the generation quota code to Korean and preserves the selected proposal", async () => {
    const user = userEvent.setup();
    const { startGenerationV2 } = renderFlow({ initialBatchId: "batch-1" });
    startGenerationV2.mockRejectedValueOnce(
      new ApiRequestError({ status: 429, errorCode: "ai_content_limit_reached" }),
    );

    await user.click(await screen.findByRole("button", { name: "구성안 선택: 여름 피부 3단계 관리" }));
    await user.click(await screen.findByRole("button", { name: "최종 콘텐츠 1개 생성" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("오늘 AI 콘텐츠 생성 10회를 모두 사용했습니다");
    expect(screen.getByText("여름 피부 3단계 관리")).toBeVisible();
    expect(screen.getByRole("heading", { name: "브랜드 스타일과 이미지 설정" })).toBeVisible();
  });

  it("seals the selected proposal before loading approved style previews", async () => {
    const user = userEvent.setup();
    const { selectProposal, getRules, getReference } = renderFlow({ initialBatchId: "batch-1" });

    await user.click(await screen.findByRole("button", { name: "구성안 선택: 여름 피부 3단계 관리" }));

    await waitFor(() => expect(getReference).toHaveBeenCalledWith("brand-demo", "style-1"));
    expect(selectProposal).toHaveBeenCalledWith("brand-demo", "proposal-1", expect.any(String));
    expect(selectProposal.mock.invocationCallOrder[0]).toBeLessThan(getRules.mock.invocationCallOrder[0]!);
    expect(getRules.mock.invocationCallOrder[0]).toBeLessThan(getReference.mock.invocationCallOrder[0]!);
    expect(screen.getByRole("img", { name: "차분한 스타일" })).toHaveAttribute("src", "https://example.com/style.jpg");
    expect(screen.queryByText(/샘플 스타일/)).not.toBeInTheDocument();
  });

  it("commits a proposal only after sealing succeeds and disables every alternative afterwards", async () => {
    let resolveSelection!: (value: { id: string }) => void;
    const pendingSelection = new Promise<{ id: string }>((resolve) => { resolveSelection = resolve; });
    const user = userEvent.setup();
    const { selectProposal } = renderFlow({ initialBatchId: "batch-1" });
    selectProposal.mockImplementationOnce(async () => pendingSelection as never);

    const first = await screen.findByRole("button", { name: "구성안 선택: 여름 피부 3단계 관리" });
    const second = screen.getByRole("button", { name: "구성안 선택: 흔한 실수 체크리스트" });
    await user.click(first);

    expect(first).not.toBePressed();
    expect(screen.queryByRole("heading", { name: "브랜드 스타일과 이미지 설정" })).not.toBeInTheDocument();

    await act(async () => { resolveSelection({ id: "generation-sealed" }); });
    await waitFor(() => expect(first).toBePressed());
    expect(second).toBeDisabled();
    await user.click(second);

    expect(selectProposal).toHaveBeenCalledTimes(1);
    expect(first).toBePressed();
  });

  it("keeps proposal selection state unchanged when sealing fails", async () => {
    const user = userEvent.setup();
    const { selectProposal } = renderFlow({ initialBatchId: "batch-1" });
    selectProposal.mockRejectedValueOnce(new Error("seal_failed"));

    const first = await screen.findByRole("button", { name: "구성안 선택: 여름 피부 3단계 관리" });
    await user.click(first);

    expect(await screen.findByRole("alert")).toHaveTextContent("구성안을 선택하지 못했습니다");
    expect(first).not.toBePressed();
    expect(screen.queryByRole("heading", { name: "브랜드 스타일과 이미지 설정" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "구성안 선택: 흔한 실수 체크리스트" })).toBeEnabled();
  });

  it.each([
    ["archived", { archivedAt: "2026-08-01T00:00:00.000Z" }],
    ["non-upload", { kind: "external_url" }],
    ["missing-preview", { previewUrl: null, sourceUrl: "https://example.com/source-only.jpg" }],
  ])("excludes an invalid %s Brand Rules style instead of using it", async (_case, invalidFields) => {
    const user = userEvent.setup();
    renderFlow({
      initialBatchId: "batch-1",
      styleReferenceLoader: async (requestedBrandId, referenceId) => ({
        id: referenceId,
        workspaceId: "workspace-1",
        brandId: requestedBrandId,
        kind: "upload",
        contentPurpose: "both",
        origin: "Upload",
        title: "사용할 수 없는 스타일",
        previewUrl: "https://example.com/style.jpg",
        sourceUrl: "https://example.com/source.jpg",
        format: "image/png",
        metadata: {},
        favorite: false,
        archivedAt: null,
        referenceBrandId: null,
        createdAt: "2026-08-01T00:00:00.000Z",
        updatedAt: "2026-08-01T00:00:00.000Z",
        description: null,
        body: null,
        snapshot: null,
        ...invalidFields,
      }),
    });

    await user.click(await screen.findByRole("button", { name: "구성안 선택: 여름 피부 3단계 관리" }));

    expect(await screen.findByText("등록된 브랜드 스타일 이미지 없이 생성합니다")).toBeVisible();
    expect(screen.queryByRole("img", { name: "사용할 수 없는 스타일" })).not.toBeInTheDocument();
    expect(screen.queryByText("브랜드 스타일 이미지를 불러오지 못했습니다. 다시 시도해 주세요.")).not.toBeInTheDocument();
  });

  it("updates only the V2 finalization draft and starts one sealed package", async () => {
    const user = userEvent.setup();
    const {
      updateFinalizationDraft, startGenerationV2,
    } = renderFlow({ initialBatchId: "batch-1" });

    await user.click(await screen.findByRole("button", { name: "구성안 선택: 여름 피부 3단계 관리" }));
    await user.click(await screen.findByRole("radio", { name: /차분한 스타일/ }));
    await user.type(screen.getByLabelText("모든 생성 이미지에 공통 적용할 프롬프트"), "밝고 정돈된 편집 디자인");
    await user.click(screen.getByRole("button", { name: "최종 콘텐츠 1개 생성" }));

    await waitFor(() => expect(updateFinalizationDraft).toHaveBeenCalledWith(
      "brand-demo",
      expect.any(String),
      {
        contractVersion: "content-finalization-draft.v2",
        avatarStyleImageId: "style-1",
        userImageInstruction: "밝고 정돈된 편집 디자인",
        attachmentIds: [],
      },
    ));
    expect(startGenerationV2).toHaveBeenCalledWith("brand-demo", expect.any(String), expect.any(String));
    expect(JSON.stringify(startGenerationV2.mock.calls)).not.toMatch(/outputCount|wiki|faq|logo|avatarSnapshot|referenceIds|product|proposal/i);
  });

  it("shows and retries a real Brand Rules load failure without inventing sample styles", async () => {
    let attempts = 0;
    const user = userEvent.setup();
    const { getRules } = renderFlow({
      initialBatchId: "batch-1",
      rulesLoader: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("rules_unavailable");
        return {
          active: null,
          draft: null,
          versions: [],
        };
      },
    });

    await user.click(await screen.findByRole("button", { name: "구성안 선택: 여름 피부 3단계 관리" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("브랜드 스타일 이미지를 불러오지 못했습니다");
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "브랜드 스타일 다시 불러오기" }));

    await waitFor(() => expect(getRules).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("등록된 브랜드 스타일 이미지 없이 생성합니다")).toBeVisible();
  });
});
