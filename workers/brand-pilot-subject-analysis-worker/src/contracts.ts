export type SubjectType = "product" | "service";
export type SubjectImageRole = "product" | "service" | "logo" | "detail" | "unknown";
export type SubjectEvidenceType = "product_fact" | "public_research" | "manual_input";
export type ServiceSubtype =
  | "saas"
  | "consulting"
  | "education"
  | "agency"
  | "subscription"
  | "professional"
  | "other_service";

export interface SubjectTarget {
  id: string;
  name: string;
  traits: string[];
  painPoints: string[];
  purchaseMotivations: string[];
  uspEvidence: Array<{ claim: string; support: string; sourceUrl: string }>;
}

export interface SubjectAppeal {
  id: string;
  targetId: string;
  title: string;
  description: string;
  evidenceType: SubjectEvidenceType;
  connectionReason: string;
  sources: Array<{ title: string; url: string }>;
}

export interface SubjectAnalysisJob {
  analysisId: string;
  workerId: string;
  leaseToken: string;
  leaseExpiresAt: string;
  contractVersion: "subject-analysis.v1";
  brand: { name: string; primaryCategory: string; subcategories: string[]; brandColor: string };
  subject: { type: SubjectType; sourceUrl: string; manualInput: { name: string; promotion: string; description: string } };
  extracted: {
    facts: Array<{ key: string; value: string; sourceUrl: string }>;
    structuredData: Record<string, unknown>;
    imageCandidates: Array<{
      id: string;
      sourceUrl: string;
      storageUrl: string;
      width: number | null;
      height: number | null;
      mimeType: string;
      altText: string;
      role: SubjectImageRole;
    }>;
  };
  researchPolicy: { publicWebSearch: true; allowedPurposes: ["voc", "alternatives", "market_context"]; requireSourceUrl: true };
}

export interface SubjectAnalysisResult {
  contractVersion: "subject-analysis-result.v1";
  summary: string;
  needs: Array<{ text: string; sourceUrl: string }>;
  alternatives: Array<{ name: string; strengths: string[]; limitations: string[]; sourceUrls: string[] }>;
  voc: Array<{ quoteSummary: string; context: string; sourceUrl: string }>;
  usps: Array<{ claim: string; support: string; sourceUrl: string }>;
  targets: [SubjectTarget, SubjectTarget, SubjectTarget];
  appealsByTarget: Record<string, SubjectAppeal[]>;
  recommendedImageId: string | null;
  sourceGaps: string[];
}

export interface SubjectAnalysisInputV2 {
  contractVersion: "subject-analysis.v2";
  phase: "analysis";
  brandContext: Record<string, unknown>;
  subject: {
    type: SubjectType;
    sourceUrl: string | null;
    attachmentIds: string[];
    manualInput: { name: string; promotionOrTerms: string; description: string };
  };
  extracted: {
    documents: Array<{ attachmentId: string; fileName: string; mimeType: string; text: string }>;
    images: Array<{
      attachmentId: string;
      sourceUrl: string;
      storageUrl: string;
      mimeType: string;
      altText: string;
    }>;
    sourcePage: {
      sourceUrl: string;
      title: string;
      text: string;
      structuredData: Record<string, unknown>;
    } | null;
    sourceGaps: string[];
  };
  sourcePriority: ["manual_input", "attachments", "source_url", "brand_context", "public_research"];
}

export interface SubjectAnalysisJobV2 extends SubjectAnalysisInputV2 {
  analysisId: string;
  workerId: string;
  leaseToken: string;
  leaseExpiresAt: string;
}

export interface SubjectProductProfileV2 {
  name: string;
  category: string;
  specifications: string[];
  materials: string[];
  options: string[];
  price: string;
  discountsAndPromotions: string[];
  shipping: string[];
  returns: string[];
  functions: Array<{ function: string; benefit: string; purchaseReason: string }>;
  useContexts: string[];
  purchaseBarriers: string[];
  reviewPatterns: { recurringSatisfaction: string[]; recurringComplaints: string[] };
  productImageCandidates: Array<{ attachmentId: string; reason: string }>;
  detailImageCandidates: Array<{ attachmentId: string; reason: string }>;
}

export interface SubjectServiceProfileV2 {
  customerProblem: string[];
  currentAlternatives: string[];
  deliveryProcess: string[];
  deliverables: string[];
  users: string[];
  buyers: string[];
  price: string;
  beforeAfterWorkflow: { before: string[]; after: string[] };
  afterState: string[];
  terms: { contract: string[]; renewal: string[]; cancellation: string[] };
  support: string[];
  trustEvidence: string[];
  securityEvidence: string[];
  performanceEvidence: string[];
  adoptionBarriers: string[];
}

export interface SubjectAnalysisResultV2ParseContext {
  expectedSubjectType: SubjectType;
  allowedAttachmentIds: readonly string[];
}

export interface SubjectAnalysisResultV2 {
  contractVersion: "subject-analysis-result.v2";
  phase: "analysis";
  subjectType: SubjectType;
  summary: string;
  verifiedFacts: Array<{ claim: string; support: string; sourceUrl: string }>;
  voc: Array<{ quoteSummary: string; context: string; sourceUrl: string }>;
  alternatives: Array<{ name: string; strengths: string[]; limitations: string[]; sourceUrls: string[] }>;
  barriers: Array<{ barrier: string; evidence: string; sourceUrls: string[] }>;
  productProfile: SubjectProductProfileV2 | null;
  serviceProfile: SubjectServiceProfileV2 | null;
  serviceSubtype: ServiceSubtype | null;
  sourceGaps: string[];
}

