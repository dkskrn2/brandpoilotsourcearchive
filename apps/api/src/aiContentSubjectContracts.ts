export type SubjectType = "product" | "service";
export type SubjectAnalysisStatus = "queued" | "extracting" | "researching" | "ready" | "partial" | "failed";
export type SubjectEvidenceType = "product_fact" | "public_research" | "manual_input";
export type SubjectResearchPurpose = "voc" | "alternatives" | "market_context";

export interface SubjectManualInput { name: string; promotion: string; description: string }
export interface CreateSubjectAnalysisInput {
  subjectType: SubjectType;
  sourceUrl: string;
  manualInput: SubjectManualInput;
  idempotencyKey: string;
  force: boolean;
}
export interface SubjectAnalysisSelectionInput { imageId: string }
export interface ReanalyzeSubjectAnalysisInput { idempotencyKey: string }
export interface SubjectWorkerClaimInput { workerId: string; leaseSeconds: number }
export interface SubjectWorkerLeaseInput extends SubjectWorkerClaimInput { leaseToken: string }

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

export interface SubjectAnalysisResultV1 {
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

export interface SubjectAnalysisInputV1 {
  contractVersion: "subject-analysis.v1";
  brand: { name: string; primaryCategory: string; subcategories: string[]; brandColor: string };
  subject: { type: SubjectType; sourceUrl: string; manualInput: SubjectManualInput };
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
      role: "product" | "service" | "logo" | "detail" | "unknown";
    }>;
  };
  researchPolicy: {
    publicWebSearch: true;
    allowedPurposes: ["voc", "alternatives", "market_context"];
    requireSourceUrl: true;
  };
}

const LIMITS = { text: 2_000, short: 200, list: 50, evidence: 20, images: 20 } as const;

function fail(code: string): never { throw new Error(code); }

function object(value: unknown, code: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(code);
  return value as Record<string, unknown>;
}

function strictObject(value: unknown, keys: readonly string[], code: string): Record<string, unknown> {
  const source = object(value, code);
  if (Object.keys(source).some((key) => !keys.includes(key))) fail(code);
  return source;
}

function text(value: unknown, code: string, max: number = LIMITS.text, allowEmpty = false): string {
  if (typeof value !== "string") fail(code);
  const normalized = value.trim();
  if ((!allowEmpty && !normalized) || normalized.length > max) fail(code);
  return normalized;
}

function httpsUrl(value: unknown, code = "subject_analysis_source_url_invalid"): string {
  const normalized = text(value, code, 2_048);
  try {
    const parsed = new URL(normalized);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) fail(code);
  } catch { fail(code); }
  return normalized;
}

function list<T>(value: unknown, code: string, parse: (item: unknown) => T, max: number = LIMITS.list): T[] {
  if (!Array.isArray(value) || value.length > max) fail(code);
  return value.map(parse);
}

function textList(value: unknown, code: string, max: number = LIMITS.list): string[] {
  return list(value, code, (item) => text(item, code), max);
}

function subjectType(value: unknown): SubjectType {
  if (value !== "product" && value !== "service") fail("subject_analysis_subject_type_invalid");
  return value;
}

function manualInput(value: unknown): SubjectManualInput {
  const source = strictObject(value, ["name", "promotion", "description"], "subject_analysis_manual_input_invalid");
  return {
    name: text(source.name ?? "", "subject_analysis_manual_input_invalid", 200, true),
    promotion: text(source.promotion ?? "", "subject_analysis_manual_input_invalid", 500, true),
    description: text(source.description ?? "", "subject_analysis_manual_input_invalid", 2_000, true),
  };
}

function leaseSeconds(value: unknown): number {
  const parsed = value === undefined ? 180 : value;
  if (!Number.isSafeInteger(parsed) || Number(parsed) < 30 || Number(parsed) > 900) {
    fail("subject_analysis_lease_seconds_invalid");
  }
  return Number(parsed);
}

export function parseCreateSubjectAnalysisInput(value: unknown): CreateSubjectAnalysisInput {
  const source = strictObject(value, ["subjectType", "sourceUrl", "manualInput", "idempotencyKey", "force"], "subject_analysis_input_invalid");
  if (source.force !== undefined && typeof source.force !== "boolean") fail("subject_analysis_force_invalid");
  return {
    subjectType: subjectType(source.subjectType),
    sourceUrl: httpsUrl(source.sourceUrl),
    manualInput: manualInput(source.manualInput),
    idempotencyKey: text(source.idempotencyKey, "subject_analysis_idempotency_key_invalid", 200),
    force: source.force ?? false,
  };
}

