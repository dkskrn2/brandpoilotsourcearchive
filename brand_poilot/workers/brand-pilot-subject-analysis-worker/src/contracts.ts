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

export interface SubjectAppealInputV2 {
  contractVersion: "subject-analysis.v2";
  phase: "appeal";
  brandContext: Record<string, unknown>;
  subject: SubjectAnalysisInputV2["subject"];
  analysisResult: SubjectAnalysisResultV2;
  sourcePriority: SubjectAnalysisInputV2["sourcePriority"];
}

export interface SubjectAppealJobV2 extends SubjectAppealInputV2 {
  analysisId: string;
  workerId: string;
  leaseToken: string;
  leaseExpiresAt: string;
}

export interface SubjectAppealResultV2 {
  contractVersion: "subject-appeal-result.v2";
  phase: "appeal";
  targets: [SubjectTarget, SubjectTarget, SubjectTarget];
  appealsByTarget: Record<string, SubjectAppeal[]>;
}

export interface SubjectAppealResultV2ParseContext {
  allowedAttachmentIds: readonly string[];
}

export type SubjectWorkerJob = SubjectAnalysisJob | SubjectAnalysisJobV2 | SubjectAppealJobV2;
export type SubjectWorkerResult = SubjectAnalysisResult | SubjectAnalysisResultV2 | SubjectAppealResultV2;

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

export function projectSubjectAppealPromptInput(job: SubjectAppealJobV2): Record<string, unknown> {
  const attachmentIds = Array.isArray(job.subject?.attachmentIds) ? job.subject.attachmentIds : [];
  const sourceGaps = Array.isArray(job.analysisResult?.sourceGaps) ? job.analysisResult.sourceGaps : [];
  return {
    brandContext: boundedRecord(job.brandContext),
    subject: {
      type: job.subject?.type,
      sourceUrl: job.subject?.sourceUrl === null ? null : clipped(job.subject?.sourceUrl, 2_048),
      attachmentIds: attachmentIds.slice(0, 10).map((value) => clipped(value, 36)),
      manualInput: {
        name: clipped(job.subject?.manualInput?.name, 200),
        promotionOrTerms: clipped(job.subject?.manualInput?.promotionOrTerms, 500),
        description: clipped(job.subject?.manualInput?.description, 2_000),
      },
    },
    analysisResult: {
      ...boundedRecord(job.analysisResult),
      sourceGaps: sourceGaps.slice(0, PROMPT_INPUT_LIMITS.sourceGaps).map((value) => clipped(value, 500)),
    },
    sourcePriority: ["manual_input", "attachments", "source_url", "brand_context", "public_research"],
  };
}

export class SubjectAppealContractError extends Error {
  readonly retryable = false;
  constructor(message: string) {
    super(message);
    this.name = "SubjectAppealContractError";
  }
}

const appealFail = (code: string): never => { throw new SubjectAppealContractError(code); };
const appealRecord = (value: unknown, code: string): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) appealFail(code);
  return value as Record<string, unknown>;
};
const exactAppealRecord = (value: unknown, keys: readonly string[], code: string): Record<string, unknown> => {
  const source = appealRecord(value, code);
  if (Object.keys(source).some((key) => !keys.includes(key))) appealFail(code);
  return source;
};
const appealText = (value: unknown, code: string, max = 2_000): string => {
  const text = typeof value === "string" ? value : appealFail(code);
  const normalized = text.trim();
  if (!normalized || normalized.length > max) appealFail(code);
  return normalized;
};
const appealHttps = (value: unknown, code: string): string => {
  const url = appealText(value, code, 2_048);
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) appealFail(code);
  } catch {
    appealFail(code);
  }
  return url;
};
const APPEAL_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const appealUuid = (value: unknown, code: string): string => {
  const id = appealText(value, code, 36);
  if (!APPEAL_UUID_PATTERN.test(id)) appealFail(code);
  return id.toLowerCase();
};
const appealEvidenceUrl = (
  value: unknown,
  allowedAttachmentIds: ReadonlySet<string>,
  code: string,
): string => {
  const url = appealText(value, code, 2_048);
  if (!url.startsWith("attachment://")) return appealHttps(url, code);
  const attachmentId = appealUuid(url.slice("attachment://".length), code);
  if (!allowedAttachmentIds.has(attachmentId)) appealFail("subject_analysis_attachment_not_allowed");
  return `attachment://${attachmentId}`;
};
const appealStrings = (value: unknown, code: string): string[] => {
  const items = Array.isArray(value) ? value : appealFail(code);
  if (items.length > 50) appealFail(code);
  return items.map((item: unknown) => appealText(item, code));
};
const appealList = <T>(
  value: unknown,
  code: string,
  parse: (item: unknown) => T,
  max = 50,
): T[] => {
  const items = Array.isArray(value) ? value : appealFail(code);
  if (items.length > max) appealFail(code);
  return items.map(parse);
};

