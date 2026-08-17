import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Alert } from "../components/ui/Alert";
import { PageSkeleton } from "../components/ui/LoadingState";
import { BrandCenterHeader } from "../components/brand-center/BrandCenterHeader";
import { AutoResponseKnowledgePanel } from "../components/brand-center/AutoResponseKnowledgePanel";
import { BrandCoreReviewPanel } from "../components/brand-center/BrandCoreReviewPanel";
import { BrandRulesPanel } from "../components/brand-center/BrandRulesPanel";
import { KnowledgeCategoryEditorPanel } from "../components/brand-center/KnowledgeCategoryEditorPanel";
import { ProductServiceLibraryPanel } from "../components/brand-center/ProductServiceLibraryPanel";
import { StyleReferenceImageBoard } from "../components/brand-center/StyleReferenceImageBoard";
import { BrandStylePresetPanel } from "../components/brand-center/BrandStylePresetPanel";
import { brandCenterGateway } from "../features/brand-center/brandCenterGateway";
import { brandIntelligenceGateway } from "../features/brand-intelligence/brandIntelligenceGateway";
import type {
  BrandAnalysis,
  BrandIntelligenceResult,
} from "../features/brand-intelligence/types";
import { libraryGateway } from "../features/libraries/libraryGateway";
import type {
  BrandCenterSummary,
  BrandCore,
  BrandCoreVersion,
  BrandCoreWorkspace,
  BrandRules,
  BrandRulesWorkspace,
} from "../features/brand-center/types";
import { DEMO_BRAND_ID } from "../lib/apiClient";

type BrandCenterTab = "core" | "products" | "faq" | "knowledge" | "style";
type BrandCenterOnboardingView =
  | "not_started"
  | "initial_in_progress"
  | "initial_review_ready"
  | "ready"
  | "reanalyzing"
  | "reanalysis_review_ready"
  | "failed";
const canonicalUuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const pendingAnalysisStatuses: BrandAnalysis["status"][] = [
  "queued", "accepting_uploads", "waiting_for_resource", "extracting",
  "analyzing", "running", "finalizing", "cancel_requested", "purging",
];

const brandTabs: Array<{ id: BrandCenterTab; label: string }> = [
  { id: "core", label: "브랜드 코어" },
  { id: "products", label: "제품·서비스" },
  { id: "faq", label: "FAQ" },
  { id: "knowledge", label: "AI 자동응답 지식" },
  { id: "style", label: "스타일" },
];

const emptyRules = (): BrandRules => ({
  contractVersion: "brand-rules.v1",
  requiredPhrases: [],
  forbiddenPhrases: [],
  exaggerationRules: [],
  ctaRules: { defaultCta: "", allowed: [] },
  channelRules: {},
  designRules: {
    colors: [],
    fonts: [],
    notes: [],
    referenceImages: [],
  },
  autoApprovalRules: { enabled: false, conditions: [] },
});

function readiness(summary: BrandCenterSummary | null) {
  if (!summary) return "0/4";
  return `${[
    summary.source.state === "ready",
    summary.analysis.state === "confirmed",
    summary.brandCore.state === "approved",
    summary.rules.state === "approved",
  ].filter(Boolean).length}/4`;
}

function coreWithAnalysisResult(
  core: BrandCore,
  result: BrandIntelligenceResult,
): BrandCore {
  const isV2 = result.contractVersion === "brand-intelligence-result.v2";
  const companyOverview = (result.companyOverview ?? "").trim();
  const businessDescription = (result.businessDescription ?? "").trim();
  const primaryCategory = result.primaryCategory ?? { code: null, name: "" };
  const primaryTarget = (result.primaryTarget ?? "").trim();
  const differentiators = isV2
    ? result.differentiators
    : result.differentiators.split("\n").map((item) => item.trim()).filter(Boolean);
  const coreAppeal = (result.coreAppeal ?? "").trim();
  const firstAudience = core.audiences[0] ?? { name: "", problem: "", desiredOutcome: "" };
  return {
    ...core,
    companyOverview,
    businessDescription,
    primaryCategory,
    subcategories: result.subcategories,
    primaryTarget,
    differentiators,
    coreAppeal,
    summary: {
      oneLine: companyOverview,
      description: businessDescription,
    },
    audiences: [{ ...firstAudience, name: primaryTarget }, ...core.audiences.slice(1)],
    valueProposition: {
      ...core.valueProposition,
      primary: coreAppeal,
      differentiators,
    },
    messaging: {
      ...core.messaging,
      appeals: coreAppeal ? [coreAppeal] : core.messaging.appeals,
      brandDirection: differentiators.join("\n"),
    },
  };
}

