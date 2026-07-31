export type BrandAnalysisStatus =
  | "queued"
  | "accepting_uploads"
  | "waiting_for_resource"
  | "extracting"
  | "analyzing"
  | "running"
  | "finalizing"
  | "review_ready"
  | "confirmed"
  | "failed"
  | "cancel_requested"
  | "purging"
  | "cancelled";

export interface BrandIntelligenceResultV1 {
  contractVersion: "brand-intelligence-result.v1";
  companyOverview: string;
  businessDescription: string;
  primaryCategory: { code: string | null; name: string };
  subcategories: Array<{ code: string | null; name: string }>;
  primaryTarget: string;
  differentiators: string;
  coreAppeal: string;
  competitors: Array<{ name: string; description: string; sourceUrls: string[] }>;
  evidence: Array<{ field: string; claim: string; sourceId: string; sourceUrl: string | null }>;
  sourceGaps: string[];
}

export interface BrandOfferingV2 {
  kind: "product" | "service";
  name: string;
  description: string | null;
  target: string | null;
  benefit: string | null;
  priceText: string | null;
  purchaseUrl: string | null;
  sourceFactIds: string[];
}

export interface CompanyNameSuggestionV2 {
  name: string;
  sourceFactIds: string[];
}

export type FaqSuggestionCategoryV2 =
  | "service"
  | "product"
  | "price"
  | "location"
  | "operation"
  | "other";

export interface FaqSuggestionV2 {
  question: string;
  answer: string;
  category: FaqSuggestionCategoryV2;
  sourceFactIds: string[];
}

export interface BrandIntelligenceResultV2 {
  contractVersion: "brand-intelligence-result.v2";
  companyNameSuggestion: CompanyNameSuggestionV2 | null;
  oneLineDefinition: string | null;
  companyOverview: string | null;
  businessDescription: string | null;
  primaryCategory: { code: string | null; name: string } | null;
  subcategories: Array<{ code: string | null; name: string }>;
  primaryTarget: string | null;
  secondaryTargets: string[];
  customerNeeds: string[];
  valueProposition: string | null;
  differentiators: string[];
  coreAppeal: string | null;
  supportingAppeals: string[];
  offerings: BrandOfferingV2[];
  faqSuggestions: FaqSuggestionV2[];
  keywords: string[];
  observedTone: { summary: string; sourceFactIds: string[] } | null;
  competitors: Array<{ name: string; description: string; sourceUrls: string[] }>;
  marketContext: Array<{ claim: string; sourceUrls: string[] }>;
  evidence: Array<{
    fieldPath: string;
    claim: string;
    sourceId: string;
    sourceUrl: string | null;
    excerpt: string;
    sourceKind: "owned" | "external" | "upload";
  }>;
  sourceGaps: string[];
}

export type BrandIntelligenceResult = BrandIntelligenceResultV1 | BrandIntelligenceResultV2;

export interface BrandAnalysis {
  id: string;
  brandId: string;
  status: BrandAnalysisStatus;
  input: { companyName?: string | null; ownedUrl: string | null; uploadIds: string[] };
  result: BrandIntelligenceResult | null;
  editedResult: BrandIntelligenceResult | null;
  effectiveResult: BrandIntelligenceResult | null;
  pipelineVersion?: number;
  contractVersion?: string;
  currentStage?: string | null;
  selectedPageCount?: number;
  successfulPageCount?: number;
  failedPageCount?: number;
  requiredPageCount?: number;
  completedCliStageCount?: number;
  totalCliStageCount?: number;
  activeStartedAt?: string | null;
  deadlineAt?: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  confirmedAt: string | null;
}

export interface BrandOnboardingContext {
  companyName: string;
  companyNameState: "provisional" | "legacy_unknown" | "confirmed";
  activeAnalysis: BrandAnalysis | null;
}

export interface BrandIntelligenceGateway {
  getCurrent(brandId: string): Promise<BrandAnalysis | null>;
  getWorkflow(brandId: string): Promise<BrandAnalysis | null>;
  getOnboarding?(brandId: string): Promise<BrandOnboardingContext>;
  getAnalysis(brandId: string, analysisId: string, signal?: AbortSignal): Promise<BrandAnalysis>;
  requestAnalysis(brandId: string, input: {
    companyName?: string;
    ownedUrl: string | null;
    files?: File[];
    uploadIds?: string[];
    idempotencyKey: string;
  }): Promise<BrandAnalysis>;
  uploadFile(brandId: string, uploadSessionId: string, file: File): Promise<string>;
  updateDraft(brandId: string, analysisId: string, editedResult: BrandIntelligenceResult): Promise<BrandAnalysis>;
  cancel?(brandId: string, analysisId: string): Promise<BrandAnalysis>;
  retry?(brandId: string, analysisId: string): Promise<BrandAnalysis>;
  confirm(
    brandId: string,
    analysisId: string,
    companyName?: string,
    editedResult?: BrandIntelligenceResult,
  ): Promise<BrandAnalysis>;
}