export function parseSubjectAnalysisSelectionInput(value: unknown): SubjectAnalysisSelectionInput {
  const source = strictObject(value, ["imageId"], "subject_analysis_selection_invalid");
  return { imageId: text(source.imageId, "subject_analysis_image_id_invalid", 200) };
}

export function parseReanalyzeSubjectAnalysisInput(value: unknown): ReanalyzeSubjectAnalysisInput {
  const source = strictObject(value, ["idempotencyKey"], "subject_analysis_reanalyze_invalid");
  return { idempotencyKey: text(source.idempotencyKey, "subject_analysis_idempotency_key_invalid", 200) };
}

export function parseSubjectWorkerClaimInput(value: unknown): SubjectWorkerClaimInput {
  const source = strictObject(value, ["workerId", "leaseSeconds"], "subject_analysis_worker_claim_invalid");
  return {
    workerId: text(source.workerId, "subject_analysis_worker_id_invalid", 200),
    leaseSeconds: leaseSeconds(source.leaseSeconds),
  };
}

export function parseSubjectWorkerLeaseInput(value: unknown): SubjectWorkerLeaseInput {
  const source = strictObject(value, ["workerId", "leaseToken", "leaseSeconds"], "subject_analysis_worker_lease_invalid");
  return {
    workerId: text(source.workerId, "subject_analysis_worker_id_invalid", 200),
    leaseSeconds: leaseSeconds(source.leaseSeconds),
    leaseToken: text(source.leaseToken, "subject_analysis_lease_token_invalid", 200),
  };
}

function positiveDimension(value: unknown, code: string): number | null {
  if (value === null || value === undefined) return null;
  if (!Number.isSafeInteger(value) || Number(value) <= 0 || Number(value) > 20_000) fail(code);
  return Number(value);
}

interface StructuredJsonBudget {
  nodes: number;
  characters: number;
}

function consumeStructuredBudget(budget: StructuredJsonBudget, characters = 0): void {
  budget.nodes += 1;
  budget.characters += characters;
  if (budget.nodes > 2_000 || budget.characters > 100_000) {
    fail("subject_analysis_structured_data_limit_exceeded");
  }
}

function structuredJson(value: unknown, budget: StructuredJsonBudget, depth = 0): unknown {
  const invalid = "subject_analysis_structured_data_invalid";
  const limit = "subject_analysis_structured_data_limit_exceeded";
  if (depth > 6) fail(limit);
  consumeStructuredBudget(budget);
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (value.length > 10_000) fail(limit);
    budget.characters += value.length;
    if (budget.characters > 100_000) fail(limit);
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail(invalid);
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length > 100) fail(limit);
    return value.map((item) => structuredJson(item, budget, depth + 1));
  }
  if (!value || typeof value !== "object") fail(invalid);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) fail(invalid);
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length > 100) fail(limit);
  if (ownKeys.some((key) => typeof key !== "string")) fail(invalid);
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of ownKeys as string[]) {
    if (key.length > 200) fail(limit);
    if (key === "__proto__" || key === "prototype" || key === "constructor") fail(invalid);
    budget.characters += key.length;
    if (budget.characters > 100_000) fail(limit);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !("value" in descriptor)) fail(invalid);
    Object.defineProperty(result, key, {
      value: structuredJson(descriptor.value, budget, depth + 1),
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  return result;
}

function structuredData(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("subject_analysis_structured_data_invalid");
  }
  return structuredJson(value, { nodes: 0, characters: 0 }) as Record<string, unknown>;
}

function isSubjectImageRole(value: unknown): value is "product" | "service" | "logo" | "detail" | "unknown" {
  return typeof value === "string"
    && (value === "product" || value === "service" || value === "logo" || value === "detail" || value === "unknown");
}

function isSubjectEvidenceType(value: unknown): value is SubjectEvidenceType {
  return typeof value === "string"
    && (value === "product_fact" || value === "public_research" || value === "manual_input");
}

