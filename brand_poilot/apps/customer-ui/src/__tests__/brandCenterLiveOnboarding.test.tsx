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

const storageScope = { workspaceId: "workspace-1", userId: "user-1" };
const persistenceKey = "brand-pilot:brand-intelligence:workspace-1:user-1:brand-1";

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

function analysis(status: BrandAnalysis["status"]): BrandAnalysis {
  const hasResult = status === "review_ready" || status === "confirmed";
  return {
    id: "analysis-1",
    brandId: "brand-1",
    status,
    input: { ownedUrl: "https://brand.example", uploadIds: ["upload-1"] },
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

function gateway(overrides: Partial<BrandIntelligenceGateway> = {}): BrandIntelligenceGateway {
  return {
    getCurrent: vi.fn().mockResolvedValue(null),
    getAnalysis: vi.fn().mockResolvedValue(analysis("review_ready")),
    requestAnalysis: vi.fn().mockResolvedValue(analysis("queued")),
    uploadFile: vi.fn().mockResolvedValue("upload-1"),
    updateDraft: vi.fn().mockImplementation(async (_brandId, _analysisId, draft) => ({
      ...analysis("review_ready"),
      editedResult: draft,
      effectiveResult: draft,
    })),
    confirm: vi.fn().mockResolvedValue(analysis("confirmed")),
    ...overrides,
  };
}

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}{location.search}</output>;
}

function renderLive(
  api: BrandIntelligenceGateway,
  initialEntry = "/onboarding/brand-intelligence?analysisId=analysis-1",
  scope = storageScope,
) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <BrandCenterPreviewPage
        mode="live"
        gateway={api}
        brandId="brand-1"
        storageScope={scope}
      />
      <LocationProbe />
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

    await user.type(screen.getByRole("textbox", { name: "브랜드 웹사이트 URL" }), "https://brand.example");
    const file = new File(["brand facts"], "facts.txt", { type: "text/plain" });
    await user.upload(screen.getByLabelText("브랜드 자료 파일 선택"), file);
    await user.click(screen.getByRole("button", { name: "AI 분석 시작" }));

    await waitFor(() => expect(api.uploadFile).toHaveBeenCalledWith(
      "brand-1",
      expect.any(String),
      file,
    ));
    expect(api.requestAnalysis).toHaveBeenCalledWith("brand-1", {
      ownedUrl: "https://brand.example",
      uploadIds: ["upload-1"],
      idempotencyKey: expect.any(String),
    });
    expect(localStorage.getItem(persistenceKey)).toBe("analysis-1");

    await act(() => vi.advanceTimersByTimeAsync(2_000));
    expect(screen.getByDisplayValue("기존 기업 개요")).toBeInTheDocument();
    expect(screen.getByDisplayValue("소프트웨어")).toBeInTheDocument();
    expect(screen.getByDisplayValue("브랜드 운영")).toBeInTheDocument();
    expect(screen.queryByLabelText("대표 분야 코드")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("추가 확인이 필요한 정보")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("경쟁사 1 이름")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("경쟁사 1 근거 URL")).not.toBeInTheDocument();
    expect(screen.queryByText("기업 근거")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "근거 보기" })).not.toBeInTheDocument();

    await user.clear(screen.getByLabelText("기업 개요"));
    await user.type(screen.getByLabelText("기업 개요"), "수정 기업 개요");
    await user.click(screen.getByRole("button", { name: "완료" }));

    await waitFor(() => expect(api.updateDraft).toHaveBeenCalledWith(
      "brand-1",
      "analysis-1",
      expect.objectContaining({
        companyOverview: "수정 기업 개요",
        primaryCategory: { code: "software", name: "소프트웨어" },
        subcategories: [{ code: "brand-ops", name: "브랜드 운영" }],
        competitors: result.competitors,
        evidence: result.evidence,
        sourceGaps: result.sourceGaps,
      }),
    ));
    expect(api.confirm).toHaveBeenCalledWith("brand-1", "analysis-1");
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

  it("stops after 63 completed requests and retains the resume pointer", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-29T00:00:00.000Z"));
    vi.spyOn(Math, "random").mockReturnValue(0);
    const getAnalysis = vi.fn().mockResolvedValue(analysis("queued"));
    renderLive(gateway({ getAnalysis }));
    await flushEffects();

    for (let completed = 1; completed < ANALYSIS_POLL_MAX_REQUESTS; completed += 1) {
      await act(() => vi.advanceTimersByTimeAsync(
        nextAnalysisPollDelay(completed - 1, () => 0),
      ));
    }
    expect(getAnalysis).toHaveBeenCalledTimes(ANALYSIS_POLL_MAX_REQUESTS);
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    expect(getAnalysis).toHaveBeenCalledTimes(ANALYSIS_POLL_MAX_REQUESTS);
    expect(localStorage.getItem(persistenceKey)).toBe("analysis-1");
  });

  it("stops at the fifteen-minute deadline before the request budget and retains the pointer", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-29T00:00:00.000Z"));
    vi.spyOn(Math, "random").mockReturnValue(1);
    const getAnalysis = vi.fn().mockResolvedValue(analysis("queued"));
    renderLive(gateway({ getAnalysis }));
    await flushEffects();

    await act(() => vi.advanceTimersByTimeAsync(ANALYSIS_POLL_DEADLINE_MS + 20_000));
    const callsAtDeadline = getAnalysis.mock.calls.length;
    expect(callsAtDeadline).toBeGreaterThan(1);
    expect(callsAtDeadline).toBeLessThan(ANALYSIS_POLL_MAX_REQUESTS);
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    expect(getAnalysis).toHaveBeenCalledTimes(callsAtDeadline);
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

  it.each(["failed", "confirmed"] as const)(
    "clears the resume pointer when the server reports %s",
    async (status) => {
      renderLive(gateway({
        getAnalysis: vi.fn().mockResolvedValue(analysis(status)),
      }));
      await flushEffects();

      expect(localStorage.getItem(persistenceKey)).toBeNull();
      expect(screen.getByTestId("location")).not.toHaveTextContent("analysisId");
    },
  );

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
