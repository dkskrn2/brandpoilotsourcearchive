import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { BrandAnalysisProgressStep } from "../components/brand-intelligence/BrandAnalysisProgressStep";
import { BrandAnalysisReviewStep } from "../components/brand-intelligence/BrandAnalysisReviewStep";
import { BrandEvidenceInputStep } from "../components/brand-intelligence/BrandEvidenceInputStep";
import { PageHeader } from "../components/layout/PageHeader";
import { Alert } from "../components/ui/Alert";
import { brandIntelligenceGateway } from "../features/brand-intelligence/brandIntelligenceGateway";
import { useBrandIntelligenceFlow } from "../features/brand-intelligence/useBrandIntelligenceFlow";
import { api, DEMO_BRAND_ID } from "../lib/apiClient";
import type { ContentCategory } from "../types";

export function BrandIntelligenceOnboardingPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const analysisId = searchParams.get("analysisId");
  const gateway = useMemo(() => brandIntelligenceGateway, []);
  const { analysis, draft, setDraft, loading, error: loadError } = useBrandIntelligenceFlow({
    brandId: DEMO_BRAND_ID,
    analysisId,
    gateway,
  });
  const [submitting, setSubmitting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [ownedUrl, setOwnedUrl] = useState("");
  const [categories, setCategories] = useState<ContentCategory[]>([]);

  useEffect(() => {
    let active = true;
    void Promise.all([api.listSources(DEMO_BRAND_ID), api.listContentCategories()])
      .then(([sources, loadedCategories]) => {
        if (!active) return;
        setOwnedUrl(sources.find((source) => source.sourceType === "owned" && source.enabled)?.url ?? "");
        setCategories(loadedCategories);
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);

  async function start(input: { ownedUrl: string | null; files: File[] }) {
    setSubmitting(true);
    setActionError(null);
    try {
      const uploadSessionId = crypto.randomUUID();
      const uploadIds: string[] = [];
      for (const file of input.files) uploadIds.push(await gateway.uploadFile(DEMO_BRAND_ID, uploadSessionId, file));
      const created = await gateway.requestAnalysis(DEMO_BRAND_ID, {
        ownedUrl: input.ownedUrl,
        uploadIds,
        idempotencyKey: crypto.randomUUID(),
      });
      setSearchParams({ analysisId: created.id }, { replace: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      setActionError(message.includes("scanned_pdf_not_supported")
        ? "텍스트가 없는 스캔 PDF는 아직 분석할 수 없습니다. 텍스트 PDF로 다시 첨부하세요."
        : "자료를 등록하지 못했습니다. 파일 형식과 API 상태를 확인하세요.");
    } finally {
      setSubmitting(false);
    }
  }

  async function confirm() {
    if (!analysisId || !draft) return;
    setSaving(true);
    setActionError(null);
    try {
      await gateway.updateDraft(DEMO_BRAND_ID, analysisId, draft);
      await gateway.confirm(DEMO_BRAND_ID, analysisId);
      navigate("/brand-settings?brandIntelligence=confirmed");
    } catch {
      setActionError("브랜드 정보를 저장하지 못했습니다. 필수 입력값과 API 상태를 확인하세요.");
    } finally {
      setSaving(false);
    }
  }

  const step = !analysisId ? 1 : analysis?.status === "review_ready" && draft ? 3 : 2;
  return (
    <section className="content">
      <PageHeader
        title="브랜드 정보 만들기"
        description="자사 자료를 분석한 뒤 결과를 직접 확인하고 저장합니다. 확정한 정보는 콘텐츠 생성과 고객 응답에 공통으로 사용됩니다."
      />
      <ol className="brand-intelligence-steps" aria-label="브랜드 정보 만들기 단계">
        {["자료 등록", "정보 분석", "검토 및 저장"].map((label, index) => (
          <li key={label} className={step >= index + 1 ? "is-active" : ""}><span>{index + 1}</span>{label}</li>
        ))}
      </ol>

      {step === 1 && <BrandEvidenceInputStep busy={submitting} error={actionError} initialOwnedUrl={ownedUrl} onSubmit={start} />}
      {step === 2 && analysis && analysis.status !== "failed" && <BrandAnalysisProgressStep status={analysis.status} />}
      {step === 2 && loading && !analysis && <BrandAnalysisProgressStep status="queued" />}
      {step === 2 && (analysis?.status === "failed" || loadError) && (
        <section className="panel"><div className="panel-body">
          <Alert title="분석을 완료하지 못했습니다" variant="bad">{analysis?.errorMessage ?? loadError ?? "잠시 후 다시 시도하세요."}</Alert>
          <div className="form-actions"><button type="button" className="button" onClick={() => setSearchParams({}, { replace: true })}>자료 다시 입력</button></div>
        </div></section>
      )}
      {step === 3 && draft && (
        <BrandAnalysisReviewStep draft={draft} saving={saving} error={actionError} categories={categories} onChange={setDraft} onConfirm={confirm} />
      )}
    </section>
  );
}
