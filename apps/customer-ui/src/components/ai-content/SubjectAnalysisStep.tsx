import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Image, Link2, LoaderCircle, Package, RefreshCw } from "lucide-react";
import type { AiContentBrandContext, AiContentDraft, AiContentGateway, SubjectAnalysis, SubjectType } from "../../features/ai-content/types";

interface Props {
  brandId: string;
  gateway: AiContentGateway;
  draft: AiContentDraft;
  analysis: SubjectAnalysis | null;
  onSubjectType(value: SubjectType): void;
  onSubjectInput(value: Partial<AiContentDraft["subjectInput"]>): void;
  onAnalysis(value: SubjectAnalysis): void;
  onSelectImage(imageId: string): void;
}

type RunStatus = "idle" | "loading" | "success" | "failure";

const terminalStatuses = new Set<SubjectAnalysis["status"]>(["ready", "partial", "failed"]);

function displayValue(value: unknown) {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.filter((item) => typeof item === "string").join(" · ");
  return "";
}

function researchText(research: Record<string, unknown>) {
  return [research.voc, research.summary, research.alternatives, research.marketContext]
    .map(displayValue).filter(Boolean).join("\n");
}

function statusLabel(status: SubjectAnalysis["status"]) {
  if (status === "queued") return "분석 작업을 준비하고 있습니다";
  if (status === "extracting") return "제품·서비스 정보를 확인하고 있습니다";
  if (status === "researching") return "고객 언어와 대안을 조사하고 있습니다";
  return "분석 결과를 정리하고 있습니다";
}

