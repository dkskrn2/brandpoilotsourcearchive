import { useState } from "react";
import type {
  AiContentDraft,
  AiContentType,
  AiContentWizardStep,
  AppealSnapshot,
  AudienceSnapshot,
  GenerationAttachment,
  GenerationBrief,
  SubjectAnalysis,
  SubjectAppeal,
  SubjectTarget,
  SubjectType,
} from "./types";

export type WizardStep = AiContentWizardStep;

export const DEFAULT_BRAND_COLOR = "#0057B8";

export const emptyBrief = (brandColor = DEFAULT_BRAND_COLOR): GenerationBrief => ({
  purpose: "" as GenerationBrief["purpose"],
  emphasis: "",
  cta: "",
  additionalInstruction: "",
  selectedColor: brandColor,
  attachments: [],
  aspectRatio: "1:1",
  outputCount: 1,
  outputDirections: [""],
});

function legacyAppeal(value: SubjectAppeal | null): AppealSnapshot | null {
  if (!value) return null;
  return {
    id: value.id,
    title: value.title,
    description: value.description,
    evidenceType: value.evidenceType === "product_fact" ? "fact" : value.evidenceType === "public_research" ? "benefit" : "emotion",
  };
}

function legacyAudience(value: SubjectTarget | null): AudienceSnapshot | null {
  if (!value) return null;
  return {
    id: value.id,
    name: value.name,
    situation: value.traits[0] ?? "",
    problem: value.painPoints[0] ?? "",
    motivation: value.purchaseMotivations[0] ?? "",
  };
}

function subjectTargetFromLegacy(value: AudienceSnapshot): SubjectTarget {
  return {
    id: value.id,
    name: value.name,
    traits: [value.situation].filter(Boolean),
    painPoints: [value.problem].filter(Boolean),
    purchaseMotivations: [value.motivation].filter(Boolean),
    uspEvidence: [],
  };
}

function subjectAppealFromLegacy(value: AppealSnapshot, targetId: string): SubjectAppeal {
  return {
    id: value.id,
    targetId,
    title: value.title,
    description: value.description,
    evidenceType: value.evidenceType === "fact" ? "product_fact" : value.evidenceType === "benefit" ? "public_research" : "manual_input",
    connectionReason: "기존 저장 소구점",
    sources: [],
  };
}

export function createInitialAiContentDraft(initialType: AiContentType | null, brandColor = DEFAULT_BRAND_COLOR): AiContentDraft {
  return {
    type: initialType,
    subjectType: null,
    subjectInput: { sourceUrl: "", name: "", promotion: "", description: "" },
    subjectAnalysisId: null,
    subjectAnalysisVersion: null,
    subjectAttachments: [],
    selectedSubjectImageIds: [],
    selectedTarget: null,
    selectedAppeal: null,
    referenceIds: [],
    brief: emptyBrief(brandColor),
    analysisSource: null,
    productUrl: "",
    selectedAnalysisImageIds: [],
    audience: null,
    coreAppeal: null,
    secondaryAppeals: [],
  };
}