function resolveOnboardingView(
  hasConfirmedContent: boolean,
  workflow: BrandAnalysis | null,
  failed: boolean,
): BrandCenterOnboardingView {
  if (failed && !hasConfirmedContent) return "failed";
  if (!hasConfirmedContent) {
    if (!workflow) return "not_started";
    if (workflow.status === "review_ready") return "initial_review_ready";
    if (pendingAnalysisStatuses.includes(workflow.status)) return "initial_in_progress";
    return "failed";
  }
  if (!workflow) return "ready";
  if (workflow.status === "review_ready") return "reanalysis_review_ready";
  if (pendingAnalysisStatuses.includes(workflow.status)) return "reanalyzing";
  return "ready";
}

function BrandCenterOnboardingStatus({
  view,
  workflow,
}: {
  view: BrandCenterOnboardingView;
  workflow: BrandAnalysis | null;
}) {
  if (view === "ready" || view === "failed") return null;
  const reviewHref = workflow
    ? `/onboarding/brand-intelligence?analysisId=${workflow.id}`
    : "/onboarding/brand-intelligence";
  if (view === "not_started") {
    return (
      <section className="brand-center-onboarding-status">
        <div>
          <h2>브랜드 정보를 먼저 만들어 주세요</h2>
          <p>URL과 자료를 등록하면 AI가 브랜드 정보를 정리합니다.</p>
        </div>
        <Link className="button primary" to="/onboarding/brand-intelligence">온보딩 하기</Link>
      </section>
    );
  }
  if (view === "initial_in_progress") {
    return (
      <section className="brand-center-onboarding-status" aria-live="polite">
        <div>
          <h2>분석중입니다</h2>
          <p>등록한 자료를 바탕으로 브랜드 정보를 정리하고 있습니다.</p>
        </div>
      </section>
    );
  }
  if (view === "initial_review_ready") {
    return (
      <section className="brand-center-onboarding-status">
        <div>
          <h2>분석이 완료되었습니다.</h2>
          <p>AI 초안을 확인하고 수정한 뒤 브랜드 정보로 확정해 주세요.</p>
        </div>
        <Link className="button primary" to={reviewHref}>분석확인하기</Link>
      </section>
    );
  }
  if (view === "reanalyzing") {
    return (
      <section className="brand-center-onboarding-status" aria-live="polite">
        <div>
          <h2>재분석 중입니다</h2>
          <p>새 결과를 확인하기 전까지 현재 확정된 브랜드 정보를 계속 사용합니다.</p>
        </div>
      </section>
    );
  }
  return (
    <section className="brand-center-onboarding-status">
      <div>
        <h2>재분석 결과를 확인하세요</h2>
        <p>현재 확정 정보는 유지되며, 새 분석을 확인한 뒤 교체할 수 있습니다.</p>
      </div>
      <Link className="button primary" to={reviewHref}>분석확인하기</Link>
    </section>
  );
}

