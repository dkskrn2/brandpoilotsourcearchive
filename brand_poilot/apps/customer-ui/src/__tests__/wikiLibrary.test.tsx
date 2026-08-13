import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { useState } from "react";
import { ApiRequestError } from "../lib/apiClient";
import { KnowledgeCategoryEditorPanel } from "../components/brand-center/KnowledgeCategoryEditorPanel";
import { WikiLibraryPanel } from "../components/brand-center/WikiLibraryPanel";

const faqId = "00000000-0000-4000-8000-000000000201";
const howToId = "00000000-0000-4000-8000-000000000202";
const guideId = "00000000-0000-4000-8000-000000000203";
const policyId = "00000000-0000-4000-8000-000000000204";
const issueId = "00000000-0000-4000-8000-000000000301";
const productId = "00000000-0000-4000-8000-000000000101";

const items = [
  {
    id: faqId,
    workspaceId: "workspace-1",
    brandId: "brand-1",
    itemType: "faq" as const,
    title: "배송 기간",
    content: "영업일 기준 2일",
    status: "active" as const,
    origin: "manual" as const,
    provenance: {},
    createdByUserId: "user-1",
    approvedByUserId: "user-1",
    approvedAt: "2026-07-27T00:00:00.000Z",
    sourceKind: "faq" as const,
    sourceId: faqId,
    activeVersionId: "wiki-v4",
    lastBuiltAt: "2026-07-27T01:00:00.000Z",
    buildStatus: "active" as const,
    sourceAliases: ["배송 언제 와요?"],
    manualAliases: ["택배 언제 와요?"],
    effectiveAliases: ["배송 언제 와요?", "택배 언제 와요?"],
    updatedAt: "2026-08-12T00:00:00.000Z",
  },
  {
    id: howToId,
    workspaceId: "workspace-1",
    brandId: "brand-1",
    itemType: "how_to" as const,
    title: "처음 시작하기",
    content: "브랜드 정보를 먼저 확인합니다.",
    status: "draft" as const,
    origin: "manual" as const,
    provenance: {},
    createdByUserId: "user-1",
    approvedByUserId: null,
    approvedAt: null,
    sourceKind: "guide" as const,
    sourceId: howToId,
    activeVersionId: "wiki-v4",
    lastBuiltAt: "2026-07-27T01:00:00.000Z",
    buildStatus: "draft" as const,
    sourceAliases: [], manualAliases: [], effectiveAliases: [], updatedAt: "2026-08-12T00:00:00.000Z",
  },
  {
    id: guideId,
    workspaceId: "workspace-1",
    brandId: "brand-1",
    itemType: "guide" as const,
    title: "콘텐츠 검토 가이드",
    content: "검토 기준을 순서대로 확인합니다.",
    status: "draft" as const,
    origin: "manual" as const,
    provenance: {},
    createdByUserId: "user-1",
    approvedByUserId: null,
    approvedAt: null,
    sourceKind: "guide" as const,
    sourceId: guideId,
    activeVersionId: "wiki-v4",
    lastBuiltAt: "2026-07-27T01:00:00.000Z",
    buildStatus: "pending" as const,
    sourceAliases: [], manualAliases: [], effectiveAliases: [], updatedAt: "2026-08-12T00:00:00.000Z",
  },
  {
    id: policyId,
    workspaceId: "workspace-1",
    brandId: "brand-1",
    itemType: "policy" as const,
    title: "환불 정책",
    content: "결제 후 7일 이내 요청할 수 있습니다.",
    status: "active" as const,
    origin: "manual" as const,
    provenance: {},
    createdByUserId: "user-1",
    approvedByUserId: "user-1",
    approvedAt: "2026-07-27T00:00:00.000Z",
    sourceKind: "policy" as const,
    sourceId: policyId,
    activeVersionId: "wiki-v4",
    lastBuiltAt: "2026-07-27T01:00:00.000Z",
    buildStatus: "active" as const,
    sourceAliases: [], manualAliases: [], effectiveAliases: [], updatedAt: "2026-08-12T00:00:00.000Z",
  },
  {
    id: productId,
    workspaceId: "workspace-1",
    brandId: "brand-1",
    itemType: "service" as const,
    title: "콘텐츠 운영",
    content: "승인된 제품·서비스에서 자동 반영",
    status: "read_only" as const,
    origin: "product_service" as const,
    provenance: {},
    createdByUserId: null,
    approvedByUserId: null,
    approvedAt: null,
    sourceKind: "product_service" as const,
    sourceId: productId,
    activeVersionId: "wiki-v3",
    lastBuiltAt: "2026-07-26T01:00:00.000Z",
    buildStatus: "stale" as const,
    sourceAliases: [], manualAliases: [], effectiveAliases: [], updatedAt: "2026-08-12T00:00:00.000Z",
  },
];