function assertAppealResultBudget(value: unknown): void {
  const budget = { nodes: 0, characters: 0 };
  const visit = (current: unknown, depth: number): void => {
    budget.nodes += 1;
    if (budget.nodes > 2_000 || depth > 20) appealFail("subject_appeal_v2_payload_limit_exceeded");
    if (typeof current === "string") {
      budget.characters += current.length;
    } else if (Array.isArray(current)) {
      for (const item of current) visit(item, depth + 1);
    } else if (current && typeof current === "object") {
      for (const key of Reflect.ownKeys(current)) {
        if (typeof key !== "string") continue;
        budget.characters += key.length;
        const descriptor = Object.getOwnPropertyDescriptor(current, key);
        if (descriptor && "value" in descriptor) visit(descriptor.value, depth + 1);
      }
    }
    if (budget.characters > 100_000) appealFail("subject_appeal_v2_payload_limit_exceeded");
  };
  visit(value, 0);
}

function parseAppealEvidence(
  value: unknown,
  allowedAttachmentIds: ReadonlySet<string>,
): { claim: string; support: string; sourceUrl: string } {
  const source = exactAppealRecord(value, ["claim", "support", "sourceUrl"], "subject_analysis_evidence_invalid");
  return {
    claim: appealText(source.claim, "subject_analysis_evidence_invalid"),
    support: appealText(source.support, "subject_analysis_evidence_invalid"),
    sourceUrl: appealEvidenceUrl(source.sourceUrl, allowedAttachmentIds, "subject_analysis_source_url_invalid"),
  };
}

function parseAppealTarget(value: unknown, allowedAttachmentIds: ReadonlySet<string>): SubjectTarget {
  const source = exactAppealRecord(
    value,
    ["id", "name", "traits", "painPoints", "purchaseMotivations", "uspEvidence"],
    "subject_analysis_target_invalid",
  );
  return {
    id: appealText(source.id, "subject_analysis_target_invalid", 200),
    name: appealText(source.name, "subject_analysis_target_invalid", 200),
    traits: appealStrings(source.traits, "subject_analysis_target_invalid"),
    painPoints: appealStrings(source.painPoints, "subject_analysis_target_invalid"),
    purchaseMotivations: appealStrings(source.purchaseMotivations, "subject_analysis_target_invalid"),
    uspEvidence: appealList(
      source.uspEvidence,
      "subject_analysis_target_invalid",
      (item) => parseAppealEvidence(item, allowedAttachmentIds),
      20,
    ),
  };
}

