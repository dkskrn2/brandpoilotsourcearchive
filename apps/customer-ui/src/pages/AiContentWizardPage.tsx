import { ChevronLeft, ChevronRight, LoaderCircle, Sparkles } from "lucide-react";
import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { AiContentWizardSteps, wizardStepNames } from "../components/ai-content/AiContentWizardSteps";
import { PageGuideButton } from "../components/layout/PageHeader";
import type { AiContentType, GenerationAttachment } from "../features/ai-content/types";
import { aiContentApiGateway } from "../features/ai-content/aiContentApiGateway";
import type { AiContentDraft, AiContentGateway } from "../features/ai-content/types";
import { useAiContentDraft } from "../features/ai-content/useAiContentDraft";
import { DEMO_BRAND_ID } from "../lib/apiClient";

function serializableDraft(draft: AiContentDraft): AiContentDraft {
  return {
    ...draft,
    subjectAttachments: (draft.subjectAttachments ?? []).map(({ file: _file, ...attachment }) => attachment),
    brief: draft.brief ? { ...draft.brief, attachments: draft.brief.attachments.map(({ file: _file, ...attachment }) => attachment) } : null,
  };
}

export function AiContentWizardPage({ gateway = aiContentApiGateway, brandId = DEMO_BRAND_ID }: { gateway?: AiContentGateway; brandId?: string }) {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const queryType = params.get("type");
  const initialType = (["card_news", "blog", "marketing"] as const).includes(queryType as AiContentType) ? queryType as AiContentType : null;
  const state = useAiContentDraft(initialType);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const valid = state.step === 1 ? Boolean(state.draft.type) : state.step === 3 ? Boolean(state.draft.selectedTarget && state.draft.selectedAppeal) : state.step === 5 ? Boolean(state.draft.brief?.purpose) : true;
  const actions = {
    setType: state.setType,
    setSubjectType: state.setSubjectType,
    setSubjectInput: state.setSubjectInput,
    setSubjectAttachments: state.setSubjectAttachments,
    setSubjectAnalysis: state.setSubjectAnalysis,
    setSelectedSubjectImages: state.setSelectedSubjectImages,
    setTarget: state.setTarget,
    setAppeal: state.setAppeal,
    setReferences: state.setReferences,
    reorderReference: state.reorderReference,
    setBrief: state.setBrief,
  };

  async function prepareAnalysis() {
    if (!state.draft.type) throw new Error("ai_content_type_required");
    const initialDraft = serializableDraft(state.draft);
    const generation = state.generationId ? { id: state.generationId } : await gateway.createAnalysis(brandId, {
      type: state.draft.type,
      title: state.draft.subjectInput.name || `${state.draft.type} 콘텐츠`,
      draft: initialDraft,
      idempotencyKey: state.analysisIdempotencyKey,
    });
    if (!state.generationId) state.setGenerationId(generation.id);
    const uploadedAttachments = await Promise.all((state.draft.subjectAttachments ?? []).map(async (attachment) => {
      if (!attachment.file || attachment.storageUrl) return attachment;
      return gateway.uploadAttachment(brandId, generation.id, attachment);
    }));
    const finalDraft = serializableDraft({ ...state.draft, subjectAttachments: uploadedAttachments });
    state.setSubjectAttachments(uploadedAttachments);
    await gateway.updateGeneration(brandId, generation.id, { draft: finalDraft, referenceIds: state.draft.referenceIds });
    return { generationId: generation.id, attachments: uploadedAttachments };
  }

  async function generate() {
    if (!state.draft.type || !state.draft.brief || !state.subjectAnalysis) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const initialDraft = serializableDraft(state.draft);
      const generation = state.generationId ? await gateway.getGeneration(brandId, state.generationId) : await gateway.createAnalysis(brandId, {
        type: state.draft.type,
        title: state.draft.subjectInput.name || `${state.draft.type} 콘텐츠`,
        draft: initialDraft,
        idempotencyKey: state.generationIdempotencyKey,
      });
      state.setGenerationId(generation.id);
      const uploadedAttachments = await Promise.all(state.draft.brief.attachments.map(async (attachment: GenerationAttachment) => {
        if (!attachment.file || attachment.storageUrl) return attachment;
        return gateway.uploadAttachment(brandId, generation.id, attachment);
      }));
      const finalDraft = serializableDraft({ ...state.draft, brief: { ...state.draft.brief, attachments: uploadedAttachments } });
      await gateway.updateGeneration(brandId, generation.id, { draft: finalDraft, referenceIds: state.draft.referenceIds });
      await gateway.startGeneration(brandId, generation.id, { idempotencyKey: state.generationIdempotencyKey, outputCount: finalDraft.brief?.outputCount ?? 1 });
      navigate(`/ai-content/${generation.id}`);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "ai_content_generation_failed");
    } finally {
      setSubmitting(false);
    }
  }

  return <div className="content ai-content-wizard">
    <header className="wizard-header" data-guide="page-header"><div><p>AI 콘텐츠 스튜디오</p><h1>새 AI 콘텐츠</h1></div><div className="wizard-header-actions"><div className="wizard-step-current"><strong>{state.step} / 5</strong><span>{wizardStepNames[state.step - 1]}</span></div><PageGuideButton /></div></header>
    <ol className="wizard-progress" aria-label="생성 단계">{wizardStepNames.map((name, index) => <li key={name} aria-current={state.step === index + 1 ? "step" : undefined}><span>{index + 1}</span>{name}</li>)}</ol>
    <div className="wizard-workspace"><AiContentWizardSteps step={state.step} draft={state.draft} actions={{ ...actions, setSubjectAnalysis: (value) => { state.setSubjectAnalysis(value); if (value && (value.status === "ready" || value.status === "partial")) state.setStep(3); } }} gateway={gateway} brandId={brandId} generationId={state.generationId} analysis={state.subjectAnalysis} onPrepareAnalysis={prepareAnalysis} /></div>
    {submitError ? <p className="wizard-error" role="alert">콘텐츠 생성을 시작하지 못했습니다. 다시 시도해 주세요.</p> : null}
    <footer className="wizard-actions">{state.step > 1 ? <button type="button" className="button" onClick={state.goBack}><ChevronLeft size={17} />이전</button> : <span />}{state.step === 2 ? <span /> : state.step < 5 ? <button type="button" className="button primary" disabled={!valid} onClick={state.goNext}>다음<ChevronRight size={17} /></button> : <button type="button" className="button primary" disabled={!valid || submitting} onClick={() => void generate()}>{submitting ? <LoaderCircle className="inline-spinner" size={17} /> : <Sparkles size={17} />}{submitting ? "생성 요청 중" : "생성 시작"}</button>}</footer>
  </div>;
}
