import { CheckCircle2, FileText, Image, Link2, LoaderCircle, Package } from "lucide-react";
import { useState } from "react";
import type {
  AiContentDraft,
  AiContentGateway,
  GenerationAttachment,
  SubjectAnalysis,
  SubjectType,
} from "../../features/ai-content/types";
import { AiContentAttachmentUploader } from "./AiContentAttachmentUploader";

interface Props {
  brandId: string;
  gateway: AiContentGateway;
  draft: AiContentDraft;
  analysis: SubjectAnalysis | null;
  onSubjectType(value: SubjectType): void;
  onSubjectInput(value: Partial<AiContentDraft["subjectInput"]>): void;
  onSubjectAttachments(value: GenerationAttachment[]): void;
  onPrepareAnalysis(): Promise<{ generationId: string; attachments: GenerationAttachment[] }>;
  onAnalysis(value: SubjectAnalysis): void;
}

type RunStatus = "idle" | "loading" | "failure";

const terminalStatuses = new Set<SubjectAnalysis["status"]>(["ready", "partial", "failed"]);

function statusLabel(status: SubjectAnalysis["status"]) {
  if (status === "analyzing") return "고객과 시장 분석 중";
  if (status === "generating_appeals") return "타깃·소구점 생성 중";
  return "제품·서비스 자료 확인 중";
}

