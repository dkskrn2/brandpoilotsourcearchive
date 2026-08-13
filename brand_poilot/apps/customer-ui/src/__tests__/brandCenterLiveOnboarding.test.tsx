import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ANALYSIS_POLL_DEADLINE_MS,
  ANALYSIS_POLL_MAX_REQUESTS,
  ANALYSIS_REQUEST_TIMEOUT_MS,
  nextAnalysisPollDelay,
} from "../features/brand-intelligence/boundedAnalysisPoller";
import type {
  BrandAnalysis,
  BrandIntelligenceGateway,
  BrandIntelligenceResult,
} from "../features/brand-intelligence/types";
import { ApiRequestError } from "../lib/apiClient";
import { BrandCenterPreviewPage } from "../pages/BrandCenterPreviewPage";
import type { ContentCategory } from "../types";

const storageScope = { workspaceId: "workspace-1", userId: "user-1" };
const persistenceKey = "brand-pilot:brand-intelligence:workspace-1:user-1:brand-1";
const contentCategories: ContentCategory[] = [{
  code: "software",
  name: "소프트웨어",
  recommendedHashtags: [],
  subcategories: [{ code: "brand-ops", name: "브랜드 운영" }],
}];

const result: BrandIntelligenceResult = {
  contractVersion: "brand-intelligence-result.v1",
  companyOverview: "기존 기업 개요",
  businessDescription: "기존 사업 소개",
  primaryCategory: { code: "software", name: "소프트웨어" },
  subcategories: [{ code: "brand-ops", name: "브랜드 운영" }],
  primaryTarget: "마케팅 팀",
  differentiators: "승인 기반 운영",
  coreAppeal: "일관된 콘텐츠",
  competitors: [{
    name: "경쟁사 A",
    description: "비교 설명",
    sourceUrls: ["https://competitor.example/evidence"],
  }],
  evidence: [{
    field: "companyOverview",
    claim: "기업 근거",
    sourceId: "owned-url",
    sourceUrl: "https://brand.example/about",
  }],
  sourceGaps: ["가격 정보 부족"],
};

const suggestedResult: BrandIntelligenceResult = {
  contractVersion: "brand-intelligence-result.v2",
  companyNameSuggestion: { name: "분석 제안 회사", sourceFactIds: ["fact-company"] },
  oneLineDefinition: "운영 파트너",
  companyOverview: "기존 기업 개요",
  businessDescription: "기존 사업 소개",
  primaryCategory: { code: "software", name: "소프트웨어" },
  subcategories: [{ code: "brand-ops", name: "브랜드 운영" }],
  primaryTarget: "마케팅 팀",
  secondaryTargets: [],
  customerNeeds: [],
  valueProposition: "일관된 운영",
  differentiators: ["승인 기반 운영"],
  coreAppeal: "일관된 콘텐츠",
  supportingAppeals: [],
  offerings: [],
  faqSuggestions: [],
  keywords: [],
  observedTone: null,
  competitors: [],
  marketContext: [],
  evidence: [],
  sourceGaps: [],
};

function analysis(status: BrandAnalysis["status"]): BrandAnalysis {
  const hasResult = status === "review_ready" || status === "confirmed";
  return {
    id: "analysis-1",
    brandId: "brand-1",
    status,
    input: { companyName: "테스트 회사", ownedUrl: "https://brand.example", uploadIds: ["upload-1"] },
    result: hasResult ? result : null,
    editedResult: null,
    effectiveResult: hasResult ? result : null,
    errorCode: status === "failed" ? "brand_analysis_failed" : null,
    errorMessage: status === "failed" ? "분석 실패" : null,
    createdAt: "2026-07-29T00:00:00.000Z",
    updatedAt: "2026-07-29T00:00:00.000Z",
    confirmedAt: status === "confirmed" ? "2026-07-29T00:01:00.000Z" : null,
  };
}

type TestGateway = BrandIntelligenceGateway & {
  listContentCategories: ReturnType<typeof vi.fn>;
};