export function BrandCenterPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const requestedTab = params.get("tab");
  const tab = requestedTab === "wiki" || requestedTab === "guide"
    ? "knowledge"
    : requestedTab === "how_to"
      ? "faq"
    : brandTabs.some((item) => item.id === requestedTab)
      ? requestedTab as BrandCenterTab
      : "core";
  const requestedAnalysisId = params.get("analysis");
  const analysisId = requestedAnalysisId && canonicalUuidPattern.test(requestedAnalysisId)
    ? requestedAnalysisId
    : null;
  const [summary, setSummary] = useState<BrandCenterSummary | null>(null);
  const [workspace, setWorkspace] = useState<BrandCoreWorkspace | null>(null);
  const [rulesWorkspace, setRulesWorkspace] = useState<BrandRulesWorkspace | null>(null);
  const [draftCore, setDraftCore] = useState<BrandCore | null>(null);
  const [dirty, setDirty] = useState(false);
  const [coreEditing, setCoreEditing] = useState(false);
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const [coreConflict, setCoreConflict] = useState(false);
  const [showServerVersion, setShowServerVersion] = useState(false);
  const [serverConflictSnapshot, setServerConflictSnapshot] = useState<BrandCoreWorkspace | null>(null);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [draftRules, setDraftRules] = useState<BrandRules | null>(null);
  const [rulesEditing, setRulesEditing] = useState(false);
  const [rulesDirty, setRulesDirty] = useState(false);
  const [childDirty, setChildDirty] = useState(false);
  const [productDirty, setProductDirty] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [initialLoadError, setInitialLoadError] = useState<string | null>(null);
  const [rulesLoadError, setRulesLoadError] = useState<string | null>(null);
  const [retryOperation, setRetryOperation] = useState<
    "createCore" | "saveCore" | "approveCore" | "saveRules" | "approveRules" | null
  >(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [confirmedAnalysis, setConfirmedAnalysis] = useState<BrandAnalysis | null>(null);
  const [workflow, setWorkflow] = useState<BrandAnalysis | null>(null);
  const [intelligenceLoadFailed, setIntelligenceLoadFailed] = useState(false);

  const visibleVersion = useMemo(() => {
    if (!workspace) return null;
    const selected = workspace.versions.find((item) => item.id === selectedVersionId);
    const version = selected ?? workspace.active ?? workspace.draft ?? null;
    if (!version || version.status !== "approved"
      || !confirmedAnalysis?.effectiveResult
      || version.sourceAnalysisId !== confirmedAnalysis.id) return version;
    return {
      ...version,
      core: coreWithAnalysisResult(version.core, confirmedAnalysis.effectiveResult),
    };
  }, [confirmedAnalysis, selectedVersionId, workspace]);
  const visibleRules = rulesWorkspace?.draft?.rules ?? rulesWorkspace?.active?.rules ?? emptyRules();
  const operationalRules = draftRules ?? visibleRules;
  const serverConflictVersion = serverConflictSnapshot?.draft ?? serverConflictSnapshot?.active ?? null;
  const hasUnsavedChanges = dirty || rulesDirty || childDirty || productDirty;
  const showConfirmedContent = confirmedAnalysis !== null
    || Boolean(workspace?.active)
    || summary?.analysis.state === "confirmed"
    || summary?.brandCore.state === "approved";
  const onboardingView = resolveOnboardingView(
    showConfirmedContent,
    workflow,
    intelligenceLoadFailed,
  );

  async function load() {
    setLoading(true);
    setInitialLoadError(null);
    setRulesLoadError(null);
    const [
      summaryResult,
      coreResult,
      rulesResult,
      currentAnalysisResult,
      workflowResult,
    ] = await Promise.allSettled([
      brandCenterGateway.getSummary(DEMO_BRAND_ID),
      brandCenterGateway.getCore(DEMO_BRAND_ID),
      brandCenterGateway.getRules(DEMO_BRAND_ID),
      brandIntelligenceGateway.getCurrent(DEMO_BRAND_ID),
      brandIntelligenceGateway.getWorkflow(DEMO_BRAND_ID),
    ]);
    if (summaryResult.status === "fulfilled") setSummary(summaryResult.value);
    if (coreResult.status === "fulfilled") {
      const nextCore = coreResult.value;
      setWorkspace(nextCore);
      setDraftCore(nextCore.draft ? structuredClone(nextCore.draft.core) : null);
      setSelectedVersionId(nextCore.active?.id ?? nextCore.draft?.id ?? null);
      setCoreEditing(false);
      setCoreConflict(false);
      setShowServerVersion(false);
      setServerConflictSnapshot(null);
      setDirty(false);
    }
    if (rulesResult.status === "fulfilled") {
      const nextRules = rulesResult.value;
      setRulesWorkspace(nextRules);
      setDraftRules(structuredClone(nextRules.draft?.rules ?? nextRules.active?.rules ?? emptyRules()));
      setRulesEditing(false);
      setRulesDirty(false);
    } else {
      setRulesLoadError("운영 규칙을 불러오지 못했습니다.");
      setRulesWorkspace(null);
      setDraftRules(emptyRules());
    }
    if (currentAnalysisResult.status === "fulfilled") {
      setConfirmedAnalysis(currentAnalysisResult.value);
    }
    if (workflowResult.status === "fulfilled") {
      setWorkflow(workflowResult.value);
    }
    const nextIntelligenceLoadFailed = currentAnalysisResult.status === "rejected"
      || workflowResult.status === "rejected";
    setIntelligenceLoadFailed(nextIntelligenceLoadFailed);
    if (
      summaryResult.status === "rejected"
      || coreResult.status === "rejected"
      || nextIntelligenceLoadFailed
    ) {
      setInitialLoadError("브랜드 센터 정보를 불러오지 못했습니다.");
    } else {
      setChildDirty(false);
      setProductDirty(false);
    }
    setLoading(false);
  }

  async function loadRules() {
    setRulesLoadError(null);
    try {
      const nextRules = await brandCenterGateway.getRules(DEMO_BRAND_ID);
      setRulesWorkspace(nextRules);
      setDraftRules(structuredClone(nextRules.draft?.rules ?? nextRules.active?.rules ?? emptyRules()));
      setRulesEditing(false);
      setRulesDirty(false);
    } catch {
      setRulesLoadError("운영 규칙을 불러오지 못했습니다.");
    }
  }

  useEffect(() => {
    const next = new URLSearchParams(params);
    let changed = false;
    if (requestedAnalysisId && !analysisId) {
      next.delete("analysis");
      changed = true;
    }
    if (requestedTab !== tab) {
      next.set("tab", tab);
      changed = true;
    }
    if (next.has("section")) {
      next.delete("section");
      changed = true;
    }
    if (changed) setParams(next, { replace: true });
    void load();
    // Initial route normalization and load are intentionally run once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (!hasUnsavedChanges) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [hasUnsavedChanges]);

  function selectTab(nextTab: BrandCenterTab) {
    if (nextTab === tab) return;
    if (hasUnsavedChanges && !window.confirm("저장하지 않은 변경이 있습니다. 이동할까요?")) return;
    setDraftCore(workspace?.draft ? structuredClone(workspace.draft.core) : null);
    setDirty(false);
    setCoreEditing(false);
    setCoreConflict(false);
    setShowServerVersion(false);
    setServerConflictSnapshot(null);
    setDraftRules(structuredClone(rulesWorkspace?.draft?.rules ?? rulesWorkspace?.active?.rules ?? emptyRules()));
    setRulesDirty(false);
    setRulesEditing(false);
    setChildDirty(false);
    setProductDirty(false);
    const next = new URLSearchParams(params);
    next.set("tab", nextTab);
    next.delete("section");
    if (nextTab !== "products") {
      next.delete("item");
      next.delete("analysis");
    }
    if (nextTab !== "knowledge") next.delete("issue");
    setParams(next);
  }

  async function editCore() {
    if (workspace?.draft) {
      setDraftCore(structuredClone(workspace.draft.core));
      setSelectedVersionId(workspace.draft.id);
      setCoreEditing(true);
      setCoreConflict(false);
      setShowServerVersion(false);
      setServerConflictSnapshot(null);
      return;
    }
    if (!workspace?.active) return;
    setSaving(true);
    setError(null);
    setRetryOperation(null);
    try {
      const activeCore = confirmedAnalysis?.effectiveResult
        && workspace.active.sourceAnalysisId === confirmedAnalysis.id
        ? coreWithAnalysisResult(workspace.active.core, confirmedAnalysis.effectiveResult)
        : workspace.active.core;
      const created = await brandCenterGateway.createCoreDraft(DEMO_BRAND_ID, {
        core: activeCore,
        evidence: workspace.active.evidence,
        reviewState: workspace.active.reviewState,
        sourceAnalysisId: workspace.active.sourceAnalysisId,
      });
      setWorkspace({
        ...workspace,
        draft: created,
        versions: [created, ...workspace.versions],
      });
      setDraftCore(structuredClone(created.core));
      setSelectedVersionId(created.id);
      setCoreEditing(true);
      setCoreConflict(false);
      setShowServerVersion(false);
      setServerConflictSnapshot(null);
      setNotice("브랜드 코어 수정 초안을 만들었습니다.");
    } catch {
      setError("브랜드 코어 수정 초안을 만들지 못했습니다.");
      setRetryOperation("createCore");
    } finally {
      setSaving(false);
    }
  }

  function cancelCore() {
    setDraftCore(workspace?.draft ? structuredClone(workspace.draft.core) : null);
    setDirty(false);
    setCoreEditing(false);
    setCoreConflict(false);
    setShowServerVersion(false);
    setServerConflictSnapshot(null);
    setSelectedVersionId(workspace?.active?.id ?? workspace?.draft?.id ?? null);
    setError(null);
    setRetryOperation(null);
    setNotice("저장하지 않은 브랜드 코어 변경을 취소했습니다.");
  }

  async function saveCore(): Promise<BrandCoreVersion | null> {
    if (!workspace?.draft || !draftCore) return null;
    setSaving(true);
    setError(null);
    setRetryOperation(null);
    try {
      const updated = await brandCenterGateway.updateCoreDraft(
        DEMO_BRAND_ID,
        workspace.draft.id,
        {
          core: draftCore,
          evidence: workspace.draft.evidence,
          reviewState: workspace.draft.reviewState,
          expectedUpdatedAt: workspace.draft.updatedAt,
        },
      );
      setWorkspace({
        ...workspace,
        draft: updated,
        versions: workspace.versions.some((item) => item.id === updated.id)
          ? workspace.versions.map((item) => item.id === updated.id ? updated : item)
          : [updated, ...workspace.versions],
      });
      setDirty(false);
      setCoreEditing(false);
      setCoreConflict(false);
      setShowServerVersion(false);
      setServerConflictSnapshot(null);
      setSelectedVersionId(updated.id);
      setNotice("브랜드 코어를 저장했습니다.");
      return updated;
    } catch (caught) {
      const conflict = typeof caught === "object"
        && caught !== null
        && "errorCode" in caught
        && caught.errorCode === "brand_core_version_conflict";
      setCoreConflict(conflict);
      if (conflict) {
        setShowServerVersion(false);
        setServerConflictSnapshot(null);
      }
      setError(conflict
        ? "다른 곳에서 초안이 변경되었습니다. 현재 입력은 유지됩니다."
        : "초안을 저장하지 못했습니다.");
      setRetryOperation(conflict ? null : "saveCore");
      return null;
    } finally {
      setSaving(false);
    }
  }

  async function approveCore() {
    if (!workspace?.draft) return;
    let targetDraft = workspace.draft;
    if (dirty) {
      const savedDraft = await saveCore();
      if (!savedDraft) return;
      targetDraft = savedDraft;
    }
    setSaving(true);
    setError(null);
    setRetryOperation(null);
    try {
      const approved = await brandCenterGateway.approveCoreDraft(
        DEMO_BRAND_ID,
        targetDraft.id,
        targetDraft.updatedAt,
      );
      const fallbackWorkspace: BrandCoreWorkspace = {
        active: approved,
        draft: null,
        versions: workspace.versions.map((item) => {
          if (item.id === approved.id) return approved;
          return item.status === "approved"
            ? { ...item, status: "superseded" as const }
            : item;
        }),
      };
      let refreshedWorkspace = fallbackWorkspace;
      try {
        refreshedWorkspace = await brandCenterGateway.getCore(DEMO_BRAND_ID);
      } catch {
        // Approval already succeeded; keep a deterministic local history if refresh is unavailable.
      }
      setWorkspace(refreshedWorkspace);
      setDraftCore(null);
      setDirty(false);
      setCoreEditing(false);
      setCoreConflict(false);
      setShowServerVersion(false);
      setServerConflictSnapshot(null);
      setSelectedVersionId(refreshedWorkspace.active?.id ?? approved.id);
      setNotice("브랜드 코어를 승인했습니다.");
    } catch (caught) {
      const conflict = typeof caught === "object"
        && caught !== null
        && "errorCode" in caught
        && caught.errorCode === "brand_core_version_conflict";
      setCoreConflict(conflict);
      setError(conflict
        ? "다른 곳에서 초안이 변경되었습니다. 서버 버전을 확인하세요."
        : "필수 정보를 확인한 뒤 다시 승인하세요.");
      setRetryOperation(conflict ? null : "approveCore");
    } finally {
      setSaving(false);
    }
  }

  async function loadServerConflictSnapshot() {
    setSaving(true);
    setError(null);
    try {
      const latestWorkspace = await brandCenterGateway.getCore(DEMO_BRAND_ID);
      setServerConflictSnapshot(latestWorkspace);
      setShowServerVersion(true);
    } catch {
      setError("서버의 최신 브랜드 코어를 불러오지 못했습니다.");
    } finally {
      setSaving(false);
    }
  }

  function editRules() {
    setDraftRules(structuredClone(
      rulesWorkspace?.draft?.rules ?? rulesWorkspace?.active?.rules ?? emptyRules(),
    ));
    setRulesEditing(true);
    setRulesDirty(false);
  }

  function cancelRules() {
    setDraftRules(structuredClone(
      rulesWorkspace?.draft?.rules ?? rulesWorkspace?.active?.rules ?? emptyRules(),
    ));
    setRulesEditing(false);
    setRulesDirty(false);
    setError(null);
    setRetryOperation(null);
    setNotice("저장하지 않은 운영 규칙 변경을 취소했습니다.");
  }

  async function saveRules(rulesToSave = draftRules) {
    if (!rulesToSave) return null;
    setSaving(true);
    setError(null);
    setRetryOperation(null);
    try {
      const saved = await brandCenterGateway.saveRuleDraft(DEMO_BRAND_ID, rulesToSave);
      setRulesWorkspace((current) => ({
        active: current?.active ?? null,
        draft: saved,
        versions: [
          saved,
          ...(current?.versions ?? []).filter((item) => item.id !== saved.id),
        ],
      }));
      setDraftRules(structuredClone(saved.rules));
      setRulesEditing(false);
      setRulesDirty(false);
      setNotice("운영 규칙을 저장했습니다.");
      return saved;
    } catch {
      setError("운영 규칙을 저장하지 못했습니다.");
      setRetryOperation("saveRules");
      return null;
    } finally {
      setSaving(false);
    }
  }

  async function approveRules() {
    const saved = rulesDirty ? await saveRules() : null;
    if (rulesDirty && !saved) return;
    const targetId = saved?.id ?? rulesWorkspace?.draft?.id;
    if (!targetId) return;
    setSaving(true);
    setError(null);
    setRetryOperation(null);
    try {
      const approved = await brandCenterGateway.approveRules(DEMO_BRAND_ID, targetId);
      setRulesWorkspace((current) => ({
        active: approved,
        draft: null,
        versions: (current?.versions ?? []).map((item) => item.id === approved.id ? approved : item),
      }));
      setDraftRules(structuredClone(approved.rules));
      setRulesEditing(false);
      setRulesDirty(false);
      setNotice("운영 규칙을 승인했습니다.");
    } catch {
      setError("운영 규칙을 승인하지 못했습니다.");
      setRetryOperation("approveRules");
    } finally {
      setSaving(false);
    }
  }

  function retryMutation() {
    switch (retryOperation) {
      case "createCore":
        void editCore();
        break;
      case "saveCore":
        void saveCore();
        break;
      case "approveCore":
        void approveCore();
        break;
      case "saveRules":
        void saveRules();
        break;
      case "approveRules":
        void approveRules();
        break;
    }
  }

  function retryInitialLoad() {
    if (
      hasUnsavedChanges
      && !window.confirm("저장하지 않은 변경이 있습니다. 다시 불러올까요?")
    ) return;
    void load();
  }

  function reanalyze() {
    if (
      hasUnsavedChanges
      && !window.confirm("저장하지 않은 변경이 있습니다. 재분석을 시작할까요?")
    ) return;
    setDraftCore(workspace?.draft ? structuredClone(workspace.draft.core) : null);
    setDirty(false);
    setCoreEditing(false);
    setCoreConflict(false);
    setShowServerVersion(false);
    setServerConflictSnapshot(null);
    setDraftRules(structuredClone(
      rulesWorkspace?.draft?.rules ?? rulesWorkspace?.active?.rules ?? emptyRules(),
    ));
    setRulesDirty(false);
    setRulesEditing(false);
    setChildDirty(false);
    setProductDirty(false);
    setError(null);
    setRetryOperation(null);
    navigate("/onboarding/brand-intelligence?from=brand-center");
  }

  async function saveStyle(rules: BrandRules) {
    const saved = await brandCenterGateway.saveRuleDraft(DEMO_BRAND_ID, rules);
    setRulesWorkspace((current) => ({
      active: current?.active ?? null,
      draft: saved,
      versions: [
        saved,
        ...(current?.versions ?? []).filter((item) => item.id !== saved.id),
      ],
    }));
    setDraftRules(structuredClone(saved.rules));
    setChildDirty(false);
  }

  if (loading) return <PageSkeleton label="브랜드 센터를 불러오는 중입니다." />;

  return (
    <section className="content brand-center-page">
      <BrandCenterHeader
        readiness={readiness(summary)}
        approvedAt={workspace?.active?.approvedAt ?? null}
        busy={saving}
        showReanalyze={showConfirmedContent}
        onReanalyze={reanalyze}
      />
      <BrandCenterOnboardingStatus view={onboardingView} workflow={workflow} />
      {notice && <Alert title="변경 사항" variant="info">{notice}</Alert>}
      {initialLoadError && (
        <Alert title="브랜드 센터를 불러오지 못했습니다" variant="bad">
          {initialLoadError}
          <button className="button" type="button" onClick={retryInitialLoad}>
            초기 정보 다시 시도
          </button>
        </Alert>
      )}
      {rulesLoadError && (
        <Alert title="운영 규칙을 불러오지 못했습니다" variant="bad">
          {rulesLoadError}
          <button className="button" type="button" onClick={() => void loadRules()}>
            운영 규칙 다시 시도
          </button>
        </Alert>
      )}
      {error && (
        <Alert title="작업을 완료하지 못했습니다" variant="bad">
          {error}
          {coreConflict ? (
            <button
              className="button"
              type="button"
              disabled={saving}
              onClick={() => void loadServerConflictSnapshot()}
            >
              서버 버전 확인
            </button>
          ) : (
            retryOperation ? (
              <button className="button" type="button" onClick={retryMutation}>다시 시도</button>
            ) : null
          )}
        </Alert>
      )}
      {showServerVersion && serverConflictVersion ? (
        <Alert title={`서버의 저장된 초안 · 버전 ${serverConflictVersion.version}`} variant="info">
          {serverConflictVersion.core.summary.oneLine}
        </Alert>
      ) : null}

      {showConfirmedContent ? (
        <>
      <nav className="brand-center-tabs" aria-label="브랜드 센터 영역" role="tablist">
        {brandTabs.map((item, index) => (
          <button
            aria-controls={`brand-center-panel-${item.id}`}
            aria-selected={tab === item.id}
            className={tab === item.id ? "is-active" : ""}
            data-brand-tab={item.id}
            id={`brand-center-tab-${item.id}`}
            key={item.id}
            role="tab"
            tabIndex={tab === item.id ? 0 : -1}
            type="button"
            onClick={() => selectTab(item.id)}
            onKeyDown={(event) => {
              if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
              event.preventDefault();
              const direction = event.key === "ArrowRight" ? 1 : -1;
              const next = brandTabs[(index + direction + brandTabs.length) % brandTabs.length];
              selectTab(next.id);
              requestAnimationFrame(() => {
                document.querySelector<HTMLElement>(`[data-brand-tab="${next.id}"]`)?.focus();
              });
            }}
          >
            {item.label}
          </button>
        ))}
      </nav>
      <div
        aria-labelledby={`brand-center-tab-${tab}`}
        id={`brand-center-panel-${tab}`}
        role="tabpanel"
      >
        {tab === "core" && (workspace?.versions.length ?? 0) > 1 ? (
          <nav aria-label="브랜드 코어 수정 이력" className="form-actions">
            {workspace?.versions.map((version) => (
              <button
                aria-pressed={visibleVersion?.id === version.id}
                className="button"
                key={version.id}
                type="button"
                onClick={() => setSelectedVersionId(version.id)}
              >
                {version.status === "draft"
                  ? `수정 초안 버전 ${version.version}`
                  : version.status === "approved"
                    ? `승인 버전 ${version.version}`
                    : `버전 ${version.version} · 대체됨`}
              </button>
            ))}
          </nav>
        ) : null}
        {tab === "core" && visibleVersion ? (
          <BrandCoreReviewPanel
            version={workspace?.draft?.id === visibleVersion.id && draftCore
              ? { ...workspace.draft, core: draftCore }
              : visibleVersion}
            editing={coreEditing && workspace?.draft?.id === visibleVersion.id}
            saving={saving}
            onChange={(core) => { setDraftCore(core); setDirty(true); }}
            onSave={saveCore}
            onApprove={approveCore}
            onEdit={() => void editCore()}
            onCancel={cancelCore}
            dirty={dirty}
          />
        ) : null}
        {tab === "core" && !visibleVersion ? (
          <section className="panel"><div className="panel-body brand-center-empty">
            <h2>브랜드 코어가 없습니다</h2>
            <p>브랜드 정보를 등록하면 콘텐츠 제작 기준을 확인할 수 있습니다.</p>
          </div></section>
        ) : null}
        {tab === "core" ? (
          <>
            <div className="form-actions">
              <button
                aria-expanded={rulesOpen}
                className="button"
                disabled={Boolean(rulesLoadError)}
                type="button"
                onClick={() => setRulesOpen((open) => !open)}
              >
                운영 규칙
              </button>
            </div>
            {rulesOpen ? (
              <BrandRulesPanel
                rules={operationalRules}
                saving={saving}
                editing={rulesEditing}
                dirty={rulesDirty}
                canApprove={Boolean(rulesWorkspace?.draft)}
                onChange={(rules) => {
                  setDraftRules(rules);
                  setRulesDirty(true);
                }}
                onDirty={() => setRulesDirty(true)}
                onSave={(rules) => void saveRules(rules)}
                onApprove={() => void approveRules()}
                onEdit={editRules}
                onCancel={cancelRules}
              />
            ) : null}
          </>
        ) : null}
        {tab === "faq" ? (
          <KnowledgeCategoryEditorPanel
            brandId={DEMO_BRAND_ID}
            kind="faq"
            title="FAQ"
            onDirtyChange={setChildDirty}
          />
        ) : null}
        {tab === "knowledge" ? (
          <AutoResponseKnowledgePanel
            brandId={DEMO_BRAND_ID}
            core={workspace?.active?.core ?? null}
          />
        ) : null}
        {tab === "products" ? (
          <ProductServiceLibraryPanel
            brandId={DEMO_BRAND_ID}
            initialItemId={params.get("item")}
            initialAnalysisId={analysisId}
            onAnalysisConsumed={() => {
              const next = new URLSearchParams(params);
              next.delete("analysis");
              setParams(next, { replace: true });
            }}
            onDirtyChange={setProductDirty}
          />
        ) : null}
        {tab === "style" && rulesLoadError ? (
          <section className="panel">
            <div className="panel-body brand-center-empty">
              <h2>스타일 정보를 불러올 수 없습니다</h2>
              <p>운영 규칙을 다시 불러온 뒤 디자인 스타일을 수정해 주세요.</p>
            </div>
          </section>
        ) : null}
        {tab === "style" && !rulesLoadError ? (
          <>
            <BrandStylePresetPanel brandId={DEMO_BRAND_ID} gateway={libraryGateway} />
            <StyleReferenceImageBoard
              brandId={DEMO_BRAND_ID}
              gateway={libraryGateway}
              rules={visibleRules}
              onSave={saveStyle}
              onDirtyChange={setChildDirty}
            />
          </>
        ) : null}
      </div>
        </>
      ) : null}
    </section>
  );
}