export function SubjectAnalysisStep({
  brandId,
  gateway,
  draft,
  onSubjectType,
  onSubjectInput,
  onSubjectAttachments,
  onPrepareAnalysis,
  onAnalysis,
}: Props) {
  const [runStatus, setRunStatus] = useState<RunStatus>("idle");
  const [pipelineStatus, setPipelineStatus] = useState<SubjectAnalysis["status"]>("extracting");
  const [error, setError] = useState<string | null>(null);
  const attachments = draft.subjectAttachments ?? [];
  const imageAttachments = attachments.filter(({ role }) => role === "product");
  const documentAttachments = attachments.filter(({ role }) => role === "document");
  const readyToAnalyze = Boolean(
    draft.subjectType
      && (draft.subjectInput.sourceUrl.trim()
        || draft.subjectInput.name.trim()
        || draft.subjectInput.description.trim()
        || attachments.length),
  );

  function replaceAttachments(roles: GenerationAttachment["role"][], next: GenerationAttachment[]) {
    onSubjectAttachments([
      ...attachments.filter(({ role }) => !roles.includes(role)),
      ...next,
    ]);
  }

  async function run() {
    if (!draft.subjectType || !readyToAnalyze) {
      setError("URL, 첨부파일, 이름 또는 설명 중 하나를 입력해 주세요.");
      setRunStatus("failure");
      return;
    }
    setRunStatus("loading");
    setPipelineStatus("extracting");
    setError(null);
    try {
      const prepared = await onPrepareAnalysis();
      let current = await gateway.requestSubjectAnalysis(brandId, {
        generationId: prepared.generationId,
        subjectType: draft.subjectType,
        sourceUrl: draft.subjectInput.sourceUrl.trim() || null,
        attachmentIds: prepared.attachments.map(({ id }) => id),
        manualInput: {
          name: draft.subjectInput.name,
          promotionOrTerms: draft.subjectInput.promotion,
          description: draft.subjectInput.description,
        },
        idempotencyKey: crypto.randomUUID(),
      });
      setPipelineStatus(current.status);
      for (let attempt = 0; attempt < 600 && !terminalStatuses.has(current.status); attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 300));
        current = await gateway.getSubjectAnalysis(brandId, current.id);
        setPipelineStatus(current.status);
      }
      if (current.status === "ready" || current.status === "partial") {
        onAnalysis(current);
        return;
      }
      setError(current.errorMessage ?? "분석을 완료하지 못했습니다.");
      setRunStatus("failure");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "분석을 완료하지 못했습니다.");
      setRunStatus("failure");
    }
  }

  return <section className="subject-analysis-step">
    <header className="wizard-section-heading">
      <div><p className="eyebrow">STEP 2</p><h2>제품·서비스 자료를 입력하세요</h2><p className="wizard-lead">공개 자료와 직접 입력한 정보를 함께 분석해 타깃과 소구점을 만듭니다.</p></div>
    </header>
    <div className="wizard-segmented" role="radiogroup" aria-label="분석 대상 유형">
      <button type="button" role="radio" aria-label="제품" aria-checked={draft.subjectType === "product"} onClick={() => { onSubjectType("product"); setRunStatus("idle"); setError(null); }}><Package size={18} /><strong>제품</strong><span>기능, 효익과 구매 이유를 분석합니다.</span></button>
      <button type="button" role="radio" aria-label="서비스" aria-checked={draft.subjectType === "service"} onClick={() => { onSubjectType("service"); setRunStatus("idle"); setError(null); }}><Link2 size={18} /><strong>서비스</strong><span>제공 과정, 변화와 도입 조건을 분석합니다.</span></button>
    </div>
    {draft.subjectType ? <>
      <div className="wizard-form-grid subject-input-grid">
        <label>제품·서비스 URL <span className="wizard-optional">선택</span><input aria-label="제품·서비스 URL (선택)" type="url" placeholder="https://example.com" value={draft.subjectInput.sourceUrl} onChange={(event) => onSubjectInput({ sourceUrl: event.target.value })} /><small>로그인 없이 확인할 수 있는 공개 페이지를 입력하세요.</small></label>
        <label>이름<input aria-label="제품 또는 서비스 이름" placeholder="예: 콘텐츠 운영 자동화" value={draft.subjectInput.name} onChange={(event) => onSubjectInput({ name: event.target.value })} /></label>
        <label>프로모션·이용 조건<input aria-label="프로모션 또는 이용 조건" placeholder="예: 무료 체험, 신청 조건, 월 이용료" value={draft.subjectInput.promotion} onChange={(event) => onSubjectInput({ promotion: event.target.value })} /></label>
        <label>추가 설명<textarea aria-label="추가 설명" placeholder="제품 기능이나 서비스 제공 방식을 보완해 주세요." value={draft.subjectInput.description} onChange={(event) => onSubjectInput({ description: event.target.value })} /></label>
      </div>
      <div className="analysis-upload-groups">
        <div className="analysis-upload-group">
          <div className="section-heading-inline"><h3><Image size={17} />제품·서비스 이미지</h3><span>PNG, JPEG</span></div>
          <AiContentAttachmentUploader gateway={gateway} brandId={brandId} generationId={null} attachments={imageAttachments} allowedRoles={["product"]} onChange={(next) => replaceAttachments(["product"], next)} />
        </div>
        <div className="analysis-upload-group">
          <div className="section-heading-inline"><h3><FileText size={17} />설명 문서</h3><span>PDF, TXT, MD, CSV, XLSX</span></div>
          <AiContentAttachmentUploader gateway={gateway} brandId={brandId} generationId={null} attachments={documentAttachments} allowedRoles={["document"]} onChange={(next) => replaceAttachments(["document"], next)} />
        </div>
      </div>
      <div className="wizard-inline-actions"><button type="button" className="button primary" disabled={!readyToAnalyze || runStatus === "loading"} onClick={() => void run()}>{runStatus === "loading" ? <LoaderCircle className="inline-spinner" size={17} /> : <CheckCircle2 size={17} />}분석하고 소구점 만들기</button></div>
    </> : <div className="wizard-empty-state">제품 또는 서비스를 선택하면 자료를 입력할 수 있습니다.</div>}
    {runStatus === "loading" ? <div className="wizard-analysis-progress wizard-analysis-progress--stable" role="status"><LoaderCircle className="inline-spinner" size={22} /><strong>{statusLabel(pipelineStatus)}</strong></div> : null}
    {error ? <p className="wizard-error" role="alert">{error}</p> : null}
  </section>;
}
