export type BrandCenterAreaState =
  | "empty"
  | "ready"
  | "queued"
  | "extracting"
  | "analyzing"
  | "review_ready"
  | "confirmed"
  | "approved"
  | "review_required"
  | "failed"
  | "unavailable";

export interface BrandCenterSummary {
  source: { state: BrandCenterAreaState };
  analysis: { state: BrandCenterAreaState };
  brandCore: { state: BrandCenterAreaState };
  rules: { state: BrandCenterAreaState };
  products: { state: "unavailable" };
  wiki: { state: "unavailable" };
  avatars: { state: "unavailable" };
}

export interface BrandCore {
  contractVersion: "brand-core.v1";
  companyOverview?: string;
  businessDescription?: string;
  primaryCategory?: { code: string | null; name: string };
  subcategories?: Array<{ code: string | null; name: string }>;
  primaryTarget?: string;
  differentiators?: string[];
  coreAppeal?: string;
  summary: { oneLine: string; description: string };
  audiences: Array<{ name: string; problem: string; desiredOutcome: string }>;
  valueProposition: { primary: string; differentiators: string[]; proofPoints: string[] };
  messaging: {
    appeals: string[];
    tone: string[];
    preferredPhrases: string[];
    brandDirection: string;
    priorityMessages: string[];
  };
}

export type BrandCoreFieldPath =
  | "summary.oneLine"
  | "summary.description"
  | "audiences"
  | "valueProposition.primary"
  | "valueProposition.differentiators"
  | "valueProposition.proofPoints"
  | "messaging.appeals"
  | "messaging.tone"
  | "messaging.preferredPhrases"
  | "messaging.brandDirection"
  | "messaging.priorityMessages";

export interface BrandEvidence {
  fieldPath: BrandCoreFieldPath;
  sourceType: string;
  sourceId: string;
  sourceUrl: string | null;
  excerpt: string;
  confidence: number | null;
}

export type BrandReviewState = Partial<Record<BrandCoreFieldPath, {
  decision: "ai_suggested" | "user_edited" | "approved";
  reviewerUserId: string | null;
  reviewedAt: string | null;
}>>;

export interface BrandCoreVersion {
  id: string;
  sourceAnalysisId: string | null;
  version: number;
  status: "draft" | "approved" | "superseded";
  core: BrandCore;
  evidence: BrandEvidence[];
  reviewState: BrandReviewState;
  approvedAt: string | null;
  updatedAt: string;
}

export interface BrandRules {
  contractVersion: "brand-rules.v2";
  requiredPhrases: string[];
  forbiddenPhrases: string[];
  exaggerationRules: string[];
  ctaRules: { defaultCta: string; allowed: string[] };
  channelRules: Record<string, string[]>;
  autoApprovalRules: { enabled: boolean; conditions: string[] };
}

export interface BrandRuleSet {
  id: string;
  version: number;
  status: "draft" | "approved" | "superseded";
  rules: BrandRules;
  approvedAt: string | null;
  updatedAt: string;
}

export interface BrandCoreWorkspace {
  active: BrandCoreVersion | null;
  draft: BrandCoreVersion | null;
  versions: BrandCoreVersion[];
}

export interface BrandRulesWorkspace {
  active: BrandRuleSet | null;
  draft: BrandRuleSet | null;
  versions: BrandRuleSet[];
}
