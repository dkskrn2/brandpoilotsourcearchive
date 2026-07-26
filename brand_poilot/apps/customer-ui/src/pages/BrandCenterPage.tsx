import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Alert } from "../components/ui/Alert";
import { PageSkeleton } from "../components/ui/LoadingState";
import { BrandCenterHeader } from "../components/brand-center/BrandCenterHeader";
import { BrandCoreReviewPanel } from "../components/brand-center/BrandCoreReviewPanel";
import { BrandReadinessJourney } from "../components/brand-center/BrandReadinessJourney";
import { BrandRulesPanel } from "../components/brand-center/BrandRulesPanel";
import { ProductServiceLibraryPanel } from "../components/brand-center/ProductServiceLibraryPanel";
import { SourceLibraryPanel } from "../components/brand-center/SourceLibraryPanel";
import { WikiLibraryPanel } from "../components/brand-center/WikiLibraryPanel";
import { brandCenterGateway } from "../features/brand-center/brandCenterGateway";
import type {
  BrandCenterSummary,
  BrandCore,
  BrandCoreVersion,
  BrandCoreWorkspace,
  BrandRules,
  BrandRulesWorkspace,
} from "../features/brand-center/types";
import { DEMO_BRAND_ID } from "../lib/apiClient";

type UnderstandingSection = "sources" | "analysis" | "core" | "rules" | "versions";
type BrandCenterTab = "understanding" | "products" | "wiki";
const canonicalUuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const sections: Array<{ id: UnderstandingSection; label: string }> = [
  { id: "sources", label: "원본 자료" },
  { id: "analysis", label: "AI 분석" },
  { id: "core", label: "Brand Core" },
  { id: "rules", label: "실행 규칙" },
  { id: "versions", label: "버전 이력" },
];

const emptyRules: BrandRules = {
  contractVersion: "brand-rules.v1",
  requiredPhrases: [],
  forbiddenPhrases: [],
  exaggerationRules: [],
  ctaRules: { defaultCta: "", allowed: [] },
  channelRules: {},
  designRules: { colors: [], fonts: [], notes: [] },
  autoApprovalRules: { enabled: false, conditions: [] },
};

function readiness(summary: BrandCenterSummary | null) {
  if (!summary) return "0/4";
  return `${[
    summary.source.state === "ready",
    summary.analysis.state === "confirmed",
    summary.brandCore.state === "approved",
    summary.rules.state === "approved",
  ].filter(Boolean).length}/4`;
}

