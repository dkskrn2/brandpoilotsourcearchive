import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AnalysisStep } from "../components/brand-center-preview/AnalysisStep";
import { PreviewShell } from "../components/brand-center-preview/PreviewShell";
import { SourceIntakeStep } from "../components/brand-center-preview/SourceIntakeStep";
import { Alert } from "../components/ui/Alert";
import {
  ANALYSIS_POLL_DEADLINE_MS,
  ANALYSIS_POLL_MAX_REQUESTS,
  ANALYSIS_POLL_TIMEOUT_ERROR_CODE,
  ANALYSIS_REQUEST_TIMEOUT_MS,
  isRetryableAnalysisPollError,
  nextAnalysisPollDelay,
} from "../features/brand-intelligence/boundedAnalysisPoller";
import { brandIntelligenceGateway } from "../features/brand-intelligence/brandIntelligenceGateway";
import type {
  BrandAnalysis,
  BrandIntelligenceGateway,
  BrandIntelligenceResult,
} from "../features/brand-intelligence/types";
import { createPreviewState } from "../features/brand-center-preview/previewFixtures";
import type {
  PreviewAsyncState,
  PreviewBrandCore,
  PreviewFile,
  PreviewStep,
} from "../features/brand-center-preview/types";
import { useAuth } from "../lib/auth";
import { DEMO_BRAND_ID } from "../lib/apiClient";

export interface BrandIntelligenceStorageScope {
  workspaceId: string;
  userId: string;
}

interface LiveBrandCenterOnboardingProps {
  gateway?: BrandIntelligenceGateway;
  brandId?: string;
  storageScope?: BrandIntelligenceStorageScope;
}

const pendingStatuses: BrandAnalysis["status"][] = ["queued", "extracting", "analyzing"];

function storageKey(scope: BrandIntelligenceStorageScope, brandId: string) {
  return `brand-pilot:brand-intelligence:${scope.workspaceId}:${scope.userId}:${brandId}`;
}

function previewCore(result: BrandIntelligenceResult): PreviewBrandCore {
  return {
    oneLine: result.companyOverview,
    description: result.businessDescription,
    target: result.primaryTarget,
    customerProblem: result.differentiators,
    primaryValue: result.coreAppeal,
    differentiators: result.differentiators.split("\n").filter(Boolean),
    tone: [],
    priorityMessages: [],
  };
}

function errorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("scanned_pdf_not_supported")) {
    return "텍스트가 없는 스캔 PDF는 분석할 수 없습니다. 텍스트 PDF로 다시 첨부해 주세요.";
  }
  return "자료를 처리하지 못했습니다. 입력과 API 상태를 확인한 뒤 다시 시도해 주세요.";
}

