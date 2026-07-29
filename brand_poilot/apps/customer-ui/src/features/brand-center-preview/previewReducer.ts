import type {
  KnowledgeKind,
  PreviewBrandCore,
  PreviewFile,
  PreviewKnowledgeItem,
  PreviewState,
  PreviewStep,
} from "./types";

export type PreviewAction =
  | { type: "source/urlChanged"; url: string }
  | { type: "source/filesAdded"; files: PreviewFile[] }
  | { type: "source/fileRemoved"; id: string }
  | { type: "source/errorChanged"; error: string | null }
  | { type: "step/selected"; step: PreviewStep }
  | { type: "analysis/requested"; requestId: string }
  | { type: "analysis/succeeded"; requestId: string }
  | { type: "analysis/failed"; requestId: string; error: string }
  | { type: "core/changed"; brandCore: PreviewBrandCore }
  | { type: "approval/coreApproved" }
  | { type: "knowledge/tabSelected"; kind: "all" | KnowledgeKind }
  | { type: "knowledge/editingOpened"; id: string }
  | { type: "knowledge/editingClosed" }
  | { type: "knowledge/created"; item: PreviewKnowledgeItem }
  | { type: "knowledge/updated"; item: PreviewKnowledgeItem }
  | { type: "knowledge/deleted"; id: string }
  | { type: "knowledge/approved"; id: string }
  | { type: "knowledge/allApproved" }
  | { type: "generation/requested"; requestId: string }
  | { type: "generation/succeeded"; requestId: string }
  | { type: "generation/failed"; requestId: string; error: string };

export function hasSource(state: PreviewState): boolean {
  return Boolean(state.sources.url.trim() || state.sources.files.length);
}

export function approvalsComplete(state: PreviewState): boolean {
  return state.brandCoreApproved
    && state.knowledge.every((item) => item.reviewStatus !== "ai_draft");
}

export function isBrandCoreComplete(brandCore: PreviewBrandCore): boolean {
  return [
    brandCore.oneLine,
    brandCore.description,
    brandCore.target,
    brandCore.customerProblem,
    brandCore.primaryValue,
  ].every((value) => value.trim())
    && [
      brandCore.differentiators,
      brandCore.tone,
      brandCore.priorityMessages,
    ].every((values) => values.some((value) => value.trim()));
}

export function canEnterStep(
  state: PreviewState,
  step: PreviewStep,
): boolean {
  if (step === "sources") return true;
  if (step === "analysis") return hasSource(state);
  if (step === "approval") return state.analysis.state === "succeeded";
  return state.analysis.state === "succeeded" && approvalsComplete(state);
}

function resetGeneration(state: PreviewState): PreviewState {
  return {
    ...state,
    generation: { state: "idle", error: null },
    activeGenerationRequestId: null,
  };
}

function invalidateAfterSourceChange(state: PreviewState): PreviewState {
  return {
    ...state,
    currentStep: "sources",
    analysis: { state: "idle", error: null },
    activeAnalysisRequestId: null,
    brandCoreApproved: false,
    knowledge: state.knowledge.map((item) => ({
      ...item,
      reviewStatus: item.origin === "ai" ? "ai_draft" : "confirmed",
    })),
    editingKnowledgeId: null,
    generation: { state: "idle", error: null },
    activeGenerationRequestId: null,
    announcement: "자료가 변경되어 분석과 승인을 다시 진행해야 합니다.",
  };
}

function assertNever(action: never): never {
  const type = (action as { type?: unknown }).type;
  throw new Error(`Unknown preview action: ${String(type)}`);
}