export function parseSubjectAnalysisInput(value: unknown): SubjectAnalysisInputV1 {
  const source = strictObject(value, ["contractVersion", "brand", "subject", "extracted", "researchPolicy"], "subject_analysis_input_v1_invalid");
  if (source.contractVersion !== "subject-analysis.v1") fail("subject_analysis_contract_version_invalid");
  const brand = strictObject(source.brand, ["name", "primaryCategory", "subcategories", "brandColor"], "subject_analysis_brand_invalid");
  const subject = strictObject(source.subject, ["type", "sourceUrl", "manualInput"], "subject_analysis_subject_invalid");
  const extracted = strictObject(source.extracted, ["facts", "structuredData", "imageCandidates"], "subject_analysis_extracted_invalid");
  const policy = strictObject(source.researchPolicy, ["publicWebSearch", "allowedPurposes", "requireSourceUrl"], "subject_analysis_research_policy_invalid");
  if (policy.publicWebSearch !== true || policy.requireSourceUrl !== true
    || !Array.isArray(policy.allowedPurposes)
    || policy.allowedPurposes.join("|") !== "voc|alternatives|market_context") fail("subject_analysis_research_policy_invalid");

  const facts = list(extracted.facts, "subject_analysis_facts_invalid", (item) => {
    const fact = strictObject(item, ["key", "value", "sourceUrl"], "subject_analysis_fact_invalid");
    return { key: text(fact.key, "subject_analysis_fact_invalid", 200), value: text(fact.value, "subject_analysis_fact_invalid"), sourceUrl: httpsUrl(fact.sourceUrl) };
  });
  const imageCandidates = list(extracted.imageCandidates, "subject_analysis_images_invalid", (item) => {
    const image = strictObject(item, ["id", "sourceUrl", "storageUrl", "width", "height", "mimeType", "altText", "role"], "subject_analysis_image_invalid");
    if (!isSubjectImageRole(image.role)) fail("subject_analysis_image_invalid");
    return {
      id: text(image.id, "subject_analysis_image_invalid", 200),
      sourceUrl: httpsUrl(image.sourceUrl), storageUrl: httpsUrl(image.storageUrl),
      width: positiveDimension(image.width, "subject_analysis_image_invalid"),
      height: positiveDimension(image.height, "subject_analysis_image_invalid"),
      mimeType: text(image.mimeType, "subject_analysis_image_invalid", 100),
      altText: text(image.altText ?? "", "subject_analysis_image_invalid", 500, true),
      role: image.role,
    };
  }, LIMITS.images);
  return {
    contractVersion: "subject-analysis.v1",
    brand: {
      name: text(brand.name, "subject_analysis_brand_invalid", 200),
      primaryCategory: text(brand.primaryCategory, "subject_analysis_brand_invalid", 200),
      subcategories: textList(brand.subcategories, "subject_analysis_brand_invalid", 20),
      brandColor: text(brand.brandColor, "subject_analysis_brand_invalid", 100),
    },
    subject: { type: subjectType(subject.type), sourceUrl: httpsUrl(subject.sourceUrl), manualInput: manualInput(subject.manualInput) },
    extracted: { facts, structuredData: structuredData(extracted.structuredData), imageCandidates },
    researchPolicy: { publicWebSearch: true, allowedPurposes: ["voc", "alternatives", "market_context"], requireSourceUrl: true },
  };
}

function evidence(value: unknown): { claim: string; support: string; sourceUrl: string } {
  const source = strictObject(value, ["claim", "support", "sourceUrl"], "subject_analysis_evidence_invalid");
  return { claim: text(source.claim, "subject_analysis_evidence_invalid"), support: text(source.support, "subject_analysis_evidence_invalid"), sourceUrl: httpsUrl(source.sourceUrl) };
}

function parseTarget(value: unknown): SubjectTarget {
  const source = strictObject(value, ["id", "name", "traits", "painPoints", "purchaseMotivations", "uspEvidence"], "subject_analysis_target_invalid");
  return {
    id: text(source.id, "subject_analysis_target_invalid", 200), name: text(source.name, "subject_analysis_target_invalid", 200),
    traits: textList(source.traits, "subject_analysis_target_invalid"), painPoints: textList(source.painPoints, "subject_analysis_target_invalid"),
    purchaseMotivations: textList(source.purchaseMotivations, "subject_analysis_target_invalid"),
    uspEvidence: list(source.uspEvidence, "subject_analysis_target_invalid", evidence, LIMITS.evidence),
  };
}

function parseAppeal(value: unknown): SubjectAppeal {
  const source = strictObject(value, ["id", "targetId", "title", "description", "evidenceType", "connectionReason", "sources"], "subject_analysis_appeal_invalid");
  if (!isSubjectEvidenceType(source.evidenceType)) fail("subject_analysis_appeal_invalid");
  const sources = list(source.sources, "subject_analysis_appeal_sources_invalid", (item) => {
    const entry = strictObject(item, ["title", "url"], "subject_analysis_appeal_sources_invalid");
    return { title: text(entry.title, "subject_analysis_appeal_sources_invalid", 500), url: httpsUrl(entry.url) };
  }, LIMITS.evidence);
  if (source.evidenceType === "public_research" && sources.length === 0) fail("subject_analysis_appeal_sources_invalid");
  return {
    id: text(source.id, "subject_analysis_appeal_invalid", 200), targetId: text(source.targetId, "subject_analysis_appeal_invalid", 200),
    title: text(source.title, "subject_analysis_appeal_invalid", 500), description: text(source.description, "subject_analysis_appeal_invalid"),
    evidenceType: source.evidenceType, connectionReason: text(source.connectionReason, "subject_analysis_appeal_invalid"), sources,
  };
}