export function SubjectAnalysisStep({ brandId, gateway, draft, analysis, onSubjectType, onSubjectInput, onAnalysis, onSelectImage }: Props) {
  const [context, setContext] = useState<AiContentBrandContext | null>(null);
  const [contextLoading, setContextLoading] = useState(true);
  const [runStatus, setRunStatus] = useState<RunStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setContextLoading(true);
    void gateway.getBrandContext(brandId)
      .then((value) => { if (active) setContext(value); })
      .catch(() => { if (active) setContext(null); })
      .finally(() => { if (active) setContextLoading(false); });
    return () => { active = false; };
  }, [brandId, gateway]);

  const sourceUrl = draft.subjectType === "service" ? context?.ownedUrl ?? "" : draft.subjectInput.sourceUrl;
  const readyToAnalyze = Boolean(sourceUrl.trim());

  async function run(force = false) {
    if (!draft.subjectType || !sourceUrl.trim()) {
      setError(draft.subjectType === "service" ? "브랜드 설정에 본사 URL을 먼저 등록해 주세요." : "공개 제품 페이지 URL을 입력해 주세요.");
      setRunStatus("failure");
      return;
    }
    setRunStatus("loading");
    setError(null);
    try {
      const input = {
        subjectType: draft.subjectType,
        sourceUrl,
        manualInput: draft.subjectInput,
        idempotencyKey: crypto.randomUUID(),
        force,
      };
      let current = force ? await gateway.reanalyzeSubject(brandId, analysis?.id ?? "", input.idempotencyKey) : await gateway.getCachedSubjectAnalysis(brandId, draft.subjectType, sourceUrl);
      if (!current) current = await gateway.requestSubjectAnalysis(brandId, input);
      for (let attempt = 0; attempt < 30 && !terminalStatuses.has(current.status); attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 300));
        current = await gateway.getSubjectAnalysis(brandId, current.id);
      }
      onAnalysis(current);
      if (current.status === "failed") {
        setError(current.errorMessage ?? "페이지를 분석하지 못했습니다.");
        setRunStatus("failure");
      } else {
        setRunStatus("success");
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "분석을 완료하지 못했습니다.");
      setRunStatus("failure");
    }
  }

  const progressVisible = runStatus === "loading" || Boolean(analysis && !terminalStatuses.has(analysis.status));
  const isService = draft.subjectType === "service";
  const visibleTargets = useMemo(() => (analysis?.targets ?? []).slice(0, 3), [analysis]);

  return <section className="subject-analysis-step">
    <header className="wizard-section-heading">
      <div><p className="eyebrow">STEP 2</p><h2>제품·서비스를 분석하세요</h2><p className="wizard-lead">최종 콘텐츠에 사용할 사실과 고객 맥락을 한 번 분석해 저장합니다. 화면을 열기만 해서는 분석하지 않습니다.</p></div>
    </header>
    <div className="wizard-segmented" role="radiogroup" aria-label="분석 대상 유형">
      <button type="button" role="radio" aria-label="제품" aria-checked={draft.subjectType === "product"} onClick={() => { onSubjectType("product"); setRunStatus("idle"); }}><Package size={18} /><strong>제품</strong><span>제품 상세 페이지의 특징과 구매 이유</span></button>
      <button type="button" role="radio" aria-label="서비스" aria-checked={draft.subjectType === "service"} onClick={() => { onSubjectType("service"); setRunStatus("idle"); }}><Link2 size={18} /><strong>서비스</strong><span>자사 서비스의 문제 해결 방식과 이용 맥락</span></button>
    </div>
    {isService ? <div className="wizard-source-context">
      <h3>자사 서비스 정보</h3>
      {contextLoading ? <div className="wizard-status" role="status"><LoaderCircle className="inline-spinner" size={18} />저장된 자사 정보를 확인하고 있습니다.</div> : context?.ownedUrl ? <dl><dt>분석 URL</dt><dd>{context.ownedUrl}</dd><dt>기존 정보</dt><dd>{context.ready ? `${context.pageCount}개 문서 · Wiki 갱신됨` : "첫 분석 후 생성 근거로 저장"}</dd></dl> : <div className="alert bad"><strong>자사 URL이 없습니다.</strong><span>브랜드 설정에서 본사 URL을 등록하거나 아래 수동 정보를 입력해 주세요.</span><a className="button" href="/brand-settings">브랜드 설정으로 이동</a></div>}
    </div> : null}
    {draft.subjectType ? <div className="wizard-form-grid subject-input-grid">
      {!isService ? <label>제품·서비스 URL<input aria-label="제품·서비스 URL" type="url" placeholder="https://example.com/product" value={draft.subjectInput.sourceUrl} onChange={(event) => onSubjectInput({ sourceUrl: event.target.value })} /><small>로그인 없이 확인할 수 있는 공개 상세 페이지를 입력하세요.</small></label> : null}
      <label>이름<input aria-label="제품 또는 서비스 이름" placeholder="예: 콘텐츠 운영 자동화" value={draft.subjectInput.name} onChange={(event) => onSubjectInput({ name: event.target.value })} /><small>페이지에서 이름을 찾지 못할 때 사용할 보완 정보입니다.</small></label>
      <label>프로모션·조건<input aria-label="프로모션 또는 조건" placeholder="예: 무료 체험, 이용 대상, 신청 조건" value={draft.subjectInput.promotion} onChange={(event) => onSubjectInput({ promotion: event.target.value })} /><small>확인 가능한 조건만 적으면 분석 결과에 반영됩니다.</small></label>
      <label>추가 설명<textarea aria-label="추가 설명" placeholder="제품·서비스를 처음 보는 고객에게 설명할 내용을 적어 주세요." value={draft.subjectInput.description} onChange={(event) => onSubjectInput({ description: event.target.value })} /><small>페이지에 부족한 내용을 보완할 때 사용합니다.</small></label>
    </div> : <div className="wizard-empty-state">제품 또는 서비스를 선택하면 분석 입력을 시작할 수 있습니다.</div>}
    {draft.subjectType ? <div className="wizard-inline-actions"><button type="button" className="button primary" disabled={!readyToAnalyze || contextLoading || runStatus === "loading"} onClick={() => void run()}>{runStatus === "loading" ? <LoaderCircle className="inline-spinner" size={17} /> : <CheckCircle2 size={17} />}분석 시작</button>{analysis && terminalStatuses.has(analysis.status) ? <button type="button" className="button" disabled={runStatus === "loading"} onClick={() => void run(true)}><RefreshCw size={16} />다시 분석</button> : null}</div> : null}
    {progressVisible ? <div className="wizard-analysis-progress" role="status"><div className="skeleton-lines" aria-hidden="true"><span /><span /><span /><span /></div><LoaderCircle className="inline-spinner" size={18} />{analysis ? statusLabel(analysis.status) : "분석 작업을 준비하고 있습니다"}</div> : null}
    {error ? <div className="alert bad" role="alert"><strong>분석을 완료하지 못했습니다.</strong><span>{error}</span></div> : null}
    {analysis && (analysis.status === "ready" || analysis.status === "partial") ? <div className="subject-analysis-result">
      <div className="alert ok"><strong>고객·시장 분석을 완료했습니다.</strong><span>{analysis.status === "partial" ? "일부 공개 정보가 부족합니다. 확인된 사실만 생성 근거로 사용합니다." : "확인된 사실과 고객 맥락을 다음 단계에서 선택할 수 있습니다."}</span></div>
      {analysis.status === "partial" ? <p className="wizard-notice">페이지에서 확인하지 못한 정보는 추정하지 않고, 입력한 수동 정보와 확인된 사실만 사용합니다.</p> : null}
      <div className="analysis-result-grid">
        <article><h3>확인된 사실</h3>{analysis.facts.length ? <ul>{analysis.facts.map((fact) => <li key={`${fact.key}-${fact.value}`}><strong>{fact.key}</strong><span>{fact.value}</span></li>)}</ul> : <p className="wizard-muted">확인된 사실이 없습니다.</p>}</article>
        <article><h3>고객 언어·대안</h3><p className="analysis-pre">{researchText(analysis.research) || "공개 조사 결과가 없습니다."}</p></article>
        <article><h3>추천 타깃 미리보기</h3>{visibleTargets.length ? <ol>{visibleTargets.map((target) => <li key={target.id}><strong>{target.name}</strong><span>{target.painPoints[0] ?? target.traits[0] ?? "고객 상황 분석"}</span></li>)}</ol> : <p className="wizard-muted">추천 타깃이 없습니다.</p>}</article>
      </div>
      <div className="analysis-images"><div className="section-heading-inline"><h3>추출 이미지 선택</h3><span>선택 사항</span></div>{analysis.images.length ? <div className="analysis-image-grid">{analysis.images.map((image) => <button key={image.id} type="button" className={analysis.selectedImageId === image.id ? "analysis-image selected" : "analysis-image"} aria-label={`이미지 선택: ${image.altText}`} aria-pressed={analysis.selectedImageId === image.id} onClick={() => onSelectImage(image.id)}><img src={image.storageUrl} alt={image.altText} /><span>{image.role} · {image.width ?? "?"}×{image.height ?? "?"}</span></button>)}</div> : <p className="wizard-muted">페이지에서 사용할 이미지를 찾지 못했습니다.</p>}</div>
    </div> : null}
  </section>;
}
