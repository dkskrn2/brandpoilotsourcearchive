import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AnalysisStep } from "../components/brand-center-preview/AnalysisStep";
import { PreviewShell } from "../components/brand-center-preview/PreviewShell";
import { SourceIntakeStep } from "../components/brand-center-preview/SourceIntakeStep";
import { BrandAnalysisReviewStep } from "../components/brand-intelligence/BrandAnalysisReviewStep";
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
import { ApiRequestError, DEMO_BRAND_ID } from "../lib/apiClient";

export interface BrandIntelligenceStorageScope {
  workspaceId: string;
  userId: string;
}

interface LiveBrandCenterOnboardingProps {
  gateway?: BrandIntelligenceGateway;
  brandId?: string;
  storageScope?: BrandIntelligenceStorageScope;
}

const pendingStatuses: BrandAnalysis["status"][] = [
  "queued", "accepting_uploads", "waiting_for_resource", "extracting",
  "analyzing", "running", "finalizing", "cancel_requested", "purging",
];

function storageKey(scope: BrandIntelligenceStorageScope, brandId: string) {
  return `brand-pilot:brand-intelligence:${scope.workspaceId}:${scope.userId}:${brandId}`;
}

function previewCore(result: BrandIntelligenceResult): PreviewBrandCore {
  const isV2 = result.contractVersion === "brand-intelligence-result.v2";
  return {
    oneLine: (isV2 ? result.oneLineDefinition : result.companyOverview) ?? "",
    description: result.businessDescription ?? "",
    target: result.primaryTarget ?? "",
    customerProblem: isV2 ? result.customerNeeds.join("\n") : result.differentiators,
    primaryValue: (isV2 ? result.valueProposition : result.coreAppeal) ?? "",
    differentiators: isV2
      ? result.differentiators
      : result.differentiators.split("\n").filter(Boolean),
    tone: isV2 && result.observedTone ? [result.observedTone.summary] : [],
    priorityMessages: isV2 ? result.supportingAppeals : [],
  };
}

