import { Image } from "lucide-react";
import { useEffect, useState } from "react";
import type { AiContentDraft, AiContentGateway, AiContentReference, AiContentType, GenerationAttachment, GenerationBrief, SubjectAnalysis, SubjectAppeal, SubjectTarget, SubjectType } from "../../features/ai-content/types";
import type { WizardStep } from "../../features/ai-content/useAiContentDraft";
import { GenerationPromptStep } from "./GenerationPromptStep";
import { ReferencePicker } from "./ReferencePicker";
import { SubjectAnalysisStep } from "./SubjectAnalysisStep";
import { TargetAppealStep } from "./TargetAppealStep";

interface Actions {
  setType(type: AiContentType): void;
  setSubjectType(type: SubjectType): void;
  setSubjectInput(value: Partial<AiContentDraft["subjectInput"]>): void;
  setSubjectAttachments(value: GenerationAttachment[]): void;
  setSubjectAnalysis(value: SubjectAnalysis | null): void;
  setSelectedSubjectImages(ids: string[]): void;
  setTarget(value: SubjectTarget | null): void;
  setAppeal(value: SubjectAppeal | null): void;
  setReferences(ids: string[]): void;
  reorderReference(from: number, to: number): void;
  setBrief(brief: GenerationBrief): void;
}

export const wizardStepNames = ["콘텐츠 유형", "제품·서비스 분석", "타깃·소구점", "레퍼런스", "프롬프트·생성"] as const;

export function AiContentWizardSteps({ step, draft, actions, gateway, brandId, generationId, analysis, onPrepareAnalysis }: { step: WizardStep; draft: AiContentDraft; actions: Actions; gateway: AiContentGateway; brandId: string; generationId: string | null; analysis: SubjectAnalysis | null; onPrepareAnalysis(): Promise<{ generationId: string; attachments: GenerationAttachment[] }> }) {
  if (step === 1) return <TypeStep draft={draft} setType={actions.setType} />;
  if (step === 2) return <SubjectAnalysisStep brandId={brandId} gateway={gateway} draft={draft} analysis={analysis} onSubjectType={actions.setSubjectType} onSubjectInput={actions.setSubjectInput} onSubjectAttachments={actions.setSubjectAttachments} onPrepareAnalysis={onPrepareAnalysis} onAnalysis={actions.setSubjectAnalysis} />;
  if (step === 3) return <TargetAppealStep analysis={analysis} draft={draft} onTarget={actions.setTarget} onAppeal={actions.setAppeal} />;
  if (step === 4) return <ReferencesStep draft={draft} actions={actions} gateway={gateway} brandId={brandId} />;
  return <GenerationPromptStep brandId={brandId} gateway={gateway} draft={draft} onBrief={actions.setBrief} generationId={generationId} />;
}

function TypeStep({ draft, setType }: { draft: AiContentDraft; setType(type: AiContentType): void }) {
  const items: Array<[AiContentType, string, string]> = [["card_news", "카드뉴스", "저장하고 공유하기 좋은 정방형 정보 콘텐츠"], ["blog", "블로그", "검색과 정보 전달을 위한 구조화된 글"], ["marketing", "마케팅 소재", "캠페인용 이미지와 카피"]];
  return <section><header className="wizard-section-heading"><div><p className="eyebrow">STEP 1</p><h2>어떤 콘텐츠를 만들까요?</h2><p className="wizard-lead">한 번에 한 형식을 선택하면 다음 단계에서 해당 형식에 맞는 결과를 준비합니다.</p></div></header><div className="wizard-choice-grid">{items.map(([type, title, detail]) => <button type="button" key={type} aria-label={title} aria-pressed={draft.type === type} onClick={() => setType(type)}><Image size={20} /><strong>{title}</strong><span>{detail}</span></button>)}</div></section>;
}

function ReferencesStep({ draft, actions, gateway, brandId }: { draft: AiContentDraft; actions: Actions; gateway: AiContentGateway; brandId: string }) {
  const [references, setReferences] = useState<AiContentReference[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => { let active = true; setLoading(true); void gateway.listReferences(brandId, draft.type ?? undefined).then((rows) => { if (active) setReferences(rows); }).catch(() => { if (active) setReferences([]); }).finally(() => { if (active) setLoading(false); }); return () => { active = false; }; }, [brandId, draft.type, gateway]);
  return <section><header className="wizard-section-heading"><div><p className="eyebrow">STEP 4</p><h2>참고할 콘텐츠를 선택하세요</h2><p className="wizard-lead">선택한 순서와 성과가 생성 워커에 전달됩니다. 선택하지 않아도 생성할 수 있습니다.</p></div></header>{loading ? <div className="wizard-analysis-progress" role="status"><div className="skeleton-lines" aria-hidden="true"><span /><span /><span /></div>레퍼런스를 불러오고 있습니다.</div> : <ReferencePicker references={references} selectedIds={draft.referenceIds} onChange={actions.setReferences} onReorder={actions.reorderReference} />}</section>;
}