function gateway(overrides: Partial<BrandIntelligenceGateway> = {}): TestGateway {
  return {
    getCurrent: vi.fn().mockResolvedValue(null),
    getWorkflow: vi.fn().mockResolvedValue(null),
    getAnalysis: vi.fn().mockResolvedValue(analysis("review_ready")),
    requestAnalysis: vi.fn().mockResolvedValue(analysis("queued")),
    uploadFile: vi.fn().mockResolvedValue("upload-1"),
    updateDraft: vi.fn().mockImplementation(async (_brandId, _analysisId, draft) => ({
      ...analysis("review_ready"),
      editedResult: draft,
      effectiveResult: draft,
    })),
    confirm: vi.fn().mockResolvedValue(analysis("confirmed")),
    listContentCategories: vi.fn().mockResolvedValue(contentCategories),
    ...overrides,
  } as TestGateway;
}

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}{location.search}</output>;
}

function LiveView({
  api,
  brandId = "brand-1",
  scope = storageScope,
}: {
  api: BrandIntelligenceGateway;
  brandId?: string;
  scope?: typeof storageScope;
}) {
  return (
    <>
      <BrandCenterPreviewPage
        mode="live"
        gateway={api}
        brandId={brandId}
        storageScope={scope}
      />
      <LocationProbe />
    </>
  );
}

function renderLive(
  api: BrandIntelligenceGateway,
  initialEntry = "/onboarding/brand-intelligence?analysisId=analysis-1",
  scope = storageScope,
) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <LiveView api={api} scope={scope} />
    </MemoryRouter>,
  );
}

