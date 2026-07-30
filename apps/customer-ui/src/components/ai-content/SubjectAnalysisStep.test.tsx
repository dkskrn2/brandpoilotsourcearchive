import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMockAiContentGateway } from "../../features/ai-content/mockAiContentGateway";
import { createInitialAiContentDraft, useAiContentDraft } from "../../features/ai-content/useAiContentDraft";
import type { SubjectAnalysis } from "../../features/ai-content/types";
import { SubjectAnalysisStep } from "./SubjectAnalysisStep";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function analysis(status: SubjectAnalysis["status"]): SubjectAnalysis {
  return {
    id: "analysis-1",
    workspaceId: "workspace-1",
    brandId: "brand-demo",
    subjectType: "product",
    sourceUrl: "https://example.com/product",
    normalizedUrl: "https://example.com/product",
    input: { name: "제품", promotion: "", description: "설명" },
    status,
    facts: [{ key: "title", value: "노출하면 안 되는 분석 결과", sourceUrl: "https://example.com/product" }],
    structuredData: {},
    research: { summary: "노출하면 안 되는 VOC" },
    targets: [],
    appealsByTarget: {},
    selectedImageId: null,
    images: [],
    analysisVersion: 1,
    errorCode: null,
    errorMessage: null,
    createdAt: "2026-07-22T00:00:00.000Z",
    updatedAt: "2026-07-22T00:00:00.000Z",
    completedAt: null,
  };
}

function renderStep(overrides: Record<string, unknown> = {}) {
  const gateway = createMockAiContentGateway();
  const draft = {
    ...createInitialAiContentDraft("card_news"),
    subjectType: "service" as const,
    subjectInput: { sourceUrl: "", name: "서비스", promotion: "월 단위", description: "운영 대행" },
  };
  const props = {
    brandId: "brand-demo",
    gateway,
    draft,
    analysis: null,
    onSubjectType: vi.fn(),
    onSubjectInput: vi.fn(),
    onSubjectAttachments: vi.fn(),
    onPrepareAnalysis: vi.fn(async () => ({ generationId: "generation-1", attachments: [] })),
    onAnalysis: vi.fn(),
    ...overrides,
  };
  return { gateway, props, view: render(<SubjectAnalysisStep {...props} />) };
}

describe("SubjectAnalysisStep", () => {
  it("shows the same optional inputs and analysis attachment groups for services", () => {
    renderStep();

    expect(screen.getByLabelText("제품·서비스 URL (선택)")).toBeVisible();
    expect(screen.getByLabelText("제품 또는 서비스 이름")).toBeVisible();
    expect(screen.getByLabelText("프로모션 또는 이용 조건")).toBeVisible();
    expect(screen.getByLabelText("추가 설명")).toBeVisible();
    expect(screen.getByText("제품·서비스 이미지")).toBeVisible();
    expect(screen.getByText("설명 문서")).toBeVisible();
    expect(screen.getByRole("button", { name: "분석하고 소구점 만들기" })).toBeEnabled();
  });

  it("does not call the v1 cache or render analysis facts, VOC, targets, or a result panel", async () => {
    const gateway = createMockAiContentGateway();
    const getCached = vi.spyOn(gateway, "getCachedSubjectAnalysis");
    renderStep({ gateway, analysis: analysis("ready") });

    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 350)); });

    expect(getCached).not.toHaveBeenCalled();
    expect(screen.queryByText("분석 결과")).not.toBeInTheDocument();
    expect(screen.queryByText("확인된 사실")).not.toBeInTheDocument();
    expect(screen.queryByText("고객 언어·대안")).not.toBeInTheDocument();
    expect(screen.queryByText("추천 타깃 미리보기")).not.toBeInTheDocument();
    expect(screen.queryByText("노출하면 안 되는 분석 결과")).not.toBeInTheDocument();
    expect(screen.queryByText("노출하면 안 되는 VOC")).not.toBeInTheDocument();
  });

  it("shows exactly one status message while polling and completes on ready", async () => {
    vi.useFakeTimers();
    const gateway = createMockAiContentGateway();
    vi.spyOn(gateway, "requestSubjectAnalysis").mockResolvedValue(analysis("extracting"));
    vi.spyOn(gateway, "getSubjectAnalysis")
      .mockResolvedValueOnce(analysis("analyzing"))
      .mockResolvedValueOnce(analysis("generating_appeals" as SubjectAnalysis["status"]))
      .mockResolvedValueOnce(analysis("ready"));
    const onAnalysis = vi.fn();
    const { props } = renderStep({ gateway, onAnalysis });

    fireEvent.click(screen.getByRole("button", { name: "분석하고 소구점 만들기" }));
    await act(async () => { await Promise.resolve(); });
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(screen.getByRole("status")).toHaveTextContent("제품·서비스 자료 확인 중");

    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    expect(screen.getByRole("status")).toHaveTextContent("고객과 시장 분석 중");
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    expect(screen.getByRole("status")).toHaveTextContent("타깃·소구점 생성 중");
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });

    expect(onAnalysis).toHaveBeenCalledWith(expect.objectContaining({ status: "ready" }));
  });

  it("forwards edits and type switches without starting analysis", async () => {
    const user = userEvent.setup();
    const { props } = renderStep();

    await user.click(screen.getByRole("radio", { name: "제품" }));
    await user.type(screen.getByLabelText("제품·서비스 URL (선택)"), "https://example.com/product");

    expect(props.onSubjectType).toHaveBeenCalledWith("product");
    expect(props.onSubjectInput).toHaveBeenCalled();
    expect(props.onAnalysis).not.toHaveBeenCalled();
  });

  it("clears prior analysis, target, and appeal when product or service changes", () => {
    const { result } = renderHook(() => useAiContentDraft("card_news"));
    const target = { id: "target-1", name: "기존 타깃", traits: [], painPoints: [], purchaseMotivations: [], uspEvidence: [] };
    const appeal = { id: "appeal-1", targetId: target.id, title: "기존 소구점", description: "설명", evidenceType: "product_fact" as const, connectionReason: "근거", sources: [] };

    act(() => result.current.setSubjectType("product"));
    act(() => result.current.setSubjectAnalysis(analysis("ready")));
    act(() => result.current.setTarget(target));
    act(() => result.current.setAppeal(appeal));
    act(() => result.current.setSubjectType("service"));

    expect(result.current.subjectAnalysis).toBeNull();
    expect(result.current.draft.subjectAnalysisId).toBeNull();
    expect(result.current.draft.subjectAnalysisVersion).toBeNull();
    expect(result.current.draft.selectedTarget).toBeNull();
    expect(result.current.draft.selectedAppeal).toBeNull();
  });
});
