export type BrandAnalysisStatus = "queued" | "extracting" | "analyzing" | "review_ready" | "confirmed" | "failed";

export interface BrandIntelligenceResult {
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

export interface BrandAnalysis {
  id: string;
  brandId: string;
  status: BrandAnalysisStatus;
  input: { ownedUrl: string | null; uploadIds: string[] };
  result: BrandIntelligenceResult | null;
  editedResult: BrandIntelligenceResult | null;
  effectiveResult: BrandIntelligenceResult | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  confirmedAt: string | null;
}

export interface BrandIntelligenceGateway {
  getCurrent(brandId: string): Promise<BrandAnalysis | null>;
  getAnalysis(brandId: string, analysisId: string): Promise<BrandAnalysis>;
  requestAnalysis(brandId: string, input: {
    ownedUrl: string | null;
    uploadIds: string[];
    idempotencyKey: string;
  }): Promise<BrandAnalysis>;
  uploadFile(brandId: string, uploadSessionId: string, file: File): Promise<string>;
  updateDraft(brandId: string, analysisId: string, editedResult: BrandIntelligenceResult): Promise<BrandAnalysis>;
  confirm(brandId: string, analysisId: string): Promise<BrandAnalysis>;
}
