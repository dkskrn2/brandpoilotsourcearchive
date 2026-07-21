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

export interface SubjectAnalysisResultV2 {
  contractVersion: "subject-analysis-result.v2";
  phase: "analysis";
  subjectType: SubjectType;
  summary: string;
  verifiedFacts: Array<{ claim: string; support: string; sourceUrl: string }>;
  voc: Array<{ quoteSummary: string; context: string; sourceUrl: string }>;
  alternatives: Array<{ name: string; strengths: string[]; limitations: string[]; sourceUrls: string[] }>;
  barriers: Array<{ barrier: string; evidence: string; sourceUrls: string[] }>;
  productProfile: Record<string, unknown> | null;
  serviceProfile: Record<string, unknown> | null;
  serviceSubtype: ServiceSubtype | null;
  sourceGaps: string[];
}

export interface SubjectWorkerClient {
  claim(workerId: string, leaseSeconds: number): Promise<SubjectAnalysisJob | null>;
  heartbeat(job: SubjectAnalysisJob, leaseSeconds: number): Promise<void>;
  complete(job: SubjectAnalysisJob, result: SubjectAnalysisResult, leaseSeconds: number): Promise<void>;
  fail(job: SubjectAnalysisJob, input: { errorCode: string; errorMessage: string; retryable: boolean; leaseSeconds: number }): Promise<void>;
}