async function flushEffects() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function setHidden(hidden: boolean) {
  Object.defineProperty(document, "hidden", {
    configurable: true,
    value: hidden,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("live Brand Center onboarding", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useRealTimers();
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: false,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("opens a server review-ready workflow before local storage and locks Step 1", async () => {
    localStorage.setItem(persistenceKey, "stored-analysis");
    const getWorkflow = vi.fn().mockResolvedValue(analysis("review_ready"));
    const getAnalysis = vi.fn().mockResolvedValue(analysis("review_ready"));
    renderLive(
      gateway({ getWorkflow, getAnalysis }),
      "/onboarding/brand-intelligence",
    );

    expect(await screen.findByText("AI 분석 결과를 확인하고 수정하세요")).toBeVisible();
    expect(screen.getByRole("button", { name: "1. 자료 등록" }))
      .toHaveAttribute("aria-disabled", "true");
    expect(getWorkflow).toHaveBeenCalledTimes(1);
    expect(getAnalysis).not.toHaveBeenCalled();
    expect(localStorage.getItem(persistenceKey)).toBe("analysis-1");
  });

  it("loads registry categories for the live review", async () => {
    const review = {
      ...analysis("review_ready"),
      result: suggestedResult,
      effectiveResult: suggestedResult,
    };
    const api = gateway({ getWorkflow: vi.fn().mockResolvedValue(review) });
    renderLive(
      api,
      "/onboarding/brand-intelligence",
    );

    expect(await screen.findByRole("combobox", { name: "분석 결과 대표 분야" }))
      .toHaveValue("software");
    expect(screen.getByRole("checkbox", { name: "브랜드 운영" })).toBeChecked();
    expect(screen.queryByRole("textbox", { name: "직접 입력 세부 분야" })).not.toBeInTheDocument();
    expect(api.listContentCategories).toHaveBeenCalledTimes(1);
  });

  it("blocks category confirmation when the registry request fails", async () => {
    const review = {
      ...analysis("review_ready"),
      result: suggestedResult,
      effectiveResult: suggestedResult,
    };
    renderLive(
      gateway({
        getWorkflow: vi.fn().mockResolvedValue(review),
        listContentCategories: vi.fn().mockRejectedValue(new Error("category registry unavailable")),
      }),
      "/onboarding/brand-intelligence",
    );

    expect(await screen.findByText("분야 목록을 불러오지 못했습니다.")).toBeVisible();
    expect(screen.getByRole("combobox", { name: "분석 결과 대표 분야" })).toBeDisabled();
    expect(screen.queryByRole("textbox", { name: "대표 분야" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "확인하고 저장" })).toBeDisabled();
  });

  it("resumes a pending server workflow without rendering Step 1 and locks sources", async () => {
    vi.useFakeTimers();
    const getWorkflow = vi.fn().mockResolvedValue(analysis("queued"));
    const getAnalysis = vi.fn().mockResolvedValue(analysis("queued"));
    renderLive(
      gateway({ getWorkflow, getAnalysis }),
      "/onboarding/brand-intelligence",
    );
    await flushEffects();

    expect(screen.getByText("자료를 읽는 중")).toBeVisible();
    expect(screen.queryByRole("textbox", { name: "브랜드 웹사이트 URL" }))
      .not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "1. 자료 등록" }))
      .toHaveAttribute("aria-disabled", "true");
    expect(getWorkflow).toHaveBeenCalledTimes(1);
    expect(getAnalysis).toHaveBeenCalledWith("brand-1", "analysis-1", expect.anything());
  });

  it("shows Step 1 when the server has no workflow or scoped resume pointer", async () => {
    const getWorkflow = vi.fn().mockResolvedValue(null);
    renderLive(
      gateway({ getWorkflow }),
      "/onboarding/brand-intelligence",
    );

    expect(await screen.findByRole("textbox", { name: "브랜드 웹사이트 URL" }))
      .toBeVisible();
    expect(screen.getByRole("button", { name: "1. 자료 등록" }))
      .not.toHaveAttribute("aria-disabled");
    expect(getWorkflow).toHaveBeenCalledTimes(1);
  });

  it("shows the completed state instead of resuming a stale analysis after confirmation", async () => {
    localStorage.setItem(persistenceKey, "stale-analysis");
    const getWorkflow = vi.fn().mockResolvedValue(null);
    const getCurrent = vi.fn().mockResolvedValue(analysis("confirmed"));
    const getAnalysis = vi.fn();

    renderLive(
      gateway({ getWorkflow, getCurrent, getAnalysis }),
      "/onboarding/brand-intelligence?analysisId=stale-analysis",
    );

    expect(await screen.findByText("브랜드 준비가 완료되었습니다")).toBeVisible();
    expect(screen.queryByText("자료를 읽는 중")).not.toBeInTheDocument();
    expect(getAnalysis).not.toHaveBeenCalled();
    expect(localStorage.getItem(persistenceKey)).toBeNull();
    expect(screen.getByTestId("location")).not.toHaveTextContent("analysisId");
  });

  it("starts a fresh intake when confirmed users explicitly request reanalysis", async () => {
    localStorage.setItem(persistenceKey, "stale-analysis");
    const getAnalysis = vi.fn();
    const getOnboarding = vi.fn().mockResolvedValue({
      companyName: "Growthline",
      companyNameState: "confirmed",
      activeAnalysis: null,
    });

    renderLive(
      gateway({
        getCurrent: vi.fn().mockResolvedValue(analysis("confirmed")),
        getOnboarding,
        getAnalysis,
      }),
      "/onboarding/brand-intelligence?from=brand-center&analysisId=stale-analysis",
    );

    expect(screen.queryByRole("textbox", { name: "회사명" })).not.toBeInTheDocument();
    expect(await screen.findByRole("textbox", { name: "브랜드 웹사이트 URL" }))
      .toHaveValue("https://brand.example");
    expect(getAnalysis).not.toHaveBeenCalled();
    expect(localStorage.getItem(persistenceKey)).toBeNull();
    expect(screen.getByTestId("location")).toHaveTextContent("from=brand-center");
    expect(screen.getByTestId("location")).not.toHaveTextContent("analysisId");
  });

  it("keeps Step 1 locked when workflow lookup fails and retries the lookup", async () => {
    localStorage.setItem(persistenceKey, "stored-analysis");
    const getWorkflow = vi.fn()
      .mockRejectedValueOnce(new Error("workflow unavailable"))
      .mockResolvedValueOnce(null);
    const getAnalysis = vi.fn().mockResolvedValue(analysis("review_ready"));
    const user = userEvent.setup();
    renderLive(
      gateway({ getWorkflow, getAnalysis }),
      "/onboarding/brand-intelligence",
    );

    expect(await screen.findByText(
      "진행 중인 분석 상태를 확인하지 못했습니다. 다시 시도해 주세요.",
    )).toBeVisible();
    expect(screen.queryByRole("textbox", { name: "브랜드 웹사이트 URL" }))
      .not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "1. 자료 등록" }))
      .toHaveAttribute("aria-disabled", "true");
    expect(getAnalysis).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "다시 분석" }));

    expect(await screen.findByText("AI 분석 결과를 확인하고 수정하세요")).toBeVisible();
    expect(getWorkflow).toHaveBeenCalledTimes(2);
    expect(getAnalysis).toHaveBeenCalledWith(
      "brand-1",
      "stored-analysis",
      expect.anything(),
    );
  });

  it("adopts the valid server workflow when a query analysis is stale", async () => {
    const serverWorkflow = {
      ...analysis("review_ready"),
      id: "server-analysis",
    };
    const getWorkflow = vi.fn().mockResolvedValue(serverWorkflow);
    const getAnalysis = vi.fn().mockRejectedValue(
      new ApiRequestError({ status: 404, errorCode: "brand_analysis_not_found" }),
    );
    renderLive(
      gateway({ getWorkflow, getAnalysis }),
      "/onboarding/brand-intelligence?analysisId=stale-query",
    );

    expect(await screen.findByText("AI 분석 결과를 확인하고 수정하세요")).toBeVisible();
    expect(screen.getByTestId("location")).toHaveTextContent("analysisId=server-analysis");
    expect(localStorage.getItem(persistenceKey)).toBe("server-analysis");
    expect(getAnalysis).toHaveBeenCalledTimes(1);
    expect(getAnalysis).toHaveBeenCalledWith(
      "brand-1",
      "stale-query",
      expect.anything(),
    );
  });

  it.each(["failed", "confirmed"] as const)(
    "adopts the valid server workflow when a query analysis reaches %s",
    async (terminalStatus) => {
      const serverWorkflow = {
        ...analysis("review_ready"),
        id: "server-analysis",
      };
      const getWorkflow = vi.fn().mockResolvedValue(serverWorkflow);
      const getAnalysis = vi.fn().mockResolvedValue({
        ...analysis(terminalStatus),
        id: "stale-query",
      });
      renderLive(
        gateway({ getWorkflow, getAnalysis }),
        "/onboarding/brand-intelligence?analysisId=stale-query",
      );

      expect(await screen.findByText("AI 분석 결과를 확인하고 수정하세요")).toBeVisible();
      expect(screen.getByTestId("location")).toHaveTextContent("analysisId=server-analysis");
      expect(localStorage.getItem(persistenceKey)).toBe("server-analysis");
      expect(getAnalysis).toHaveBeenCalledTimes(1);
    },
  );

  it("resets brand-owned state before bootstrapping a changed brand and scope", async () => {
    const secondWorkflow = deferred<BrandAnalysis | null>();
    const secondResult: BrandIntelligenceResult = {
      ...result,
      companyOverview: "두 번째 브랜드 개요",
    };
    const getWorkflow = vi.fn((requestedBrandId: string) => (
      requestedBrandId === "brand-1"
        ? Promise.resolve(null)
        : secondWorkflow.promise
    ));
    const api = gateway({
      getWorkflow,
      getAnalysis: vi.fn().mockResolvedValue(analysis("review_ready")),
    });
    const user = userEvent.setup();
    const view = render(
      <MemoryRouter initialEntries={["/onboarding/brand-intelligence"]}>
        <LiveView api={api} />
      </MemoryRouter>,
    );

    await user.type(
      await screen.findByRole("textbox", { name: "브랜드 웹사이트 URL" }),
      "https://first-brand.example",
    );
    await user.upload(
      screen.getByLabelText("브랜드 자료 파일 선택"),
      new File(["first brand"], "first-brand.txt", { type: "text/plain" }),
    );
    await user.click(screen.getByRole("button", { name: "AI 분석 시작" }));
    expect(await screen.findByDisplayValue("기존 기업 개요")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "확인하고 저장" }));
    expect(await screen.findByText("브랜드 준비가 완료되었습니다")).toBeVisible();

    view.rerender(
      <MemoryRouter initialEntries={["/onboarding/brand-intelligence"]}>
        <LiveView
          api={api}
          brandId="brand-2"
          scope={{ workspaceId: "workspace-2", userId: "user-2" }}
        />
      </MemoryRouter>,
    );
    await flushEffects();

    expect(screen.getByText("자료를 읽는 중")).toBeVisible();
    expect(screen.queryByText("브랜드 준비가 완료되었습니다")).not.toBeInTheDocument();
    expect(screen.queryByText("https://first-brand.example")).not.toBeInTheDocument();
    expect(screen.queryByText("1개 선택됨")).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue("기존 기업 개요")).not.toBeInTheDocument();

    await act(async () => {
      secondWorkflow.resolve({
        ...analysis("review_ready"),
        id: "brand-2-analysis",
        brandId: "brand-2",
        input: { ownedUrl: "https://second-brand.example", uploadIds: [] },
        result: secondResult,
        effectiveResult: secondResult,
      });
      await secondWorkflow.promise;
    });

    expect(await screen.findByDisplayValue("두 번째 브랜드 개요")).toBeVisible();
    expect(getWorkflow).toHaveBeenCalledWith("brand-1");
    expect(getWorkflow).toHaveBeenCalledWith("brand-2");
  });

  it("uploads real files, polls until review, preserves the complete Step 2 draft, then saves and confirms", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.spyOn(Math, "random").mockReturnValue(0);
    const api = gateway({
      getAnalysis: vi.fn()
        .mockResolvedValueOnce(analysis("queued"))
        .mockResolvedValue(analysis("review_ready")),
    });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderLive(api, "/onboarding/brand-intelligence");

    expect(screen.queryByRole("textbox", { name: "회사명" })).not.toBeInTheDocument();
    await user.type(
      await screen.findByRole("textbox", { name: "브랜드 웹사이트 URL" }),
      "https://brand.example",
    );
    const file = new File(["brand facts"], "facts.txt", { type: "text/plain" });
    await user.upload(screen.getByLabelText("브랜드 자료 파일 선택"), file);
    await user.click(screen.getByRole("button", { name: "AI 분석 시작" }));

    expect(api.requestAnalysis).toHaveBeenCalledWith("brand-1", {
      ownedUrl: "https://brand.example",
      files: [file],
      idempotencyKey: expect.any(String),
    });
    expect(localStorage.getItem(persistenceKey)).toBe("analysis-1");

    await act(() => vi.advanceTimersByTimeAsync(2_000));
    expect(screen.getByDisplayValue("기존 기업 개요")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "분석 결과 대표 분야" })).toHaveValue("software");
    expect(screen.getByRole("checkbox", { name: "브랜드 운영" })).toBeChecked();
    expect(screen.queryByLabelText("대표 분야 코드")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("추가 확인이 필요한 정보")).not.toBeInTheDocument();
    expect(screen.getByLabelText("경쟁사 1 이름")).toBeInTheDocument();
    expect(screen.queryByLabelText("경쟁사 1 근거 URL")).not.toBeInTheDocument();
    const companyInput = screen.getByRole("textbox", { name: "회사명" });
    const reviewPanel = screen.getByRole("heading", { name: "분석 결과 확인" })
      .closest(".panel");
    expect(reviewPanel).toContainElement(companyInput);
    expect(screen.queryByRole("heading", { name: "근거와 추가 확인 항목" }))
      .not.toBeInTheDocument();
    expect(screen.queryByText(/기업 근거/)).not.toBeInTheDocument();
    expect(screen.queryByText(/가격 정보 부족/)).not.toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "경쟁사" }));
    expect(screen.getAllByRole("link", { name: "근거 보기" }).length).toBeGreaterThan(0);
    await user.click(screen.getByRole("tab", { name: "브랜드 핵심" }));

    await user.clear(companyInput);
    await user.type(companyInput, "수정 회사");
    await user.clear(screen.getByLabelText("기업 개요"));
    await user.type(screen.getByLabelText("기업 개요"), "수정 기업 개요");
    await user.click(screen.getByRole("button", { name: "확인하고 저장" }));

    await waitFor(() => expect(api.confirm).toHaveBeenCalledWith(
      "brand-1",
      "analysis-1",
      "수정 회사",
      expect.objectContaining({
        companyOverview: "수정 기업 개요",
        primaryCategory: { code: "software", name: "소프트웨어" },
        subcategories: [{ code: "brand-ops", name: "브랜드 운영" }],
        competitors: result.competitors,
        evidence: result.evidence,
        sourceGaps: result.sourceGaps,
      }),
    ));
    expect(localStorage.getItem(persistenceKey)).toBeNull();
  });

  it("schedules completed polls at exact 2, 4, 8, and 15 second delays", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-29T00:00:00.000Z"));
    vi.spyOn(Math, "random").mockReturnValue(0);
    const getAnalysis = vi.fn().mockResolvedValue(analysis("queued"));
    renderLive(gateway({ getAnalysis }));
    await flushEffects();
    expect(getAnalysis).toHaveBeenCalledTimes(1);

    for (const delay of [2_000, 4_000, 8_000, 15_000]) {
      await act(() => vi.advanceTimersByTimeAsync(delay - 1));
      const before = getAnalysis.mock.calls.length;
      await act(() => vi.advanceTimersByTimeAsync(1));
      expect(getAnalysis).toHaveBeenCalledTimes(before + 1);
    }
  });

  it("keeps polling through the full 20-minute active window and retains the resume pointer", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-29T00:00:00.000Z"));
    vi.spyOn(Math, "random").mockReturnValue(0);
    const getAnalysis = vi.fn().mockResolvedValue(analysis("queued"));
    renderLive(gateway({ getAnalysis }));
    await flushEffects();

    await act(() => vi.advanceTimersByTimeAsync(20 * 60_000 + 1));
    expect(getAnalysis.mock.calls.length).toBeGreaterThan(63);
    expect(ANALYSIS_POLL_MAX_REQUESTS).toBeGreaterThan(getAnalysis.mock.calls.length);
    expect(localStorage.getItem(persistenceKey)).toBe("analysis-1");
  });

  it("does not mistake a legitimate fifteen-minute queue wait for a failed analysis", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-29T00:00:00.000Z"));
    vi.spyOn(Math, "random").mockReturnValue(1);
    const getAnalysis = vi.fn().mockResolvedValue(analysis("queued"));
    renderLive(gateway({ getAnalysis }));
    await flushEffects();

    await act(() => vi.advanceTimersByTimeAsync(15 * 60_000 + 20_000));
    const callsAfterFifteenMinutes = getAnalysis.mock.calls.length;
    expect(callsAfterFifteenMinutes).toBeGreaterThan(1);
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    expect(getAnalysis.mock.calls.length).toBeGreaterThan(callsAfterFifteenMinutes);
    expect(screen.queryByText(/분석 상태 확인 시간이 초과되었습니다/)).not.toBeInTheDocument();
    expect(localStorage.getItem(persistenceKey)).toBe("analysis-1");
  });

  it("never starts a second GET while the first request is unresolved", async () => {
    vi.useFakeTimers();
    const getAnalysis = vi.fn().mockReturnValue(new Promise<BrandAnalysis>(() => undefined));
    renderLive(gateway({ getAnalysis }));
    await flushEffects();

    await act(() => vi.advanceTimersByTimeAsync(ANALYSIS_REQUEST_TIMEOUT_MS - 1));
    expect(getAnalysis).toHaveBeenCalledTimes(1);
  });

  it("aborts a hung request after fifteen seconds", async () => {
    vi.useFakeTimers();
    let observedSignal: AbortSignal | undefined;
    const getAnalysis = vi.fn((_brandId, _analysisId, signal?: AbortSignal) => {
      observedSignal = signal;
      return new Promise<BrandAnalysis>((_resolve, reject) => {
        signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      });
    });
    renderLive(gateway({ getAnalysis }));
    await flushEffects();
    expect(observedSignal?.aborted).toBe(false);

    await act(() => vi.advanceTimersByTimeAsync(ANALYSIS_REQUEST_TIMEOUT_MS));
    expect(observedSignal?.aborted).toBe(true);
  });

  it("cancels a hidden-tab timer and resumes with a delayed visible-tab poll", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
    const getAnalysis = vi.fn().mockResolvedValue(analysis("queued"));
    renderLive(gateway({ getAnalysis }));
    await flushEffects();
    expect(getAnalysis).toHaveBeenCalledTimes(1);

    act(() => setHidden(true));
    await act(() => vi.advanceTimersByTimeAsync(30_000));
    expect(getAnalysis).toHaveBeenCalledTimes(1);

    act(() => setHidden(false));
    await act(() => vi.advanceTimersByTimeAsync(1_999));
    expect(getAnalysis).toHaveBeenCalledTimes(1);
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(getAnalysis).toHaveBeenCalledTimes(2);
  });

  it("aborts an active hidden-tab GET, ignores its stale result, and resumes after a delayed visible poll", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
    const firstRequest = deferred<BrandAnalysis>();
    let firstSignal: AbortSignal | undefined;
    const getAnalysis = vi.fn()
      .mockImplementationOnce((_brandId, _analysisId, signal?: AbortSignal) => {
        firstSignal = signal;
        return firstRequest.promise;
      })
      .mockResolvedValue(analysis("review_ready"));
    renderLive(gateway({ getAnalysis }));
    await flushEffects();
    expect(firstSignal?.aborted).toBe(false);

    act(() => setHidden(true));
    expect(firstSignal?.aborted).toBe(true);
    firstRequest.resolve(analysis("review_ready"));
    await flushEffects();
    await act(() => vi.advanceTimersByTimeAsync(30_000));
    expect(getAnalysis).toHaveBeenCalledTimes(1);
    expect(screen.queryByDisplayValue("기존 기업 개요")).not.toBeInTheDocument();
    expect(localStorage.getItem(persistenceKey)).toBe("analysis-1");

    act(() => setHidden(false));
    await act(() => vi.advanceTimersByTimeAsync(1_999));
    expect(getAnalysis).toHaveBeenCalledTimes(1);
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(getAnalysis).toHaveBeenCalledTimes(2);
    expect(screen.getByDisplayValue("기존 기업 개요")).toBeInTheDocument();
  });

  it("caps a delayed resume at the exact wall-clock deadline without starting another GET", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-29T00:00:00.000Z"));
    vi.spyOn(Math, "random").mockReturnValue(0);
    setHidden(true);
    const getAnalysis = vi.fn().mockResolvedValue(analysis("queued"));
    renderLive(gateway({ getAnalysis }));
    await flushEffects();

    await act(() => vi.advanceTimersByTimeAsync(ANALYSIS_POLL_DEADLINE_MS - 1_000));
    act(() => setHidden(false));
    await act(() => vi.advanceTimersByTimeAsync(999));
    expect(getAnalysis).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(getAnalysis).not.toHaveBeenCalled();
    expect(screen.getByText(/분석 상태 확인 시간이 초과되었습니다/)).toBeInTheDocument();
    expect(localStorage.getItem(persistenceKey)).toBe("analysis-1");
  });

  it("caps an active request timeout and aborts exactly at the wall-clock deadline", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-29T00:00:00.000Z"));
    vi.spyOn(Math, "random").mockReturnValue(0);
    setHidden(true);
    let observedSignal: AbortSignal | undefined;
    const getAnalysis = vi.fn((_brandId, _analysisId, signal?: AbortSignal) => {
      observedSignal = signal;
      return new Promise<BrandAnalysis>((_resolve, reject) => {
        signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      });
    });
    renderLive(gateway({ getAnalysis }));
    await flushEffects();

    await act(() => vi.advanceTimersByTimeAsync(ANALYSIS_POLL_DEADLINE_MS - 10_000));
    act(() => setHidden(false));
    await act(() => vi.advanceTimersByTimeAsync(2_000));
    expect(getAnalysis).toHaveBeenCalledTimes(1);
    expect(observedSignal?.aborted).toBe(false);
    await act(() => vi.advanceTimersByTimeAsync(7_999));
    expect(observedSignal?.aborted).toBe(false);
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(observedSignal?.aborted).toBe(true);
    expect(getAnalysis).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(persistenceKey)).toBe("analysis-1");
  });

  it("aborts the active GET on unmount", async () => {
    let observedSignal: AbortSignal | undefined;
    const getAnalysis = vi.fn((_brandId, _analysisId, signal?: AbortSignal) => {
      observedSignal = signal;
      return new Promise<BrandAnalysis>((_resolve, reject) => {
        signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      });
    });
    const view = renderLive(gateway({ getAnalysis }));
    await flushEffects();

    view.unmount();
    expect(observedSignal?.aborted).toBe(true);
  });

  it("retries a transient 500 but terminates and clears the pointer on 400", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
    const retryingGet = vi.fn()
      .mockRejectedValueOnce(new ApiRequestError({ status: 500, errorCode: "server_error" }))
      .mockResolvedValue(analysis("queued"));
    const retrying = renderLive(gateway({ getAnalysis: retryingGet }));
    await flushEffects();
    expect(localStorage.getItem(persistenceKey)).toBe("analysis-1");
    await act(() => vi.advanceTimersByTimeAsync(2_000));
    expect(retryingGet).toHaveBeenCalledTimes(2);
    retrying.unmount();

    localStorage.clear();
    const terminalGet = vi.fn().mockRejectedValue(
      new ApiRequestError({ status: 400, errorCode: "invalid_request" }),
    );
    renderLive(gateway({ getAnalysis: terminalGet }));
    await flushEffects();
    expect(terminalGet).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(persistenceKey)).toBeNull();
  });

  it("clears a stale 404 resume pointer from storage, query, and state", async () => {
    const getAnalysis = vi.fn().mockRejectedValue(
      new ApiRequestError({ status: 404, errorCode: "brand_analysis_not_found" }),
    );
    renderLive(gateway({ getAnalysis }));
    await flushEffects();

    expect(localStorage.getItem(persistenceKey)).toBeNull();
    expect(screen.getByTestId("location")).toHaveTextContent("/onboarding/brand-intelligence");
    expect(screen.getByTestId("location")).not.toHaveTextContent("analysisId");
    expect(getAnalysis).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["failed", true],
    ["confirmed", false],
  ] as const)(
    "handles the resume pointer when the server reports %s",
    async (status, shouldRetain) => {
      renderLive(gateway({
        getAnalysis: vi.fn().mockResolvedValue(analysis(status)),
      }));
      await flushEffects();

      expect(localStorage.getItem(persistenceKey)).toBe(shouldRetain ? "analysis-1" : null);
      if (shouldRetain) {
        expect(screen.getByTestId("location")).toHaveTextContent("analysisId");
      } else {
        expect(screen.getByTestId("location")).not.toHaveTextContent("analysisId");
      }
    },
  );

  it("lets a failed run be discarded and returns to a completely blank Step 1", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const cancel = vi.fn().mockResolvedValue(analysis("cancelled"));
    const user = userEvent.setup();
    renderLive(gateway({
      getAnalysis: vi.fn().mockResolvedValue(analysis("failed")),
      cancel,
    }));
    await flushEffects();

    expect(await screen.findByText("분석 실패")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "입력 다시하기" }));

    expect(cancel).toHaveBeenCalledWith("brand-1", "analysis-1");
    expect(screen.queryByRole("textbox", { name: "회사명" })).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "브랜드 웹사이트 URL" })).toHaveValue("");
    expect(localStorage.getItem(persistenceKey)).toBeNull();
    expect(screen.getByTestId("location")).not.toHaveTextContent("analysisId");
  });

  it("uses the analyzed company suggestion only in the review step", async () => {
    renderLive(gateway({
      getAnalysis: vi.fn().mockResolvedValue({
        ...analysis("review_ready"),
        input: { ownedUrl: "https://brand.example", uploadIds: [] },
        result: suggestedResult,
        effectiveResult: suggestedResult,
      }),
    }));
    await flushEffects();

    expect(await screen.findByRole("textbox", { name: "회사명" }))
      .toHaveValue("분석 제안 회사");
  });

  it("keeps the resume pointer while review is ready", async () => {
    renderLive(gateway());
    await flushEffects();
    expect(screen.getByDisplayValue("기존 기업 개요")).toBeInTheDocument();
    expect(localStorage.getItem(persistenceKey)).toBe("analysis-1");
  });

  it("does not restart polling or overwrite an unsaved review draft after visibility changes", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
    const getAnalysis = vi.fn().mockResolvedValue(analysis("review_ready"));
    renderLive(gateway({ getAnalysis }));
    await flushEffects();

    const overview = screen.getByLabelText("기업 개요");
    fireEvent.change(overview, { target: { value: "저장 전 수정 내용" } });
    expect(getAnalysis).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(persistenceKey)).toBe("analysis-1");

    act(() => setHidden(true));
    act(() => setHidden(false));
    await act(() => vi.advanceTimersByTimeAsync(2_000));

    expect(getAnalysis).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("기업 개요")).toHaveValue("저장 전 수정 내용");
    expect(localStorage.getItem(persistenceKey)).toBe("analysis-1");
  });

  it("gives the query identifier precedence and isolates scoped local storage", async () => {
    localStorage.setItem(persistenceKey, "stored-analysis");
    const otherKey = "brand-pilot:brand-intelligence:workspace-2:user-2:brand-1";
    localStorage.setItem(otherKey, "other-analysis");
    const getAnalysis = vi.fn().mockResolvedValue(analysis("review_ready"));
    renderLive(gateway({ getAnalysis }), "/onboarding/brand-intelligence?analysisId=query-analysis");
    await flushEffects();

    expect(getAnalysis).toHaveBeenCalledWith(
      "brand-1",
      "query-analysis",
      expect.anything(),
    );
    expect(localStorage.getItem(persistenceKey)).toBe("query-analysis");
    expect(localStorage.getItem(otherKey)).toBe("other-analysis");
  });
});