export function BrandCenterPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const requestedTab = params.get("tab");
  const tab: BrandCenterTab = requestedTab === "products" || requestedTab === "wiki"
    ? requestedTab
    : "understanding";
  const requestedSection = params.get("section");
  const requestedAnalysisId = params.get("analysis");
  const analysisId = requestedAnalysisId && canonicalUuidPattern.test(requestedAnalysisId)
    ? requestedAnalysisId
    : null;
  const section = sections.some((item) => item.id === requestedSection)
    ? requestedSection as UnderstandingSection
    : "core";
  const [summary, setSummary] = useState<BrandCenterSummary | null>(null);
  const [workspace, setWorkspace] = useState<BrandCoreWorkspace | null>(null);
  const [ruleWorkspace, setRuleWorkspace] = useState<BrandRulesWorkspace | null>(null);
  const [draftCore, setDraftCore] = useState<BrandCore | null>(null);
  const [rules, setRules] = useState<BrandRules>(emptyRules);
  const [dirty, setDirty] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const visibleVersion = useMemo(() => workspace?.draft ?? workspace?.active ?? null, [workspace]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [nextSummary, nextCore, nextRules] = await Promise.all([
        brandCenterGateway.getSummary(DEMO_BRAND_ID),
        brandCenterGateway.getCore(DEMO_BRAND_ID),
        brandCenterGateway.getRules(DEMO_BRAND_ID),
      ]);
      setSummary(nextSummary);
      setWorkspace(nextCore);
      setRuleWorkspace(nextRules);
      setDraftCore(nextCore.draft?.core ?? null);
      setRules(nextRules.draft?.rules ?? nextRules.active?.rules ?? emptyRules);
      setDirty(false);
    } catch {
      setError("브랜드 센터 정보를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (requestedAnalysisId && !analysisId) {
      const next = new URLSearchParams(params);
      next.delete("analysis");
      setParams(next, { replace: true });
    } else if (!["understanding", "products", "wiki"].includes(requestedTab ?? "") || (tab === "understanding" && !requestedSection)) {
      const next = new URLSearchParams(params);
      next.set("tab", tab);
      if (tab === "understanding") next.set("section", section);
      setParams(next, { replace: true });
    }
    void load();
    // Initial route normalization and load are intentionally run once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  function selectSection(nextSection: UnderstandingSection) {
    if (dirty && !window.confirm("저장하지 않은 변경이 있습니다. 이동할까요?")) return;
    const next = new URLSearchParams(params);
    next.set("tab", "understanding");
    next.set("section", nextSection);
    setParams(next);
  }

  function selectTab(nextTab: BrandCenterTab) {
    if (tab === "understanding" && dirty && !window.confirm("저장하지 않은 변경이 있습니다. 이동할까요?")) return;
    const next = new URLSearchParams(params);
    next.set("tab", nextTab);
    if (nextTab === "understanding") {
      next.set("section", section);
    } else {
      next.delete("section");
    }
    if (nextTab !== "wiki") next.delete("issue");
    if (nextTab !== "products") next.delete("item");
    setParams(next);
  }

  async function createChangeDraft() {
    setSaving(true);
    setError(null);
    try {
      const draft = await brandCenterGateway.createCoreDraft(DEMO_BRAND_ID, {});
      setWorkspace((current) => current
        ? { ...current, draft, versions: [draft, ...current.versions] }
        : { active: null, draft, versions: [draft] });
      setDraftCore(draft.core);
      setNotice("승인된 버전은 유지되고 새 초안에서 변경을 검토합니다.");
      selectSection("core");
    } catch {
      setError("변경 초안을 만들지 못했습니다.");
    } finally {
      setSaving(false);
    }
  }

  async function saveCore(): Promise<boolean> {
    if (!workspace?.draft || !draftCore) return false;
    setSaving(true);
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
      setWorkspace({ ...workspace, draft: updated, versions: workspace.versions.map((item) => item.id === updated.id ? updated : item) });
      setDirty(false);
      setNotice("초안을 저장했습니다.");
      return true;
    } catch (caught) {
      setError(caught instanceof Error && caught.message.includes("brand_core_version_conflict")
        ? "다른 화면에서 수정되었습니다. 현재 입력은 유지했으니 새 데이터를 불러온 뒤 다시 적용하세요."
        : "초안을 저장하지 못했습니다.");
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function approveCore() {
    if (!workspace?.draft) return;
    if (dirty && !(await saveCore())) return;
    setSaving(true);
    try {
      const approved = await brandCenterGateway.approveCoreDraft(DEMO_BRAND_ID, workspace.draft.id);
      setWorkspace({
        active: approved,
        draft: null,
        versions: workspace.versions.map((item) => item.id === approved.id ? approved : item),
      });
      setDraftCore(null);
      setDirty(false);
      setNotice("Brand Core를 승인했습니다.");
    } catch {
      setError("필수 정보를 확인한 뒤 다시 승인하세요.");
    } finally {
      setSaving(false);
    }
  }

  async function saveRules() {
    setSaving(true);
    try {
      const saved = await brandCenterGateway.saveRuleDraft(DEMO_BRAND_ID, rules);
      setRuleWorkspace((current) => ({
        active: current?.active ?? null,
        draft: saved,
        versions: [saved, ...(current?.versions ?? []).filter((item) => item.id !== saved.id)],
      }));
      setNotice("실행 규칙 초안을 저장했습니다.");
    } catch {
      setError("실행 규칙을 저장하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  }

  async function approveRules() {
    let draft = ruleWorkspace?.draft ?? null;
    if (!draft) {
      setSaving(true);
      try {
        draft = await brandCenterGateway.saveRuleDraft(DEMO_BRAND_ID, rules);
      } catch {
        setError("실행 규칙 초안을 저장하지 못해 승인할 수 없습니다.");
        setSaving(false);
        return;
      }
    }
    setSaving(true);
    try {
      const approved = await brandCenterGateway.approveRules(DEMO_BRAND_ID, draft.id);
      setRuleWorkspace((current) => ({
        active: approved,
        draft: null,
        versions: [approved, ...(current?.versions ?? []).filter((item) => item.id !== approved.id)],
      }));
      setNotice("실행 규칙을 승인했습니다.");
    } catch {
      setError("실행 규칙을 승인하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <PageSkeleton label="브랜드 센터를 불러오는 중입니다." />;

  return (
    <section className="content brand-center-page">
      <BrandCenterHeader
        readiness={readiness(summary)}
        approvedAt={workspace?.active?.approvedAt ?? null}
        busy={saving}
        onReanalyze={() => navigate("/onboarding/brand-intelligence?from=brand-center")}
        onReviewChanges={createChangeDraft}
      />
      <BrandReadinessJourney completed={summary?.rules.state === "approved" ? 4 : summary?.brandCore.state === "approved" ? 3 : summary?.analysis.state === "confirmed" ? 2 : summary?.source.state === "ready" ? 1 : 0} />
      {notice && <Alert title="변경 사항" variant="info">{notice}</Alert>}
      {error && <Alert title="작업을 완료하지 못했습니다" variant="bad">{error}<button className="button" type="button" onClick={load}>다시 시도</button></Alert>}

      <nav className="brand-center-tabs" aria-label="브랜드 센터 영역">
        <button className={tab === "understanding" ? "is-active" : ""} type="button" onClick={() => selectTab("understanding")}>브랜드 이해</button>
        <button className={tab === "products" ? "is-active" : ""} type="button" onClick={() => selectTab("products")}>제품·서비스</button>
        <button className={tab === "wiki" ? "is-active" : ""} type="button" onClick={() => selectTab("wiki")}>Wiki</button>
        <button type="button" disabled aria-label="모델·아바타 준비 중">모델·아바타 <small>준비 중</small></button>
      </nav>
      {tab === "understanding" ? <nav className="brand-center-subnav" aria-label="브랜드 이해 세부 영역">
        {sections.map((item) => (
          <button
            className={section === item.id ? "is-active" : ""}
            key={item.id}
            type="button"
            onClick={() => selectSection(item.id)}
          >
            {item.label}
          </button>
        ))}
      </nav> : null}

      {tab === "understanding" && section === "sources" && (
        <SourceLibraryPanel />
      )}
      {tab === "understanding" && section === "analysis" && (
        <section className="panel"><div className="panel-body brand-center-empty">
          <h2>AI 분석</h2>
          <p>재분석 결과는 새 초안으로만 저장되며 현재 승인된 Brand Core를 덮어쓰지 않습니다.</p>
          <Link className="button primary" to="/onboarding/brand-intelligence?from=brand-center">AI 분석 열기</Link>
        </div></section>
      )}
      {tab === "understanding" && section === "core" && visibleVersion && (
        <BrandCoreReviewPanel
          version={workspace?.draft && draftCore ? { ...workspace.draft, core: draftCore } : visibleVersion}
          saving={saving}
          onChange={(core) => { setDraftCore(core); setDirty(true); }}
          onSave={saveCore}
          onApprove={approveCore}
        />
      )}
      {tab === "understanding" && section === "core" && !visibleVersion && (
        <section className="panel"><div className="panel-body brand-center-empty">
          <h2>Brand Core가 없습니다</h2>
          <p>원본 자료를 분석하고 AI 제안값을 검토하면 첫 Brand Core를 만들 수 있습니다.</p>
          <Link className="button primary" to="/onboarding/brand-intelligence">브랜드 분석 시작</Link>
        </div></section>
      )}
      {tab === "understanding" && section === "rules" && <BrandRulesPanel rules={rules} saving={saving} onChange={setRules} onSave={saveRules} onApprove={approveRules} />}
      {tab === "understanding" && section === "versions" && (
        <section className="panel"><div className="panel-header"><h2>버전 이력</h2></div><div className="panel-body">
          <ol className="brand-version-list">
            {(workspace?.versions ?? []).map((item: BrandCoreVersion) => (
              <li key={item.id}><strong>v{item.version}</strong><span>{item.status}</span><time>{new Date(item.updatedAt).toLocaleString("ko-KR")}</time></li>
            ))}
          </ol>
        </div></section>
      )}
      {tab === "products" ? <ProductServiceLibraryPanel
        brandId={DEMO_BRAND_ID}
        initialItemId={params.get("item")}
        initialAnalysisId={analysisId}
        onAnalysisConsumed={() => {
          const next = new URLSearchParams(params);
          next.delete("analysis");
          setParams(next, { replace: true });
        }}
      /> : null}
      {tab === "wiki" ? <WikiLibraryPanel
        brandId={DEMO_BRAND_ID}
        initialIssueId={params.get("issue")}
        onCloseIssue={() => {
          const next = new URLSearchParams(params);
          next.delete("issue");
          setParams(next, { replace: true });
        }}
      /> : null}
    </section>
  );
}