export function useAiContentDraft(initialType: AiContentType | null, brandColor = DEFAULT_BRAND_COLOR) {
  const [step, setStep] = useState<WizardStep>(1);
  const [generationId, setGenerationId] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<Record<string, unknown>>({});
  const [subjectAnalysis, setSubjectAnalysis] = useState<SubjectAnalysis | null>(null);
  const [analysisIdempotencyKey] = useState(() => crypto.randomUUID());
  const [generationIdempotencyKey] = useState(() => crypto.randomUUID());
  const [draft, setDraft] = useState<AiContentDraft>(() => createInitialAiContentDraft(initialType, brandColor));

  const patch = (value: Partial<AiContentDraft>) => setDraft((current) => ({ ...current, ...value }));
  const clearSubjectSelection = (current: AiContentDraft) => ({
    ...current,
    subjectAnalysisId: null,
    subjectAnalysisVersion: null,
    selectedSubjectImageIds: [],
    selectedAnalysisImageIds: [],
    selectedTarget: null,
    selectedAppeal: null,
    audience: null,
    coreAppeal: null,
    secondaryAppeals: [],
  });
  const setSubjectInput = (value: Partial<AiContentDraft["subjectInput"]>) => {
    setSubjectAnalysis(null);
    setDraft((current) => ({
      ...clearSubjectSelection(current),
      subjectInput: { ...current.subjectInput, ...value },
      productUrl: value.sourceUrl ?? current.subjectInput.sourceUrl,
    }));
  };

  return {
    step,
    draft,
    generationId,
    analysis,
    subjectAnalysis,
    analysisIdempotencyKey,
    generationIdempotencyKey,
    setGenerationId,
    setAnalysis,
    setSubjectAnalysis: (value: SubjectAnalysis | null) => {
      setSubjectAnalysis(value);
      if (!value) return;
      setDraft((current) => ({
        ...current,
        subjectAnalysisId: value.id,
        subjectAnalysisVersion: value.analysisVersion,
      }));
    },
    setType: (type: AiContentType) => patch({ type }),
    setSubjectType: (subjectType: SubjectType) => {
      setSubjectAnalysis(null);
      setDraft((current) => ({
        ...clearSubjectSelection(current),
        subjectType,
        analysisSource: subjectType === "product" ? "product_url" : "owned",
      }));
    },
    setSubjectInput,
    setSubjectAttachments: (subjectAttachments: GenerationAttachment[]) => {
      setSubjectAnalysis(null);
      setDraft((current) => ({ ...clearSubjectSelection(current), subjectAttachments: [...subjectAttachments] }));
    },
    setAnalysisSource: (analysisSource: AiContentDraft["analysisSource"]) => patch({
      analysisSource,
      subjectType: analysisSource === "product_url" ? "product" : analysisSource === "owned" ? "service" : null,
    }),
    setProductUrl: (productUrl: string) => setSubjectInput({ sourceUrl: productUrl }),
    setSelectedSubjectImages: (selectedSubjectImageIds: string[]) => patch({
      selectedSubjectImageIds: [...selectedSubjectImageIds],
      selectedAnalysisImageIds: [...selectedSubjectImageIds],
    }),
    setSelectedAnalysisImages: (selectedAnalysisImageIds: string[]) => patch({
      selectedSubjectImageIds: [...selectedAnalysisImageIds],
      selectedAnalysisImageIds: [...selectedAnalysisImageIds],
    }),
    setTarget: (selectedTarget: SubjectTarget | null) => setDraft((current) => {
      const sameTarget = selectedTarget !== null && current.selectedTarget?.id === selectedTarget.id;
      return {
        ...current,
        selectedTarget: selectedTarget ? { ...selectedTarget } : null,
        selectedAppeal: sameTarget ? current.selectedAppeal : null,
        audience: legacyAudience(selectedTarget),
        coreAppeal: sameTarget ? current.coreAppeal : null,
        secondaryAppeals: [],
      };
    }),
    setAppeal: (selectedAppeal: SubjectAppeal | null) => setDraft((current) => {
      if (selectedAppeal && current.selectedTarget?.id !== selectedAppeal.targetId) return current;
      return {
        ...current,
        selectedAppeal: selectedAppeal ? { ...selectedAppeal } : null,
        coreAppeal: legacyAppeal(selectedAppeal),
        secondaryAppeals: [],
      };
    }),
    setAudience: (audience: AudienceSnapshot) => setDraft((current) => {
      const selectedTarget = subjectTargetFromLegacy(audience);
      const sameTarget = current.selectedTarget?.id === selectedTarget.id;
      return {
        ...current,
        audience: { ...audience },
        selectedTarget,
        selectedAppeal: sameTarget ? current.selectedAppeal : null,
        coreAppeal: sameTarget ? current.coreAppeal : null,
        secondaryAppeals: [],
      };
    }),
    setAppeals: (coreAppeal: AppealSnapshot, _secondaryAppeals: AppealSnapshot[] = []) => setDraft((current) => {
      const selectedTarget = current.selectedTarget ?? (current.audience ? subjectTargetFromLegacy(current.audience) : null);
      if (!selectedTarget) return current;
      return {
        ...current,
        selectedTarget,
        coreAppeal: { ...coreAppeal },
        secondaryAppeals: [],
        selectedAppeal: subjectAppealFromLegacy(coreAppeal, selectedTarget.id),
      };
    }),
    setReferences: (referenceIds: string[]) => patch({ referenceIds: [...referenceIds] }),
    reorderReference: (from: number, to: number) => setDraft((current) => {
      const referenceIds = [...current.referenceIds];
      if (from < 0 || to < 0 || from >= referenceIds.length || to >= referenceIds.length) return current;
      const [moved] = referenceIds.splice(from, 1);
      referenceIds.splice(to, 0, moved);
      return { ...current, referenceIds };
    }),
    setBrief: (brief: GenerationBrief) => patch({ brief: { ...brief, attachments: [...brief.attachments], outputDirections: [...brief.outputDirections] } }),
    setSelectedColor: (selectedColor: string) => setDraft((current) => ({ ...current, brief: { ...(current.brief ?? emptyBrief(brandColor)), selectedColor } })),
    goNext: () => setStep((current) => Math.min(5, current + 1) as WizardStep),
    goBack: () => setStep((current) => Math.max(1, current - 1) as WizardStep),
    setStep: (next: WizardStep) => setStep(next),
  };
}
