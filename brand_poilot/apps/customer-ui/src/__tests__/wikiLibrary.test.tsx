import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { useState } from "react";
import { ApiRequestError } from "../lib/apiClient";
import { WikiLibraryPanel } from "../components/brand-center/WikiLibraryPanel";

const faqId = "00000000-0000-4000-8000-000000000201";
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
    createWikiItem: vi.fn(async () => items[0]),
    updateWikiItem: vi.fn(async () => items[0]),
    listWikiIssues: vi.fn(async () => [resolvedIssue]),
    resolveWikiIssue: vi.fn(async () => resolvedIssue),
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
  });
});