function LiveResultEditor({
  draft,
  saving,
  error,
  onChange,
  onComplete,
}: {
  draft: BrandIntelligenceResult;
  saving: boolean;
  error: string | null;
  onChange(draft: BrandIntelligenceResult): void;
  onComplete(): void;
}) {
  const update = <K extends keyof BrandIntelligenceResult>(
    key: K,
    value: BrandIntelligenceResult[K],
  ) => onChange({ ...draft, [key]: value });
  const required = [
    draft.companyOverview,
    draft.businessDescription,
    draft.primaryCategory.name,
    draft.primaryTarget,
    draft.differentiators,
    draft.coreAppeal,
  ].every((value) => value.trim());

  return (
    <section className="brand-center-preview__card" aria-labelledby="live-analysis-title">
      <div className="brand-center-preview__card-heading">
        <p className="brand-center-preview__eyebrow">STEP 2</p>
        <h2 id="live-analysis-title">AI 분석 결과를 확인하고 수정하세요</h2>
        <p>수정한 결과는 완료할 때 서버에 저장한 뒤 브랜드 기준으로 확정합니다.</p>
      </div>

      <div className="brand-center-preview__analysis-surface">
        <div className="brand-center-preview__result-grid">
          {([
            ["companyOverview", "기업 개요"],
            ["businessDescription", "사업 소개"],
            ["primaryTarget", "핵심 타깃"],
            ["differentiators", "차별점"],
            ["coreAppeal", "핵심 소구점"],
          ] as const).map(([key, label]) => (
            <article key={key}>
              <header><span>{label}</span></header>
              <textarea
                aria-label={label}
                rows={key === "businessDescription" ? 4 : 3}
                value={draft[key]}
                onChange={(event) => update(key, event.currentTarget.value)}
              />
            </article>
          ))}
        </div>

        <details className="brand-center-preview__legacy-details" open>
          <summary>업종 상세 검토</summary>
          <div className="brand-center-preview__result-grid">
            <article>
              <header><span>대표 분야</span></header>
              <input
                aria-label="대표 분야"
                value={draft.primaryCategory.name}
                onChange={(event) => update("primaryCategory", {
                  ...draft.primaryCategory,
                  name: event.currentTarget.value,
                })}
              />
            </article>
            <article>
              <header><span>세부 분야</span></header>
              <textarea
                aria-label="세부 분야"
                rows={3}
                value={draft.subcategories.map((item) => item.name).join("\n")}
                onChange={(event) => update(
                  "subcategories",
                  event.currentTarget.value.split("\n").map((name) => name.trim())
                    .filter(Boolean).map((name) => {
                      const existing = draft.subcategories.find((item) => item.name === name);
                      return existing ?? { code: null, name };
                  }),
                )}
              />
            </article>
          </div>
        </details>

        {error ? <Alert title="저장하지 못했습니다" variant="bad">{error}</Alert> : null}
        <div className="brand-center-preview__section-actions">
          <button
            type="button"
            className="brand-center-preview__primary-action"
            disabled={!required || saving}
            onClick={onComplete}
          >
            {saving ? "저장하는 중" : "완료"}
          </button>
        </div>
      </div>
    </section>
  );
}