export function parseSubjectAnalysisResult(value: unknown): SubjectAnalysisResultV1 {
  const source = strictObject(value, ["contractVersion", "summary", "needs", "alternatives", "voc", "usps", "targets", "appealsByTarget", "recommendedImageId", "sourceGaps"], "subject_analysis_result_invalid");
  if (source.contractVersion !== "subject-analysis-result.v1") fail("subject_analysis_result_version_invalid");
  if (!Array.isArray(source.targets) || source.targets.length !== 3) fail("subject_analysis_targets_invalid");
  const targets = source.targets.map(parseTarget) as [SubjectTarget, SubjectTarget, SubjectTarget];
  const targetIds = new Set(targets.map(({ id }) => id));
  if (targetIds.size !== 3) fail("subject_analysis_target_id_duplicate");

  const appealsSource = object(source.appealsByTarget, "subject_analysis_appeals_invalid");
  const appealsByTarget: Record<string, SubjectAppeal[]> = {};
  const appealIds = new Set<string>();
  for (const [targetId, value] of Object.entries(appealsSource)) {
    if (!targetIds.has(targetId)) fail("subject_analysis_appeals_target_invalid");
    appealsByTarget[targetId] = list(value, "subject_analysis_appeals_invalid", (item) => {
      const parsed = parseAppeal(item);
      if (parsed.targetId !== targetId) fail("subject_analysis_appeals_target_invalid");
      if (appealIds.has(parsed.id)) fail("subject_analysis_appeal_id_duplicate");
      appealIds.add(parsed.id);
      return parsed;
    }, LIMITS.evidence);
  }

  const needs = list(source.needs, "subject_analysis_needs_invalid", (item) => {
    const entry = strictObject(item, ["text", "sourceUrl"], "subject_analysis_needs_invalid");
    return { text: text(entry.text, "subject_analysis_needs_invalid"), sourceUrl: httpsUrl(entry.sourceUrl) };
  });
  const alternatives = list(source.alternatives, "subject_analysis_alternatives_invalid", (item) => {
    const entry = strictObject(item, ["name", "strengths", "limitations", "sourceUrls"], "subject_analysis_alternatives_invalid");
    const sourceUrls = list(entry.sourceUrls, "subject_analysis_alternatives_invalid", (url) => httpsUrl(url));
    if (sourceUrls.length === 0) fail("subject_analysis_alternatives_invalid");
    return { name: text(entry.name, "subject_analysis_alternatives_invalid", 500), strengths: textList(entry.strengths, "subject_analysis_alternatives_invalid"), limitations: textList(entry.limitations, "subject_analysis_alternatives_invalid"), sourceUrls };
  });
  const voc = list(source.voc, "subject_analysis_voc_invalid", (item) => {
    const entry = strictObject(item, ["quoteSummary", "context", "sourceUrl"], "subject_analysis_voc_invalid");
    return { quoteSummary: text(entry.quoteSummary, "subject_analysis_voc_invalid"), context: text(entry.context, "subject_analysis_voc_invalid"), sourceUrl: httpsUrl(entry.sourceUrl) };
  });
  const usps = list(source.usps, "subject_analysis_usps_invalid", evidence);
  const recommendedImageId = source.recommendedImageId === null ? null : text(source.recommendedImageId, "subject_analysis_recommended_image_invalid", 200);
  return {
    contractVersion: "subject-analysis-result.v1", summary: text(source.summary, "subject_analysis_summary_invalid"),
    needs, alternatives, voc, usps, targets, appealsByTarget, recommendedImageId,
    sourceGaps: textList(source.sourceGaps, "subject_analysis_source_gaps_invalid"),
  };
}

export const parseSelectSubjectAnalysisInput = parseSubjectAnalysisSelectionInput;
export const parseSubjectAnalysisReanalyzeInput = parseReanalyzeSubjectAnalysisInput;
export const parseSubjectAnalysisWorkerLeaseInput = parseSubjectWorkerLeaseInput;
export const parseSubjectAnalysisResultV1 = parseSubjectAnalysisResult;
