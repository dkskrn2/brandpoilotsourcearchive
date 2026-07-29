export type PreviewStep = "sources" | "analysis" | "approval" | "generation";
export type PreviewAsyncState = "idle" | "loading" | "succeeded" | "failed";
export type ReviewStatus = "ai_draft" | "confirmed" | "approved";
export type KnowledgeKind =
  | "faq"
  | "policy"
  | "how_to"
  | "guide"
  | "product_service";

export interface PreviewFile {
  id: string;
  name: string;
  size: number;
  status: "selected";
}

export interface PreviewBrandCore {
  oneLine: string;
  description: string;
  target: string;
  customerProblem: string;
  primaryValue: string;
  differentiators: string[];
  tone: string[];
  priorityMessages: string[];
}

export interface PreviewKnowledgeItem {
  id: string;
  kind: KnowledgeKind;
  title: string;
  content: string;
  reviewStatus: ReviewStatus;
  origin: "ai" | "user";
}

export interface PreviewState {
  currentStep: PreviewStep;
  sources: {
    url: string;
    files: PreviewFile[];
    error: string | null;
  };
  analysis: {
    state: PreviewAsyncState;
    error: string | null;
  };
  activeAnalysisRequestId: string | null;
  brandCore: PreviewBrandCore;
  brandCoreApproved: boolean;
  knowledge: PreviewKnowledgeItem[];
  activeKnowledgeKind: "all" | KnowledgeKind;
  editingKnowledgeId: string | null;
  generation: {
    state: PreviewAsyncState;
    error: string | null;
  };
  activeGenerationRequestId: string | null;
  announcement: string;
}