const resolvedIssue = {
  id: issueId,
  workspaceId: "workspace-1",
  brandId: "brand-1",
  issueType: "knowledge_gap",
  severity: "warning" as const,
  status: "resolved" as const,
  question: "배송이 얼마나 걸리나요?",
  detail: {},
  sourceKind: "faq" as const,
  sourceId: faqId,
  activeVersionId: "wiki-v4",
  lastBuiltAt: "2026-07-27T01:00:00.000Z",
  buildStatus: "active" as const,
  resolvedAt: "2026-07-27T01:30:00.000Z",
};

afterEach(() => cleanup());

function renderPanel(ui: React.ReactNode) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

function gateway(overrides: Record<string, unknown> = {}) {
  return {
    listWikiItems: vi.fn(async () => items),
    getFaqCapabilities: vi.fn(async () => ({
      suggestions: true,
      expandedExact: false,
      shadowMatching: false,
      clarification: false,
      clarifyThreshold: 0.8,
    })),
    createWikiItem: vi.fn(async () => items[0]),
    updateWikiItem: vi.fn(async () => items[0]),
    listWikiIssues: vi.fn(async () => [resolvedIssue]),
    resolveWikiIssue: vi.fn(async () => resolvedIssue),
    getLatestFaqSuggestionRun: vi.fn(async () => ({ run: null })),
    getFaqSuggestionRun: vi.fn(),
    createFaqSuggestionRun: vi.fn(),
    updateFaqSuggestionItem: vi.fn(async (_brandId, _runId, _itemId, input) => ({
      item: {
        id: _itemId,
        workspaceId: "workspace-1",
        brandId: "brand-1",
        runId: _runId,
        position: 0,
        evidence: [],
        confidence: 0.9,
        status: "review",
        duplicateOfKnowledgeEntryId: null,
        approvedKnowledgeEntryId: null,
        reviewedByUserId: null,
        reviewedAt: null,
        createdAt: input.expectedUpdatedAt,
        updatedAt: "2026-08-02T00:02:00.000Z",
        ...input,
      },
    })),
    approveFaqSuggestionItem: vi.fn(),
    dismissFaqSuggestionItem: vi.fn(),
    createFaqAliasSuggestionRun: vi.fn(),
    getLatestFaqAliasSuggestionRun: vi.fn(async () => ({ run: null })),
    applyFaqAliasSuggestionRun: vi.fn(),
    ...overrides,
  };
}

const legacyApi = {
  listKnowledgeImports: vi.fn(async () => []),
  getWikiStatus: vi.fn(async () => ({
    activeVersion: {
      id: "wiki-v4",
      status: "active",
      version: 4,
      sourceCount: 2,
      documentCount: 2,
      knowledgeEntryCount: 2,
      chunkCount: 3,
      activatedAt: "2026-07-27T01:00:00.000Z",
      failedAt: null,
      errorMessage: null,
    },
    currentVersion: null,
    latestFailedVersion: null,
    importStats: { total: 0, succeeded: 0, failed: 0, faqRows: 0, productRows: 0 },
  })),
  importKnowledge: vi.fn(),
  refreshWiki: vi.fn(),
};

function IssueRouteHarness({ onCloseIssue }: { onCloseIssue(): void }) {
  const [routeIssueId, setRouteIssueId] = useState<string | null>(issueId);
  return <WikiLibraryPanel
    brandId="brand-1"
    initialIssueId={routeIssueId}
    onCloseIssue={() => {
      setRouteIssueId(null);
      onCloseIssue();
    }}
    gateway={gateway() as never}
    knowledgeApi={legacyApi as never}
  />;
}