export function LiveBrandCenterOnboarding({
  gateway = brandIntelligenceGateway,
  brandId: brandIdProp,
  storageScope: storageScopeProp,
}: LiveBrandCenterOnboardingProps) {
  const { session } = useAuth();
  const brandId = brandIdProp ?? session?.brand.id ?? DEMO_BRAND_ID;
  const scope = storageScopeProp ?? (session ? {
    workspaceId: session.workspace.id,
    userId: session.user.id,
  } : null);
  const persistenceKey = useMemo(
    () => scope ? storageKey(scope, brandId) : null,
    [brandId, scope?.userId, scope?.workspaceId],
  );
  const [searchParams, setSearchParams] = useSearchParams();
  const queryAnalysisId = searchParams.get("analysisId");
  const restoredAnalysisId = persistenceKey
    ? window.localStorage.getItem(persistenceKey)
    : null;
  const [analysisId, setAnalysisId] = useState(queryAnalysisId ?? restoredAnalysisId);
  const [currentStep, setCurrentStep] = useState<PreviewStep>(
    analysisId ? "analysis" : "sources",
  );
  const [sourceUrl, setSourceUrl] = useState("");
  const [files, setFiles] = useState<PreviewFile[]>([]);
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [analysisState, setAnalysisState] = useState<PreviewAsyncState>(
    analysisId ? "loading" : "idle",
  );
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [draft, setDraft] = useState<BrandIntelligenceResult | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const requestRef = useRef(0);

  const clearResumePointer = useCallback(() => {
    if (persistenceKey) window.localStorage.removeItem(persistenceKey);
    setAnalysisId(null);
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.delete("analysisId");
      return next;
    }, { replace: true });
  }, [persistenceKey, setSearchParams]);

  useEffect(() => {
    if (analysisId && persistenceKey) {
      window.localStorage.setItem(persistenceKey, analysisId);
    }
  }, [analysisId, persistenceKey]);

  useEffect(() => {
    if (!analysisId || queryAnalysisId === analysisId) return;
    const next = new URLSearchParams(searchParams);
    next.set("analysisId", analysisId);
    setSearchParams(next, { replace: true });
  }, [analysisId, queryAnalysisId, searchParams, setSearchParams]);

  useEffect(() => {
    if (!analysisId) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let activeController: AbortController | null = null;
    let visibilityAbortedController: AbortController | null = null;
    let completedRequests = 0;
    let pollingFinished = false;
    const runDeadlineAt = Date.now() + ANALYSIS_POLL_DEADLINE_MS;

    const remainingTime = () => Math.max(0, runDeadlineAt - Date.now());
    const budgetAvailable = () => (
      completedRequests < ANALYSIS_POLL_MAX_REQUESTS
      && remainingTime() > 0
    );
    const finishBudget = () => {
      if (stopped || pollingFinished) return;
      pollingFinished = true;
      setAnalysisState("failed");
      setAnalysisError("분석 상태 확인 시간이 초과되었습니다. 잠시 후 다시 접속해 주세요.");
    };
    let poll: () => Promise<void>;
    const scheduleNext = () => {
      if (stopped || pollingFinished || document.hidden) return;
      if (!budgetAvailable()) {
        finishBudget();
        return;
      }
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = undefined;
        if (!budgetAvailable()) {
          finishBudget();
          return;
        }
        if (!document.hidden) void poll();
      }, Math.min(
        nextAnalysisPollDelay(Math.max(0, completedRequests - 1)),
        remainingTime(),
      ));
    };

    poll = async () => {
      if (stopped || pollingFinished || document.hidden || !budgetAvailable() || activeController) {
        if (!stopped && !pollingFinished && !document.hidden && !budgetAvailable()) finishBudget();
        return;
      }
      const controller = new AbortController();
      activeController = controller;
      let timedOut = false;
      let deadlineExpired = false;
      let next: BrandAnalysis | undefined;
      let failure: unknown;
      timer = setTimeout(() => {
        timer = undefined;
        timedOut = true;
        deadlineExpired = Date.now() >= runDeadlineAt;
        controller.abort();
      }, Math.min(ANALYSIS_REQUEST_TIMEOUT_MS, remainingTime()));
      try {
        next = await gateway.getAnalysis(brandId, analysisId, controller.signal);
      } catch (error) {
        failure = timedOut
          ? Object.assign(new Error("analysis poll request timed out"), {
              code: ANALYSIS_POLL_TIMEOUT_ERROR_CODE,
            })
          : error;
      } finally {
        if (timer !== undefined) clearTimeout(timer);
        timer = undefined;
        if (activeController === controller) activeController = null;
        completedRequests += 1;
      }
      if (stopped) return;
      const abortedForVisibility = visibilityAbortedController === controller;
      if (abortedForVisibility) {
        visibilityAbortedController = null;
        if (!document.hidden) scheduleNext();
        return;
      }
      if (deadlineExpired || remainingTime() <= 0) {
        finishBudget();
        return;
      }

      if (failure) {
        if (isRetryableAnalysisPollError(failure)) {
          setAnalysisState("loading");
          setAnalysisError(null);
          scheduleNext();
        } else {
          pollingFinished = true;
          setAnalysisState("failed");
          setAnalysisError(errorMessage(failure));
          clearResumePointer();
        }
        return;
      }
      if (!next) return;

      setSourceUrl(next.input.ownedUrl ?? "");
      if (pendingStatuses.includes(next.status)) {
        setAnalysisState("loading");
        scheduleNext();
        return;
      }
      if (next.status === "review_ready" && next.effectiveResult) {
        pollingFinished = true;
        setDraft(structuredClone(next.effectiveResult));
        setAnalysisState("succeeded");
        setCurrentStep("analysis");
        setAnalysisError(null);
        return;
      }
      if (next.status === "confirmed") {
        pollingFinished = true;
        setConfirmed(true);
        setCurrentStep("generation");
        clearResumePointer();
        return;
      }
      pollingFinished = true;
      setAnalysisState("failed");
      setAnalysisError(next.errorMessage ?? "분석을 완료하지 못했습니다.");
      clearResumePointer();
    };

    const handleVisibilityChange = () => {
      if (pollingFinished) return;
      if (document.hidden) {
        if (timer !== undefined) {
          clearTimeout(timer);
          timer = undefined;
        }
        if (activeController) {
          visibilityAbortedController = activeController;
          activeController.abort();
        }
        return;
      }
      if (!activeController && timer === undefined) scheduleNext();
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    if (document.hidden) {
      scheduleNext();
    } else {
      void poll();
    }
    return () => {
      stopped = true;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      if (timer !== undefined) clearTimeout(timer);
      activeController?.abort();
    };
  }, [analysisId, brandId, clearResumePointer, gateway]);

  function validateSources() {
    const normalized = sourceUrl.trim();
    if (!normalized && files.length === 0) {
      setSourceError("웹사이트 URL 또는 문서 파일을 등록해 주세요.");
      return false;
    }
    if (normalized) {
      try {
        if (new URL(normalized).protocol !== "https:") throw new Error("not_https");
      } catch {
        setSourceError("https://로 시작하는 올바른 URL을 입력해 주세요.");
        return false;
      }
    }
    setSourceError(null);
    return true;
  }

  async function startAnalysis() {
    if (!validateSources() || analysisState === "loading") return;
    const request = ++requestRef.current;
    setCurrentStep("analysis");
    setAnalysisState("loading");
    setAnalysisError(null);
    try {
      const uploadSessionId = crypto.randomUUID();
      const uploadIds: string[] = [];
      for (const item of files) {
        uploadIds.push(await gateway.uploadFile(brandId, uploadSessionId, item.file));
      }
      const created = await gateway.requestAnalysis(brandId, {
        ownedUrl: sourceUrl.trim() || null,
        uploadIds,
        idempotencyKey: crypto.randomUUID(),
      });
      if (requestRef.current !== request) return;
      setAnalysisId(created.id);
      if (persistenceKey) window.localStorage.setItem(persistenceKey, created.id);
    } catch (error) {
      if (requestRef.current !== request) return;
      setAnalysisState("failed");
      setAnalysisError(errorMessage(error));
    }
  }

  async function complete() {
    if (!analysisId || !draft || saving) return;
    setSaving(true);
    setAnalysisError(null);
    try {
      await gateway.updateDraft(brandId, analysisId, draft);
      await gateway.confirm(brandId, analysisId);
      clearResumePointer();
      setConfirmed(true);
      setCurrentStep("generation");
    } catch (error) {
      setAnalysisError(errorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  const fallbackCore = draft ? previewCore(draft) : createPreviewState().brandCore;
  const canEnter = (step: PreviewStep) => {
    if (step === "sources") return true;
    if (step === "analysis") return Boolean(analysisId || sourceUrl.trim() || files.length);
    return step === "generation" && confirmed;
  };

  return (
    <PreviewShell
      currentStep={currentStep}
      sourceUrl={sourceUrl}
      sourceFiles={files}
      canEnterStep={canEnter}
      onStepSelected={(step) => {
        if (canEnter(step)) setCurrentStep(step);
      }}
    >
      {currentStep === "sources" ? (
        <SourceIntakeStep
          url={sourceUrl}
          files={files}
          error={sourceError}
          onUrlChanged={(url) => {
            setSourceUrl(url);
            setSourceError(null);
          }}
          onFilesAdded={(selected) => {
            setFiles((current) => [...current, ...selected]);
            setSourceError(null);
          }}
          onFileRemoved={(id) => setFiles((current) => current.filter((file) => file.id !== id))}
          onAnalyze={() => void startAnalysis()}
        />
      ) : null}
      {currentStep === "analysis" && analysisState !== "succeeded" ? (
        <AnalysisStep
          state={analysisState}
          error={analysisError}
          brandCore={fallbackCore}
          brandCoreApproved={false}
          knowledge={[]}
          onBrandCoreChange={() => undefined}
          onKnowledgeChange={() => undefined}
          onRetry={() => {
            clearResumePointer();
            setCurrentStep("sources");
            setAnalysisState("idle");
          }}
          onComplete={() => undefined}
        />
      ) : null}
      {currentStep === "analysis" && analysisState === "succeeded" && draft ? (
        <LiveResultEditor
          draft={draft}
          saving={saving}
          error={analysisError}
          onChange={setDraft}
          onComplete={() => void complete()}
        />
      ) : null}
      {currentStep === "generation" && confirmed ? (
        <section className="brand-center-preview__card">
          <div className="brand-center-preview__card-heading">
            <p className="brand-center-preview__eyebrow">완료</p>
            <h2>브랜드 준비가 완료되었습니다</h2>
            <p>확정한 브랜드 정보가 콘텐츠 생성과 브랜드 운영 기준에 저장되었습니다.</p>
          </div>
        </section>
      ) : null}
    </PreviewShell>
  );
}
