export type BrandEvidenceSourceType = "owned_url" | "text" | "markdown" | "pdf" | "csv" | "xlsx";

export interface BrandEvidenceDocument {
  sourceId: string;
  sourceType: BrandEvidenceSourceType;
  title: string;
  sourceUrl: string | null;
  textBlocks: Array<{ heading: string | null; text: string }>;
  tables: Array<{ sheet: string | null; headers: string[]; rows: string[][] }>;
  contentHash: string;
}

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

export interface BrandAnalysisJob {
  id: string;
  workspaceId: string;
  brandId: string;
  status: "analyzing";
  input: { ownedUrl: string | null; uploadIds: string[] };
  evidence: BrandEvidenceDocument[];
  result: BrandIntelligenceResult | null;
  editedResult: BrandIntelligenceResult | null;
  effectiveResult: BrandIntelligenceResult | null;
  idempotencyKey: string;
  isActive: boolean;
  leasedBy: string;
  leaseToken: string;
  leaseExpiresAt: string;
  attemptCount: number;
  availableAt: string;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  confirmedAt: string | null;
}

export interface BrandIntelligenceWorkerClient {
  claim(workerId: string, leaseSeconds: number): Promise<BrandAnalysisJob | null>;
  heartbeat(job: BrandAnalysisJob, leaseSeconds: number): Promise<void>;
  complete(job: BrandAnalysisJob, result: BrandIntelligenceResult, leaseSeconds: number): Promise<void>;
  fail(job: BrandAnalysisJob, input: {
    errorCode: string;
    errorMessage: string;
    retryable: boolean;
    leaseSeconds: number;
  }): Promise<void>;
}