export function previewReducer(
  state: PreviewState,
  action: PreviewAction,
): PreviewState {
  switch (action.type) {
    case "source/urlChanged":
      return invalidateAfterSourceChange({
        ...state,
        sources: { ...state.sources, url: action.url, error: null },
      });
    case "source/filesAdded":
      return invalidateAfterSourceChange({
        ...state,
        sources: {
          ...state.sources,
          files: [...state.sources.files, ...action.files],
          error: null,
        },
      });
    case "source/fileRemoved":
      return invalidateAfterSourceChange({
        ...state,
        sources: {
          ...state.sources,
          files: state.sources.files.filter((file) => file.id !== action.id),
          error: null,
        },
      });
    case "source/errorChanged":
      return {
        ...state,
        sources: { ...state.sources, error: action.error },
      };
    case "step/selected":
      if (!canEnterStep(state, action.step)) return state;
      if (action.step !== "generation"
        && state.generation.state === "loading") {
        return {
          ...state,
          currentStep: action.step,
          generation: { state: "idle", error: null },
          activeGenerationRequestId: null,
          announcement: "카드뉴스 생성을 중단했습니다.",
        };
      }
      return { ...state, currentStep: action.step };
    case "analysis/requested":
      if (state.analysis.state === "loading") return state;
      if (!hasSource(state)) return state;
      return {
        ...state,
        currentStep: "analysis",
        analysis: { state: "loading", error: null },
        activeAnalysisRequestId: action.requestId,
        brandCoreApproved: false,
        knowledge: state.knowledge.map((item) => ({
          ...item,
          reviewStatus: item.origin === "ai" ? "ai_draft" : "confirmed",
        })),
        generation: { state: "idle", error: null },
        activeGenerationRequestId: null,
        announcement: "브랜드 자료 분석을 시작했습니다.",
      };
    case "analysis/succeeded":
      if (state.analysis.state !== "loading"
        || state.activeAnalysisRequestId !== action.requestId) return state;
      return {
        ...state,
        analysis: { state: "succeeded", error: null },
        activeAnalysisRequestId: null,
        announcement: "브랜드 자료 분석을 완료했습니다.",
      };
    case "analysis/failed":
      if (state.analysis.state !== "loading"
        || state.activeAnalysisRequestId !== action.requestId) return state;
      return {
        ...state,
        analysis: { state: "failed", error: action.error },
        activeAnalysisRequestId: null,
        announcement: action.error,
      };
    case "core/changed":
      if (!canEnterStep(state, "approval")) return state;
      return {
        ...resetGeneration(state),
        brandCore: action.brandCore,
        brandCoreApproved: false,
        announcement: "Brand Core가 변경되어 다시 승인해야 합니다.",
      };
    case "approval/coreApproved":
      if (!canEnterStep(state, "approval")) return state;
      if (!isBrandCoreComplete(state.brandCore)) return state;
      return {
        ...state,
        currentStep: "approval",
        brandCoreApproved: true,
        announcement: "Brand Core를 승인했습니다.",
      };
    case "knowledge/tabSelected":
      if (!canEnterStep(state, "approval")) return state;
      return { ...state, activeKnowledgeKind: action.kind };
    case "knowledge/editingOpened":
      if (!canEnterStep(state, "approval")) return state;
      if (!state.knowledge.some((item) => item.id === action.id)) return state;
      return { ...state, editingKnowledgeId: action.id };
    case "knowledge/editingClosed":
      return { ...state, editingKnowledgeId: null };
    case "knowledge/created":
      if (!canEnterStep(state, "approval")) return state;
      if (state.knowledge.some((item) => item.id === action.item.id)) return state;
      return {
        ...resetGeneration(state),
        knowledge: [
          ...state.knowledge,
          {
            id: action.item.id,
            kind: action.item.kind,
            title: action.item.title,
            content: action.item.content,
            origin: "user",
            reviewStatus: "confirmed",
          },
        ],
        editingKnowledgeId: null,
        announcement: "지식 항목을 추가했습니다.",
      };
    case "knowledge/updated":
      if (!canEnterStep(state, "approval")) return state;
      {
        const existing = state.knowledge.find(
          (item) => item.id === action.item.id,
        );
        if (!existing) return state;
        return {
          ...resetGeneration(state),
          knowledge: state.knowledge.map((item) =>
            item.id === existing.id
              ? {
                ...existing,
                kind: action.item.kind,
                title: action.item.title,
                content: action.item.content,
                reviewStatus: existing.origin === "ai"
                  ? "ai_draft"
                  : "confirmed",
              }
              : item),
          editingKnowledgeId: null,
          announcement: "지식 항목이 변경되어 다시 승인해야 합니다.",
        };
      }
    case "knowledge/deleted":
      if (!canEnterStep(state, "approval")) return state;
      if (!state.knowledge.some((item) => item.id === action.id)) return state;
      return {
        ...resetGeneration(state),
        knowledge: state.knowledge.filter((item) => item.id !== action.id),
        editingKnowledgeId: null,
        announcement: "지식 항목을 삭제했습니다.",
      };
    case "knowledge/approved":
      if (!canEnterStep(state, "approval")) return state;
      if (!state.knowledge.some((item) =>
        item.id === action.id
        && item.origin === "ai"
        && item.reviewStatus === "ai_draft")) return state;
      return {
        ...resetGeneration(state),
        knowledge: state.knowledge.map((item) =>
          item.id === action.id && item.origin === "ai"
            ? { ...item, reviewStatus: "approved" }
            : item),
        announcement: "AI 지식 초안을 승인했습니다.",
      };
    case "knowledge/allApproved":
      if (!canEnterStep(state, "approval")) return state;
      return {
        ...resetGeneration(state),
        knowledge: state.knowledge.map((item) =>
          item.reviewStatus === "ai_draft"
            ? { ...item, reviewStatus: "approved" }
            : item),
        announcement: "모든 AI 지식 초안을 승인했습니다.",
      };
    case "generation/requested":
      if (state.generation.state === "loading") return state;
      if (state.analysis.state !== "succeeded"
        || !isBrandCoreComplete(state.brandCore)) return state;
      return {
        ...state,
        currentStep: "generation",
        brandCoreApproved: true,
        knowledge: state.knowledge.map((item) =>
          item.reviewStatus === "ai_draft"
            ? { ...item, reviewStatus: "approved" }
            : item),
        generation: { state: "loading", error: null },
        activeGenerationRequestId: action.requestId,
        announcement: "브랜드 정보를 저장하고 카드뉴스 생성을 시작했습니다.",
      };
    case "generation/succeeded":
      if (state.currentStep !== "generation"
        || state.generation.state !== "loading"
        || state.activeGenerationRequestId !== action.requestId) return state;
      return {
        ...state,
        generation: { state: "succeeded", error: null },
        activeGenerationRequestId: null,
        announcement: "카드뉴스 생성을 완료했습니다.",
      };
    case "generation/failed":
      if (state.currentStep !== "generation"
        || state.generation.state !== "loading"
        || state.activeGenerationRequestId !== action.requestId) return state;
      return {
        ...state,
        generation: { state: "failed", error: action.error },
        activeGenerationRequestId: null,
        announcement: action.error,
      };
    default:
      return assertNever(action);
  }
}
