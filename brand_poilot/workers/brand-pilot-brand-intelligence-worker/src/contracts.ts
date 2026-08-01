import type { WorkerResourceClient } from "./resourceLease.js";

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
  offerings: Array<{
    kind: "product" | "service";
    name: string;
    description: string | null;
    target: string | null;
    benefit: string | null;
    priceText: string | null;
    purchaseUrl: string | null;
    sourceFactIds: string[];
  }>;
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

export type BrandIntelligenceResult =
  | BrandIntelligenceResultV1
  | BrandIntelligenceResultV2;

export interface BrandIntelligenceValidationRegistry {
  ownedFactIds: string[];
  externalSources: Array<{ sourceId: string; url: string }>;
}

export interface BrandAnalysisJob {
  id: string;
  workspaceId: string;
  brandId: string;
  status: "running";
  input: { companyName?: string | null; ownedUrl: string | null; uploadIds: string[] };
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
  pipelineVersion: 2;
  contractVersion: "brand-intelligence-result.v2";
  executionContract: {
    ownedPageLimit: 20;
    externalPageLimit: 10;
    offeringLimit: 5;
    pipelineVersion: 2;
    promptVersion: "brand-intelligence-v2.1";
    resultContractVersion: "brand-intelligence-result.v2";
  };
  uploads: Array<{
    id: string;
    fileName: string;
    mimeType: string;
    byteSize: number;
    checksum: string;
    accessUrl: string;
  }>;
  activeStartedAt?: string | null;
  deadlineAt?: string | null;
  availableAt: string;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  confirmedAt: string | null;
}

export interface BrandAnalysisProgress {
  stage: string;
  attempt?: number;
  status?: "running" | "succeeded" | "failed" | "cancelled";
  errorCode?: string;
  logicalIndex?: number;
  physicalAttempt?: number;
  inputCount: number;
  successCount: number;
  failedCount: number;
  selectedPageCount?: number;
  successfulPageCount?: number;
  failedPageCount?: number;
  requiredPageCount?: number;
  completedCliStageCount?: number;
  totalCliStageCount?: number;
}

export interface BrandIntelligenceWorkerClient extends WorkerResourceClient {
  cleanup(): Promise<void>;
  claim(workerId: string, leaseSeconds: number): Promise<BrandAnalysisJob | null>;
  heartbeat(job: BrandAnalysisJob, leaseSeconds: number): Promise<void | {
    leaseExpiresAt: string | null;
    deadlineAt: string | null;
  }>;
  progress(job: BrandAnalysisJob, input: BrandAnalysisProgress, leaseSeconds: number): Promise<void>;
  complete(
    job: BrandAnalysisJob,
    result: BrandIntelligenceResult,
    evidence: BrandEvidenceDocument[],
    leaseSeconds: number,
    registry?: BrandIntelligenceValidationRegistry,
  ): Promise<void>;
  cancelled(job: BrandAnalysisJob, leaseSeconds: number): Promise<void>;
  fail(job: BrandAnalysisJob, input: {
    errorCode: string;
    errorMessage: string;
    retryable: boolean;
    leaseSeconds: number;
  }): Promise<void>;
}