function errorMessage(error: unknown) {
  const errorCode = error instanceof ApiRequestError
    ? error.errorCode
    : error instanceof Error
      ? error.message
      : "";
  if (errorCode?.includes("scanned_pdf_not_supported")) {
    return "텍스트가 없는 스캔 PDF는 분석할 수 없습니다. 텍스트 PDF로 다시 첨부해 주세요.";
  }
  if (errorCode?.includes("brand_analysis_company_name_conflict")) {
    return "이 워크스페이스에 같은 회사명이 이미 있습니다. 다른 회사명을 입력해 주세요.";
  }
  if (errorCode?.includes("brand_analysis_owned_page_success_threshold_not_met")) {
    return "자사 사이트에서 중요 페이지를 충분히 읽지 못했습니다. URL을 확인한 뒤 다시 시도해 주세요.";
  }
  if (errorCode?.includes("analysis_deadline_exceeded")
    || errorCode?.includes("brand_intelligence_codex_timeout")
    || errorCode?.includes("brand_intelligence_stage_timeout")) {
    return "최대 분석 시간 20분을 초과했습니다. 잠시 후 다시 시도해 주세요.";
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
  return (
    <>
      <section className="brand-center-preview__card-heading">
        <h2>AI 분석 결과를 확인하고 수정하세요</h2>
      </section>
      <BrandAnalysisReviewStep
        draft={draft}
        saving={saving}
        error={error}
        onChange={onChange}
        onConfirm={async () => onComplete()}
      />
    </>
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
  const stateOwnerKey = scope
    ? `${scope.workspaceId}:${scope.userId}:${brandId}`
    : `anonymous:${brandId}`;

  return (
    <LiveBrandCenterOnboardingState
      key={stateOwnerKey}
      gateway={gateway}
      brandId={brandId}
      storageScope={scope}
    />
  );
}

function LiveBrandCenterOnboardingState({
  gateway,
  brandId,
  storageScope: scope,
}: {
  gateway: BrandIntelligenceGateway;
  brandId: string;
  storageScope: BrandIntelligenceStorageScope | null;
}) {
  const persistenceKey = useMemo(
    () => scope ? storageKey(scope, brandId) : null,
    [brandId, scope?.userId, scope?.workspaceId],
  );
  const [searchParams, setSearchParams] = useSearchParams();
  const queryAnalysisId = searchParams.get("analysisId");
  const queryAnalysisIdRef = useRef(queryAnalysisId);
  const serverWorkflowRef = useRef<BrandAnalysis | null>(null);
  const [analysisId, setAnalysisId] = useState<string | null>(null);
  const [currentStep, setCurrentStep] = useState<PreviewStep>("analysis");
  const [companyName, setCompanyName] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [files, setFiles] = useState<PreviewFile[]>([]);
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [analysisState, setAnalysisState] = useState<PreviewAsyncState>("loading");
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [draft, setDraft] = useState<BrandIntelligenceResult | null>(null);
  const [activeAnalysis, setActiveAnalysis] = useState<BrandAnalysis | null>(null);
  const [saving, setSaving] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [bootstrapComplete, setBootstrapComplete] = useState(false);
  const [bootstrapAttempt, setBootstrapAttempt] = useState(0);
  const [pollingRequired, setPollingRequired] = useState(false);
  const requestRef = useRef(0);

  const resumeWorkflow = useCallback((workflow: BrandAnalysis) => {
    setActiveAnalysis(workflow);
    setAnalysisId(workflow.id);
    if (persistenceKey) window.localStorage.setItem(persistenceKey, workflow.id);
    setCurrentStep("analysis");
    setSourceUrl(workflow.input.ownedUrl ?? "");
    if (workflow.input.companyName) setCompanyName(workflow.input.companyName);
    setDraft(null);
    setConfirmed(false);
    setAnalysisError(null);
    if (workflow.status === "review_ready" && workflow.effectiveResult) {
      setDraft(structuredClone(workflow.effectiveResult));
      setAnalysisState("succeeded");
      setPollingRequired(false);
      return;
    }
    setAnalysisState("loading");
    setPollingRequired(true);
  }, [persistenceKey]);

  const recoverFromTerminalAnalysis = useCallback((staleAnalysisId: string) => {
    if (queryAnalysisIdRef.current === staleAnalysisId) {
      queryAnalysisIdRef.current = null;
    }
    const workflow = serverWorkflowRef.current;
    if (!workflow || workflow.id === staleAnalysisId) return false;
    resumeWorkflow(workflow);
    return true;
  }, [resumeWorkflow]);

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
    let cancelled = false;
    const restorePointer = () => (
      persistenceKey ? window.localStorage.getItem(persistenceKey) : null
    );
    const resumeById = (nextAnalysisId: string | null) => {
      setAnalysisError(null);
      if (!nextAnalysisId) {
        setAnalysisId(null);
        setCurrentStep("sources");
        setAnalysisState("idle");
        setPollingRequired(false);
        return;
      }
      setAnalysisId(nextAnalysisId);
      setCurrentStep("analysis");
      setAnalysisState("loading");
      setPollingRequired(true);
    };

    const contextRequest = gateway.getOnboarding
      ? gateway.getOnboarding(brandId)
      : gateway.getWorkflow(brandId).then((activeAnalysis) => ({
          companyName: "",
          companyNameState: "provisional" as const,
          activeAnalysis,
        }));
    void contextRequest.then((context) => {
      if (cancelled) return;
      const workflow = context.activeAnalysis;
      setCompanyName(context.companyName);
      serverWorkflowRef.current = workflow;
      if (queryAnalysisIdRef.current) {
        resumeById(queryAnalysisIdRef.current);
      } else if (workflow) {
        resumeWorkflow(workflow);
      } else {
        resumeById(restorePointer());
      }
      setBootstrapComplete(true);
    }).catch(() => {
      if (cancelled) return;
      setAnalysisId(null);
      setCurrentStep("analysis");
      setAnalysisState("failed");
      setAnalysisError("진행 중인 분석 상태를 확인하지 못했습니다. 다시 시도해 주세요.");
      setPollingRequired(false);
      setBootstrapComplete(false);
    });

    return () => {
      cancelled = true;
    };
  }, [bootstrapAttempt, brandId, gateway, persistenceKey, resumeWorkflow]);

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
    if (!bootstrapComplete || !pollingRequired || !analysisId) return;
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
          if (recoverFromTerminalAnalysis(analysisId)) return;
          setAnalysisState("failed");
          setAnalysisError(errorMessage(failure));
          clearResumePointer();
        }
        return;
      }
      if (!next) return;

      setSourceUrl(next.input.ownedUrl ?? "");
      setActiveAnalysis(next);
      if (next.input.companyName) setCompanyName(next.input.companyName);
      if (pendingStatuses.includes(next.status)) {
        setAnalysisState("loading");
        scheduleNext();
        return;
      }
      if (next.status === "review_ready" && next.effectiveResult) {
        pollingFinished = true;
        setPollingRequired(false);
        setDraft(structuredClone(next.effectiveResult));
        setAnalysisState("succeeded");
        setCurrentStep("analysis");
        setAnalysisError(null);
        return;
      }
      if (next.status === "confirmed") {
        pollingFinished = true;
        if (recoverFromTerminalAnalysis(analysisId)) return;
        setPollingRequired(false);
        setConfirmed(true);
        setCurrentStep("generation");
        clearResumePointer();
        return;
      }
      if (next.status === "failed") {
        pollingFinished = true;
        if (recoverFromTerminalAnalysis(analysisId)) return;
        setPollingRequired(false);
        setAnalysisState("failed");
        setAnalysisError(next.errorMessage ?? "분석을 완료하지 못했습니다.");
        return;
      }
      pollingFinished = true;
      if (recoverFromTerminalAnalysis(analysisId)) return;
      setPollingRequired(false);
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
  }, [
    analysisId,
    bootstrapComplete,
    brandId,
    clearResumePointer,
    gateway,
    pollingRequired,
    recoverFromTerminalAnalysis,
  ]);

  function validateSources() {
    const normalizedCompanyName = companyName.normalize("NFKC").trim();
    if (!normalizedCompanyName || Array.from(normalizedCompanyName).length > 100
      || /[\u0000-\u001f\u007f]/.test(normalizedCompanyName)) {
      setSourceError("회사명을 1~100자로 입력해 주세요.");
      return false;
    }
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
      const created = await gateway.requestAnalysis(brandId, {
        companyName: companyName.normalize("NFKC").trim(),
        ownedUrl: sourceUrl.trim() || null,
        files: files.map((item) => item.file),
        idempotencyKey: crypto.randomUUID(),
      });
      if (requestRef.current !== request) return;
      setAnalysisId(created.id);
      setActiveAnalysis(created);
      setPollingRequired(true);
      if (persistenceKey) window.localStorage.setItem(persistenceKey, created.id);
    } catch (error) {
      if (requestRef.current !== request) return;
      setAnalysisState("failed");
      setAnalysisError(errorMessage(error));
    }
  }

  async function complete() {
    const normalizedCompanyName = companyName.normalize("NFKC").trim();
    if (!analysisId || !draft || saving || !normalizedCompanyName) return;
    setSaving(true);
    setAnalysisError(null);
    try {
      await gateway.confirm(brandId, analysisId, normalizedCompanyName, draft);
      clearResumePointer();
      setConfirmed(true);
      setCurrentStep("generation");
    } catch (error) {
      setAnalysisError(errorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  async function cancelAnalysis() {
    if (!analysisId || cancelling) return;
    if (!window.confirm("분석을 취소하면 수집 중인 자료와 분석 결과가 삭제됩니다. 계속할까요?")) return;
    setCancelling(true);
    setAnalysisError(null);
    try {
      await gateway.cancel!(brandId, analysisId);
      clearResumePointer();
      setActiveAnalysis(null);
      setCompanyName("");
      setSourceUrl("");
      setFiles([]);
      setDraft(null);
      setCurrentStep("sources");
      setAnalysisState("idle");
      setPollingRequired(false);
    } catch (error) {
      setAnalysisError(errorMessage(error));
    } finally {
      setCancelling(false);
    }
  }

  async function retryAnalysis() {
    if (!analysisId || saving) return;
    setSaving(true);
    setAnalysisError(null);
    try {
      const retried = await gateway.retry!(brandId, analysisId);
      setActiveAnalysis(retried);
      setAnalysisState("loading");
      setPollingRequired(true);
    } catch (error) {
      setAnalysisError(errorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  const fallbackCore = draft ? previewCore(draft) : createPreviewState().brandCore;
  const canEnter = (step: PreviewStep) => {
    if (step === "sources") {
      return bootstrapComplete && !analysisId && analysisState !== "loading";
    }
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
          companyName={companyName}
          url={sourceUrl}
          files={files}
          error={sourceError}
          onCompanyNameChanged={(value) => {
            setCompanyName(value);
            setSourceError(null);
          }}
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
            if (activeAnalysis?.status === "failed") {
              void retryAnalysis();
              return;
            }
            if (!bootstrapComplete) {
              setAnalysisState("loading");
              setAnalysisError(null);
              setBootstrapAttempt((attempt) => attempt + 1);
              return;
            }
            clearResumePointer();
            setCurrentStep("sources");
            setAnalysisState("idle");
          }}
          onReset={activeAnalysis?.status === "failed" && analysisId
            ? () => void cancelAnalysis()
            : undefined}
          onComplete={() => undefined}
          companyName={companyName}
          statusText={activeAnalysis?.currentStage ?? undefined}
          ownedPageProgress={activeAnalysis
            ? `${activeAnalysis.successfulPageCount ?? 0}/20개 수집`
            : undefined}
          cliProgress={activeAnalysis
            ? `${activeAnalysis.completedCliStageCount}/${activeAnalysis.totalCliStageCount || 8}단계`
            : undefined}
          waitingMinutes={activeAnalysis
            ? `${Math.max(0, ((activeAnalysis.activeStartedAt
                ? new Date(activeAnalysis.activeStartedAt).getTime()
                : Date.now()) - new Date(activeAnalysis.createdAt).getTime()) / 60_000).toFixed(1)}분`
            : undefined}
          activeMinutes={activeAnalysis?.activeStartedAt
            ? `${Math.max(0, (Date.now() - new Date(activeAnalysis.activeStartedAt).getTime()) / 60_000).toFixed(1)}분`
            : undefined}
          cancelling={cancelling}
          onCancel={analysisId ? () => void cancelAnalysis() : undefined}
        />
      ) : null}
      {currentStep === "analysis" && analysisState === "succeeded" && draft ? (
        <>
          <section className="brand-center-preview__card">
            <div className="brand-center-preview__source-form">
              <label htmlFor="brand-review-company-name">회사명</label>
              <input id="brand-review-company-name" value={companyName} maxLength={100} onChange={(event) => setCompanyName(event.currentTarget.value)} />
            </div>
          </section>
          <LiveResultEditor
            draft={draft}
            saving={saving}
            error={analysisError}
            onChange={setDraft}
            onComplete={() => void complete()}
          />
        </>
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