const PROMPT_INPUT_LIMITS = {
  documents: 10,
  images: 10,
  sourceGaps: 20,
  documentText: 8_000,
  pageText: 12_000,
  structuredNodes: 400,
  structuredCharacters: 12_000,
  structuredDepth: 5,
  structuredArray: 20,
  structuredKeys: 30,
  structuredString: 2_000,
} as const;

const clipped = (value: unknown, max: number): string => typeof value === "string" ? value.slice(0, max) : "";

interface PromptInputBudget {
  nodes: number;
  characters: number;
}

function boundedPromptValue(value: unknown, budget: PromptInputBudget, depth = 0): unknown {
  if (budget.nodes >= PROMPT_INPUT_LIMITS.structuredNodes
    || budget.characters >= PROMPT_INPUT_LIMITS.structuredCharacters
    || depth > PROMPT_INPUT_LIMITS.structuredDepth) return "[truncated]";
  budget.nodes += 1;
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const remaining = PROMPT_INPUT_LIMITS.structuredCharacters - budget.characters;
    const result = value.slice(0, Math.min(PROMPT_INPUT_LIMITS.structuredString, remaining));
    budget.characters += result.length;
    return result;
  }
  if (Array.isArray(value)) {
    return value.slice(0, PROMPT_INPUT_LIMITS.structuredArray)
      .map((item) => boundedPromptValue(item, budget, depth + 1));
  }
  if (!value || typeof value !== "object") return null;
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of Reflect.ownKeys(value).filter((entry): entry is string => typeof entry === "string")
    .filter((entry) => entry !== "__proto__" && entry !== "prototype" && entry !== "constructor")
    .slice(0, PROMPT_INPUT_LIMITS.structuredKeys)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !("value" in descriptor)) continue;
    result[clipped(key, 200)] = boundedPromptValue(descriptor.value, budget, depth + 1);
  }
  return result;
}

const boundedRecord = (value: unknown): Record<string, unknown> => {
  const projected = boundedPromptValue(value, { nodes: 0, characters: 0 });
  return projected && typeof projected === "object" && !Array.isArray(projected)
    ? projected as Record<string, unknown>
    : {};
};

export function projectSubjectAnalysisPromptInput(job: SubjectAnalysisJobV2): Record<string, unknown> {
  const documents = Array.isArray(job.extracted?.documents) ? job.extracted.documents : [];
  const images = Array.isArray(job.extracted?.images) ? job.extracted.images : [];
  const sourceGaps = Array.isArray(job.extracted?.sourceGaps) ? job.extracted.sourceGaps : [];
  const attachmentIds = Array.isArray(job.subject?.attachmentIds) ? job.subject.attachmentIds : [];
  const page = job.extracted?.sourcePage;
  return {
    brandContext: boundedRecord(job.brandContext),
    manualInput: {
      name: clipped(job.subject?.manualInput?.name, 200),
      promotionOrTerms: clipped(job.subject?.manualInput?.promotionOrTerms, 500),
      description: clipped(job.subject?.manualInput?.description, 2_000),
    },
    attachments: {
      attachmentIds: attachmentIds.slice(0, 10).map((value) => clipped(value, 36)),
      documents: documents.slice(0, PROMPT_INPUT_LIMITS.documents).map((document) => ({
        attachmentId: clipped(document?.attachmentId, 36),
        fileName: clipped(document?.fileName, 500),
        mimeType: clipped(document?.mimeType, 200),
        text: clipped(document?.text, PROMPT_INPUT_LIMITS.documentText),
      })),
      images: images.slice(0, PROMPT_INPUT_LIMITS.images).map((image) => ({
        attachmentId: clipped(image?.attachmentId, 36),
        sourceUrl: clipped(image?.sourceUrl, 2_048),
        storageUrl: clipped(image?.storageUrl, 2_048),
        mimeType: clipped(image?.mimeType, 200),
        altText: clipped(image?.altText, 500),
      })),
    },
    sourceUrl: {
      requestedUrl: job.subject?.sourceUrl === null ? null : clipped(job.subject?.sourceUrl, 2_048),
      extractedPage: page ? {
        sourceUrl: clipped(page.sourceUrl, 2_048),
        title: clipped(page.title, 500),
        text: clipped(page.text, PROMPT_INPUT_LIMITS.pageText),
        structuredData: boundedRecord(page.structuredData),
      } : null,
    },
    publicSearchPolicy: {
      allowedPurposes: ["voc", "alternatives", "market_context"],
      requireEvidenceUrl: true,
    },
    sourceGaps: sourceGaps.slice(0, PROMPT_INPUT_LIMITS.sourceGaps).map((value) => clipped(value, 500)),
    sourcePriority: ["manual_input", "attachments", "source_url", "brand_context", "public_research"],
  };
}

export interface SubjectWorkerClient {
  claim(workerId: string, leaseSeconds: number): Promise<SubjectAnalysisJob | null>;
  heartbeat(job: SubjectAnalysisJob, leaseSeconds: number): Promise<void>;
  complete(job: SubjectAnalysisJob, result: SubjectAnalysisResult, leaseSeconds: number): Promise<void>;
  fail(job: SubjectAnalysisJob, input: { errorCode: string; errorMessage: string; retryable: boolean; leaseSeconds: number }): Promise<void>;
}