function parseAppealItem(value: unknown, allowedAttachmentIds: ReadonlySet<string>): SubjectAppeal {
  const source = exactAppealRecord(
    value,
    ["id", "targetId", "title", "description", "evidenceType", "connectionReason", "sources"],
    "subject_analysis_appeal_invalid",
  );
  if (source.evidenceType !== "product_fact" && source.evidenceType !== "public_research"
    && source.evidenceType !== "manual_input") appealFail("subject_analysis_appeal_invalid");
  const evidenceType = source.evidenceType as SubjectEvidenceType;
  const sources = appealList(source.sources, "subject_analysis_appeal_sources_invalid", (item) => {
    const entry = exactAppealRecord(item, ["title", "url"], "subject_analysis_appeal_sources_invalid");
    return {
      title: appealText(entry.title, "subject_analysis_appeal_sources_invalid", 500),
      url: evidenceType === "public_research"
        ? appealHttps(entry.url, "subject_analysis_appeal_sources_invalid")
        : appealEvidenceUrl(entry.url, allowedAttachmentIds, "subject_analysis_appeal_sources_invalid"),
    };
  }, 20);
  if (source.evidenceType === "public_research" && sources.length === 0) {
    appealFail("subject_analysis_appeal_sources_invalid");
  }
  return {
    id: appealText(source.id, "subject_analysis_appeal_invalid", 200),
    targetId: appealText(source.targetId, "subject_analysis_appeal_invalid", 200),
    title: appealText(source.title, "subject_analysis_appeal_invalid", 500),
    description: appealText(source.description, "subject_analysis_appeal_invalid"),
    evidenceType,
    connectionReason: appealText(source.connectionReason, "subject_analysis_appeal_invalid"),
    sources,
  };
}

export function parseSubjectAppealResultV2(
  value: unknown,
  context: SubjectAppealResultV2ParseContext,
): SubjectAppealResultV2 {
  if (!context || !Array.isArray(context.allowedAttachmentIds) || context.allowedAttachmentIds.length > 20) {
    appealFail("subject_appeal_result_context_invalid");
  }
  const allowedAttachmentIds = new Set(context.allowedAttachmentIds.map((id) => (
    appealUuid(id, "subject_appeal_result_context_invalid")
  )));
  assertAppealResultBudget(value);
  const source = exactAppealRecord(
    value,
    ["contractVersion", "phase", "targets", "appealsByTarget"],
    "subject_appeal_result_v2_invalid",
  );
  if (source.contractVersion !== "subject-appeal-result.v2") appealFail("subject_analysis_result_version_invalid");
  if (source.phase !== "appeal") appealFail("subject_analysis_phase_invalid");
  const rawTargets = Array.isArray(source.targets) ? source.targets : appealFail("subject_analysis_targets_invalid");
  if (rawTargets.length !== 3) appealFail("subject_analysis_targets_invalid");
  const targets = rawTargets.map((target) => parseAppealTarget(target, allowedAttachmentIds)) as [SubjectTarget, SubjectTarget, SubjectTarget];
  const targetIds = new Set(targets.map(({ id }) => id));
  if (targetIds.size !== 3) appealFail("subject_analysis_target_id_duplicate");

  const rawAppeals = appealRecord(source.appealsByTarget, "subject_analysis_appeals_invalid");
  if (Object.keys(rawAppeals).length !== 3
    || Object.keys(rawAppeals).some((targetId) => !targetIds.has(targetId))) {
    appealFail("subject_analysis_appeals_target_invalid");
  }
  const appealsByTarget: Record<string, SubjectAppeal[]> = {};
  const appealIds = new Set<string>();
  for (const targetId of targetIds) {
    const appeals = appealList(
      rawAppeals[targetId],
      "subject_analysis_appeals_invalid",
      (item) => parseAppealItem(item, allowedAttachmentIds),
      20,
    );
    if (appeals.length < 2) appealFail("subject_analysis_appeals_minimum_invalid");
    for (const parsed of appeals) {
      if (parsed.targetId !== targetId) appealFail("subject_analysis_appeals_target_invalid");
      if (appealIds.has(parsed.id)) appealFail("subject_analysis_appeal_id_duplicate");
      appealIds.add(parsed.id);
    }
    appealsByTarget[targetId] = appeals;
  }
  return { contractVersion: "subject-appeal-result.v2", phase: "appeal", targets, appealsByTarget };
}

export interface SubjectWorkerClient {
  claim(workerId: string, leaseSeconds: number): Promise<SubjectWorkerJob | null>;
  heartbeat(job: SubjectWorkerJob, leaseSeconds: number): Promise<void>;
  complete(job: SubjectWorkerJob, result: SubjectWorkerResult, leaseSeconds: number): Promise<void>;
  fail(job: SubjectWorkerJob, input: { errorCode: string; errorMessage: string; retryable: boolean; leaseSeconds: number }): Promise<void>;
}