describe("WikiLibraryPanel", () => {
  it("shows source expressions and applies a separate suggestion to an existing FAQ", async () => {
    const aliasRun = {
      id: "alias-run-1",
      workspaceId: "workspace-1",
      brandId: "brand-1",
      status: "completed" as const,
      errorCode: null,
      targetKnowledgeEntryId: faqId,
      targetKnowledgeEntryUpdatedAt: items[0].updatedAt,
      exampleUtterances: ["배송 며칠 걸려요?", "언제 도착해요?", "택배 얼마나 걸려요?"],
      createdAt: items[0].updatedAt,
      updatedAt: items[0].updatedAt,
      completedAt: items[0].updatedAt,
    };
    const applied = {
      ...items[0],
      manualAliases: aliasRun.exampleUtterances,
      effectiveAliases: [...items[0].sourceAliases, ...aliasRun.exampleUtterances],
      updatedAt: "2026-08-12T00:01:00.000Z",
    };
    const api = gateway({
      createFaqAliasSuggestionRun: vi.fn(async () => ({ run: aliasRun })),
      applyFaqAliasSuggestionRun: vi.fn(async () => applied),
    });
    renderPanel(<WikiLibraryPanel
      brandId="brand-1"
      gateway={api as never}
      knowledgeApi={legacyApi as never}
    />);

    await userEvent.click(await screen.findByRole("button", { name: /배송 기간/ }));
    expect(screen.getAllByText("배송 언제 와요?")[0]).toBeVisible();
    await userEvent.click(await screen.findByRole("button", { name: "표현 예시 제안받기" }));
    const proposed = await screen.findByDisplayValue("배송 며칠 걸려요?");
    expect(proposed).toBeEnabled();
    await userEvent.clear(proposed);
    await userEvent.type(proposed, "배송 보통 며칠 걸려요?");
    await userEvent.click(screen.getByRole("button", { name: "제안 적용" }));
    expect(api.applyFaqAliasSuggestionRun).toHaveBeenCalledWith(
      "brand-1",
      faqId,
      aliasRun.id,
      items[0].updatedAt,
      ["배송 보통 며칠 걸려요?", "언제 도착해요?", "택배 얼마나 걸려요?"],
    );
  });

  it("does not expose alias suggestions when the brand rollout capability is disabled", async () => {
    renderPanel(<WikiLibraryPanel
      brandId="brand-1"
      gateway={gateway({
        getFaqCapabilities: vi.fn(async () => ({
          suggestions: false,
          expandedExact: false,
          shadowMatching: false,
          clarification: false,
          clarifyThreshold: 0.8,
        })),
      }) as never}
      knowledgeApi={legacyApi as never}
      category="faq"
    />);

    await screen.findByText(items[0].title);
    expect(screen.queryByRole("button", { name: "표현 예시 제안받기" })).not.toBeInTheDocument();
  });

  it("refreshes the FAQ list after approval without losing a manual edit", async () => {
    const suggestion = {
      id: "suggestion-1",
      workspaceId: "workspace-1",
      brandId: "brand-1",
      runId: "run-1",
      position: 0,
      category: "shipping" as const,
      question: "택배사는 어디인가요?",
      answer: "계약된 택배사로 발송합니다.",
      exampleUtterances: ["택배 어디예요?", "어느 택배사예요?", "배송 업체 알려줘"],
      evidence: [{ sourceType: "brand_core" as const, sourceId: "source-1", label: "브랜드 코어" }],
      confidence: 0.9,
      status: "review" as const,
      duplicateOfKnowledgeEntryId: null,
      approvedKnowledgeEntryId: null,
      reviewedByUserId: null,
      reviewedAt: null,
      createdAt: "2026-08-02T00:00:00.000Z",
      updatedAt: "2026-08-02T00:00:00.000Z",
    };
    const run = {
      id: "run-1",
      workspaceId: "workspace-1",
      brandId: "brand-1",
      status: "review_ready" as const,
      errorCode: null,
      createdByUserId: "user-1",
      startedAt: "2026-08-02T00:00:00.000Z",
      completedAt: "2026-08-02T00:01:00.000Z",
      createdAt: "2026-08-02T00:00:00.000Z",
      updatedAt: "2026-08-02T00:01:00.000Z",
      items: [suggestion],
    };
    const approvedWiki = {
      ...items[0],
      id: "wiki-approved",
      sourceId: "wiki-approved",
      title: suggestion.question,
      content: suggestion.answer,
    };
    const listWikiItems = vi.fn()
      .mockResolvedValueOnce(items)
      .mockResolvedValue([approvedWiki, ...items]);
    const api = gateway({
      listWikiItems,
      getLatestFaqSuggestionRun: vi.fn(async () => ({ run })),
      approveFaqSuggestionItem: vi.fn(async () => ({
        item: { ...suggestion, status: "approved" as const },
        wikiItem: approvedWiki,
      })),
    });
    renderPanel(<KnowledgeCategoryEditorPanel
      brandId="brand-1"
      kind="faq"
      title="FAQ"
      gateway={api as never}
    />);

    await userEvent.click(await screen.findByRole("button", { name: /배송 기간/ }));
    await userEvent.click(screen.getByRole("button", { name: "수정" }));
    await userEvent.type(screen.getByRole("textbox", { name: "내용" }), " 저장 전 수정");
    await userEvent.click(screen.getByRole("button", { name: "FAQ 승인" }));

    await waitFor(() => expect(listWikiItems).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole("button", { name: /택배사는 어디인가요/ })).toBeVisible();
    expect(screen.getByRole("textbox", { name: "내용" })).toHaveValue("영업일 기준 2일 저장 전 수정");
  });

  it("opens an existing category item in view mode and cancel restores the persisted draft", async () => {
    const onDirtyChange = vi.fn();
    const api = gateway();
    renderPanel(<KnowledgeCategoryEditorPanel
      brandId="brand-1"
      kind="faq"
      title="FAQ"
      gateway={api as never}
      onDirtyChange={onDirtyChange}
    />);

    await userEvent.click(await screen.findByRole("button", { name: /배송 기간/ }));
    expect(screen.getByRole("textbox", { name: "제목" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "수정" }));
    await userEvent.clear(screen.getByRole("textbox", { name: "제목" }));
    await userEvent.type(screen.getByRole("textbox", { name: "제목" }), "변경한 배송 기간");
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);

    await userEvent.click(screen.getByRole("button", { name: "취소" }));

    expect(screen.getByRole("textbox", { name: "제목" })).toHaveValue("배송 기간");
    expect(screen.getByRole("textbox", { name: "제목" })).toBeDisabled();
    expect(api.updateWikiItem).not.toHaveBeenCalled();
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
  });

  it("activates and deactivates a category item with status-only patches", async () => {
    const updateWikiItem = vi.fn(async (_brandId: string, _itemId: string, input: { status: "active" | "inactive" }) => ({
      ...items[0],
      status: input.status,
    }));
    const api = gateway({ updateWikiItem });
    renderPanel(<KnowledgeCategoryEditorPanel
      brandId="brand-1"
      kind="faq"
      title="FAQ"
      gateway={api as never}
    />);

    await userEvent.click(await screen.findByRole("button", { name: /배송 기간/ }));
    await userEvent.click(screen.getByRole("button", { name: "비활성화" }));

    expect(updateWikiItem).toHaveBeenLastCalledWith("brand-1", faqId, { status: "inactive" });
    await userEvent.click(await screen.findByRole("button", { name: "활성화" }));
    expect(updateWikiItem).toHaveBeenLastCalledWith("brand-1", faqId, { status: "active" });
  });

  it("lists the how-to projection and creates a how-to draft with the existing Wiki contract", async () => {
    const createWikiItem = vi.fn(async (_brandId: string, input: {
      itemType: "how_to";
      title: string;
      content: string;
    }) => ({
      ...items[1],
      id: "00000000-0000-4000-8000-000000000205",
      title: input.title,
      content: input.content,
    }));
    const api = gateway({ createWikiItem });
    renderPanel(<KnowledgeCategoryEditorPanel
      brandId="brand-1"
      kind="how_to"
      title="이용 방법"
      gateway={api as never}
    />);

    expect(await screen.findByRole("button", { name: /처음 시작하기/ })).toBeVisible();
    expect(screen.queryByRole("button", { name: /배송 기간/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /콘텐츠 검토 가이드/ })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "새 항목" }));
    await userEvent.type(screen.getByRole("textbox", { name: "제목" }), "게시물 예약하기");
    await userEvent.type(screen.getByRole("textbox", { name: "내용" }), "콘텐츠를 선택하고 예약 시간을 지정합니다.");
    await userEvent.click(screen.getByRole("button", { name: "저장" }));

    expect(createWikiItem).toHaveBeenCalledWith("brand-1", {
      contractVersion: "wiki-item.v1",
      itemType: "how_to",
      title: "게시물 예약하기",
      content: "콘텐츠를 선택하고 예약 시간을 지정합니다.",
      provenance: { input: "manual" },
    });
  });

  it("keeps guide, policy, issues, imports, and failed-build recovery under guide controls", async () => {
    const knowledgeApi = {
      ...legacyApi,
      getWikiStatus: vi.fn(async () => ({
        ...await legacyApi.getWikiStatus(),
        latestFailedVersion: {
          id: "wiki-v5",
          status: "failed",
          version: 5,
          sourceCount: 2,
          documentCount: 2,
          knowledgeEntryCount: 2,
          chunkCount: 3,
          activatedAt: null,
          failedAt: "2026-07-27T02:00:00.000Z",
          errorMessage: "embedding_failed",
        },
      })),
    };
    renderPanel(<KnowledgeCategoryEditorPanel
      brandId="brand-1"
      kind="guide"
      title="가이드"
      gateway={gateway() as never}
      knowledgeApi={knowledgeApi as never}
    />);

    const controls = await screen.findByRole("group", { name: "가이드 보조 메뉴" });
    for (const label of ["가이드", "정책", "지식 개선함"]) {
      expect(within(controls).getByRole("button", { name: label })).toBeVisible();
    }
    expect(screen.getByRole("button", { name: /콘텐츠 검토 가이드/ })).toBeVisible();
    expect(screen.queryByRole("button", { name: /환불 정책/ })).not.toBeInTheDocument();

    await userEvent.click(within(controls).getByRole("button", { name: "정책" }));
    expect(await screen.findByRole("button", { name: /환불 정책/ })).toBeVisible();
    expect(screen.queryByRole("button", { name: /콘텐츠 검토 가이드/ })).not.toBeInTheDocument();

    await userEvent.click(within(controls).getByRole("button", { name: "지식 개선함" }));
    expect(await screen.findByRole("button", { name: /배송이 얼마나 걸리나요/ })).toBeVisible();
    expect(screen.getByText("활성 Wiki")).toBeVisible();
    expect(screen.getByText("버전 4")).toBeVisible();
    expect(screen.getByText("최근 Wiki 빌드 실패 · 버전 5")).toBeVisible();
    expect(screen.getByText(/기존 활성 버전은 계속 사용됩니다/)).toBeVisible();
    expect(screen.getByRole("button", { name: "Wiki 다시 만들기" })).toBeVisible();
    expect(screen.getByRole("link", { name: "FAQ 템플릿" })).toHaveAttribute("href", "/faq-template.csv");
  });

  it("keeps a dirty guide open when a secondary control change is cancelled", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    renderPanel(<KnowledgeCategoryEditorPanel
      brandId="brand-1"
      kind="guide"
      title="가이드"
      gateway={gateway() as never}
      knowledgeApi={legacyApi as never}
    />);

    const controls = await screen.findByRole("group", { name: "가이드 보조 메뉴" });
    await userEvent.click(screen.getByRole("button", { name: /콘텐츠 검토 가이드/ }));
    await userEvent.click(screen.getByRole("button", { name: "수정" }));
    await userEvent.type(screen.getByRole("textbox", { name: "내용" }), " 변경");
    await userEvent.click(within(controls).getByRole("button", { name: "정책" }));

    expect(confirm).toHaveBeenCalledWith("저장하지 않은 변경이 있습니다. 이동할까요?");
    expect(within(controls).getByRole("button", { name: "가이드" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /콘텐츠 검토 가이드/ })).toBeVisible();
  });

  it("focuses a same-brand route issue and shows resolved state with its linked item", async () => {
    const onCloseIssue = vi.fn();
    renderPanel(<IssueRouteHarness onCloseIssue={onCloseIssue} />);

    const detail = await screen.findByRole("region", { name: "지식 개선 상세" });
    await waitFor(() => expect(detail).toHaveFocus());
    expect(within(detail).getByText("해결됨")).toBeVisible();
    expect(within(detail).getByRole("button", { name: "연결된 Wiki 항목 열기" })).toBeVisible();
    await userEvent.click(within(detail).getByRole("button", { name: "닫기" }));
    expect(onCloseIssue).toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "지식 개선함" })).toHaveFocus();
  });

  it("filters FAQ, policy, how-to, guide, and issues and keeps product-derived sources read-only", async () => {
    renderPanel(<WikiLibraryPanel
      brandId="brand-1"
      gateway={gateway() as never}
      knowledgeApi={legacyApi as never}
    />);
    await screen.findByText("배송 기간");

    const filters = screen.getByRole("group", { name: "Wiki 필터" });
    for (const label of ["전체", "FAQ", "정책", "사용법", "가이드", "지식 개선함"]) {
      expect(within(filters).getByRole("button", { name: label })).toBeVisible();
    }
    await userEvent.click(screen.getByRole("button", { name: /콘텐츠 운영/ }));
    expect(screen.getByText("제품·서비스에서 관리되는 읽기 전용 항목입니다.")).toBeVisible();
    expect(screen.getByRole("link", { name: "제품·서비스 원본 열기" })).toHaveAttribute(
      "href",
      `/brand-center?tab=products&item=${productId}`,
    );
    expect(screen.getByText("stale · 마지막 성공 wiki-v3")).toBeVisible();
    expect(screen.getByRole("link", { name: "FAQ 템플릿" })).toHaveAttribute("href", "/faq-template.csv");
  });

  it("links an open knowledge issue to a real Wiki item and waits for the build", async () => {
    const openIssue = { ...resolvedIssue, status: "open" as const, sourceKind: null, sourceId: null, activeVersionId: null, buildStatus: "idle" as const, resolvedAt: null };
    const resolveWikiIssue = vi.fn(async () => ({
      ...openIssue,
      status: "pending_build" as const,
      sourceKind: "faq" as const,
      sourceId: faqId,
      buildStatus: "pending" as const,
    }));
    const api = gateway({
      listWikiIssues: vi.fn(async () => [openIssue]),
      resolveWikiIssue,
    });
    renderPanel(<WikiLibraryPanel
      brandId="brand-1"
      initialIssueId={issueId}
      gateway={api as never}
      knowledgeApi={legacyApi as never}
    />);

    await screen.findByRole("region", { name: "지식 개선 상세" });
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "연결할 Wiki 항목" }), faqId);
    await userEvent.click(screen.getByRole("button", { name: "보완 항목 연결" }));

    expect(resolveWikiIssue).toHaveBeenCalledWith("brand-1", issueId, {
      sourceKind: "faq",
      sourceId: faqId,
    });
    await waitFor(() => expect(screen.getAllByText("빌드 반영 중").length).toBeGreaterThan(0));
  });

  it("returns invalid or cross-brand issue IDs to the normal Wiki view with an actionable error", async () => {
    renderPanel(<WikiLibraryPanel
      brandId="brand-1"
      initialIssueId="00000000-0000-4000-8000-000000000999"
      gateway={gateway() as never}
      knowledgeApi={legacyApi as never}
    />);

    expect(await screen.findByText(/이 브랜드에서 해당 개선 항목을 찾을 수 없습니다/)).toBeVisible();
    expect(screen.getByRole("button", { name: "지식 개선함 보기" })).toBeVisible();
    expect(screen.getByText("배송 기간")).toBeVisible();
  });

  it("shows deployment guidance and retry when Wiki management is not deployed", async () => {
    const unavailable = new ApiRequestError({
      status: 500,
      errorCode: "wiki_management_not_configured",
    });
    renderPanel(<WikiLibraryPanel
      brandId="brand-1"
      gateway={gateway({ listWikiItems: vi.fn(async () => { throw unavailable; }) }) as never}
      knowledgeApi={legacyApi as never}
    />);

    expect(await screen.findByText(/서버의 Wiki 관리 API 배포가 먼저 필요합니다/)).toBeVisible();
    expect(screen.getByRole("button", { name: "다시 확인" })).toBeVisible();
    expect(screen.getByRole("link", { name: "FAQ 템플릿" })).toHaveAttribute("href", "/faq-template.csv");
    expect(screen.getByRole("button", { name: "Wiki 다시 만들기" })).toBeVisible();
  });
});
