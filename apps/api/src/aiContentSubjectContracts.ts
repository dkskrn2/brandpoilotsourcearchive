export type SubjectType = "product" | "service";
export type SubjectAnalysisStatus = "queued" | "extracting" | "researching" | "ready" | "partial" | "failed";
export type SubjectEvidenceType = "product_fact" | "public_research" | "manual_input";
export type SubjectResearchPurpose = "voc" | "alternatives" | "market_context";
export type SubjectPipelineStatus =
  | "queued"
  | "extracting"
  | "analyzing"
  | "generating_appeals"
  | "ready"
  | "partial"
  | "failed";
export type ServiceSubtype =
  | "saas"
  | "consulting"
  | "education"
  | "agency"
  | "subscription"
  | "professional"
  | "other_service";
export type SubjectSourcePriority =
  | "manual_input"
  | "attachments"
  | "source_url"
  | "brand_context"
  | "public_research";

export interface SubjectManualInput { name: string; promotion: string; description: string }
export interface SubjectManualInputV2 { name: string; promotionOrTerms: string; description: string }
export interface CreateSubjectAnalysisInput {
  subjectType: SubjectType;
  sourceUrl: string;
  manualInput: SubjectManualInput;
  idempotencyKey: string;
  force: boolean;
}
export interface CreateSubjectPipelineInput {
  generationId: string;
  subjectType: SubjectType;
  sourceUrl: string | null;
  attachmentIds: string[];
  manualInput: SubjectManualInputV2;
  idempotencyKey: string;
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

export interface SubjectAnalysisInputV2 {
  contractVersion: "subject-analysis.v2";
  phase: "analysis";
  brandContext: Record<string, unknown>;
  subject: {
    type: SubjectType;
    sourceUrl: string | null;
    attachmentIds: string[];
    manualInput: SubjectManualInputV2;
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

export interface SubjectAppealInputV2 {
  contractVersion: "subject-analysis.v2";
  phase: "appeal";
  brandContext: Record<string, unknown>;
  subject: SubjectAnalysisInputV2["subject"];
  analysisResult: SubjectAnalysisResultV2;
  sourcePriority: SubjectAnalysisInputV2["sourcePriority"];
}

export interface SubjectAppealResultV2 {
  contractVersion: "subject-appeal-result.v2";
  phase: "appeal";
  targets: [SubjectTarget, SubjectTarget, SubjectTarget];
  appealsByTarget: Record<string, SubjectAppeal[]>;
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

function manualInputV2(value: unknown): SubjectManualInputV2 {
  const source = strictObject(
    value,
    ["name", "promotionOrTerms", "description"],
    "subject_analysis_manual_input_v2_invalid",
  );
  return {
    name: text(source.name ?? "", "subject_analysis_manual_input_v2_invalid", 200, true),
    promotionOrTerms: text(source.promotionOrTerms ?? "", "subject_analysis_manual_input_v2_invalid", 500, true),
    description: text(source.description ?? "", "subject_analysis_manual_input_v2_invalid", 2_000, true),
  };
}

function uuid(value: unknown, code: string): string {
  const normalized = text(value, code, 36);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalized)) fail(code);
  return normalized.toLowerCase();
}

function attachmentIds(value: unknown): string[] {
  const parsed = list(value, "subject_analysis_attachment_ids_invalid", (item) => (
    uuid(item, "subject_analysis_attachment_ids_invalid")
  ), 10);
  if (new Set(parsed).size !== parsed.length) fail("subject_analysis_attachment_ids_invalid");
  return parsed;
}

function optionalHttpsUrl(value: unknown): string | null {
  return value === null || value === undefined ? null : httpsUrl(value);
}

function evidenceUrl(value: unknown, code = "subject_analysis_source_url_invalid"): string {
  const normalized = text(value, code, 2_048);
  if (normalized.startsWith("attachment://")) {
    uuid(normalized.slice("attachment://".length), code);
    return normalized.toLowerCase();
  }
  return httpsUrl(normalized, code);
}

function subjectV2(value: unknown): SubjectAnalysisInputV2["subject"] {
  const source = strictObject(
    value,
    ["type", "sourceUrl", "attachmentIds", "manualInput"],
    "subject_analysis_subject_v2_invalid",
  );
  return {
    type: subjectType(source.type),
    sourceUrl: optionalHttpsUrl(source.sourceUrl),
    attachmentIds: attachmentIds(source.attachmentIds),
    manualInput: manualInputV2(source.manualInput),
  };
}

function sourcePriority(value: unknown): SubjectAnalysisInputV2["sourcePriority"] {
  const expected: SubjectAnalysisInputV2["sourcePriority"] = [
    "manual_input",
    "attachments",
    "source_url",
    "brand_context",
    "public_research",
  ];
  if (!Array.isArray(value) || value.length !== expected.length
    || value.some((entry, index) => entry !== expected[index])) {
    fail("subject_analysis_source_priority_invalid");
  }
  return [...expected];
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

export function parseCreateSubjectPipelineInput(value: unknown): CreateSubjectPipelineInput {
  const source = strictObject(
    value,
    ["generationId", "subjectType", "sourceUrl", "attachmentIds", "manualInput", "idempotencyKey"],
    "subject_analysis_pipeline_input_invalid",
  );
  const parsed = {
    generationId: uuid(source.generationId, "subject_analysis_generation_id_invalid"),
    subjectType: subjectType(source.subjectType),
    sourceUrl: optionalHttpsUrl(source.sourceUrl),
    attachmentIds: attachmentIds(source.attachmentIds),
    manualInput: manualInputV2(source.manualInput),
    idempotencyKey: text(source.idempotencyKey, "subject_analysis_idempotency_key_invalid", 200),
  };
  if (!parsed.sourceUrl && parsed.attachmentIds.length === 0
    && !parsed.manualInput.name && !parsed.manualInput.description) {
    fail("subject_analysis_evidence_required");
  }
  return parsed;
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

export function parseSubjectAnalysisInputV2(value: unknown): SubjectAnalysisInputV2 {
  const source = strictObject(
    value,
    ["contractVersion", "phase", "brandContext", "subject", "extracted", "sourcePriority"],
    "subject_analysis_input_v2_invalid",
  );
  if (source.contractVersion !== "subject-analysis.v2") fail("subject_analysis_contract_version_invalid");
  if (source.phase !== "analysis") fail("subject_analysis_phase_invalid");
  const extracted = strictObject(
    source.extracted,
    ["documents", "images", "sourcePage", "sourceGaps"],
    "subject_analysis_extracted_v2_invalid",
  );
  const documents = list(extracted.documents, "subject_analysis_documents_invalid", (item) => {
    const document = strictObject(
      item,
      ["attachmentId", "fileName", "mimeType", "text"],
      "subject_analysis_document_invalid",
    );
    return {
      attachmentId: uuid(document.attachmentId, "subject_analysis_document_invalid"),
      fileName: text(document.fileName, "subject_analysis_document_invalid", 500),
      mimeType: text(document.mimeType, "subject_analysis_document_invalid", 200),
      text: text(document.text, "subject_analysis_document_invalid", 100_000),
    };
  }, 10);
  const images = list(extracted.images, "subject_analysis_images_invalid", (item) => {
    const image = strictObject(
      item,
      ["attachmentId", "sourceUrl", "storageUrl", "mimeType", "altText"],
      "subject_analysis_image_invalid",
    );
    return {
      attachmentId: uuid(image.attachmentId, "subject_analysis_image_invalid"),
      sourceUrl: evidenceUrl(image.sourceUrl, "subject_analysis_image_invalid"),
      storageUrl: httpsUrl(image.storageUrl, "subject_analysis_image_invalid"),
      mimeType: text(image.mimeType, "subject_analysis_image_invalid", 200),
      altText: text(image.altText ?? "", "subject_analysis_image_invalid", 500, true),
    };
  }, 10);
  let sourcePage: SubjectAnalysisInputV2["extracted"]["sourcePage"] = null;
  if (extracted.sourcePage !== null && extracted.sourcePage !== undefined) {
    const page = strictObject(
      extracted.sourcePage,
      ["sourceUrl", "title", "text", "structuredData"],
      "subject_analysis_source_page_invalid",
    );
    sourcePage = {
      sourceUrl: httpsUrl(page.sourceUrl),
      title: text(page.title ?? "", "subject_analysis_source_page_invalid", 500, true),
      text: text(page.text, "subject_analysis_source_page_invalid", 100_000),
      structuredData: structuredData(page.structuredData),
    };
  }
  return {
    contractVersion: "subject-analysis.v2",
    phase: "analysis",
    brandContext: structuredData(source.brandContext),
    subject: subjectV2(source.subject),
    extracted: {
      documents,
      images,
      sourcePage,
      sourceGaps: textList(extracted.sourceGaps, "subject_analysis_source_gaps_invalid"),
    },
    sourcePriority: sourcePriority(source.sourcePriority),
  };
}

function serviceSubtype(value: unknown): ServiceSubtype {
  if (value !== "saas" && value !== "consulting" && value !== "education"
    && value !== "agency" && value !== "subscription" && value !== "professional"
    && value !== "other_service") {
    fail("subject_analysis_service_subtype_invalid");
  }
  return value;
}

export function parseSubjectAnalysisResultV2(value: unknown): SubjectAnalysisResultV2 {
  const source = strictObject(
    value,
    [
      "contractVersion", "phase", "subjectType", "summary", "verifiedFacts", "voc",
      "alternatives", "barriers", "productProfile", "serviceProfile", "serviceSubtype",
      "sourceGaps",
    ],
    "subject_analysis_result_v2_invalid",
  );
  if (source.contractVersion !== "subject-analysis-result.v2") fail("subject_analysis_result_version_invalid");
  if (source.phase !== "analysis") fail("subject_analysis_phase_invalid");
  const parsedSubjectType = subjectType(source.subjectType);
  const verifiedFacts = list(source.verifiedFacts, "subject_analysis_verified_facts_invalid", (item) => {
    const fact = strictObject(item, ["claim", "support", "sourceUrl"], "subject_analysis_verified_fact_invalid");
    return {
      claim: text(fact.claim, "subject_analysis_verified_fact_invalid"),
      support: text(fact.support, "subject_analysis_verified_fact_invalid"),
      sourceUrl: evidenceUrl(fact.sourceUrl),
    };
  });
  const voc = list(source.voc, "subject_analysis_voc_invalid", (item) => {
    const entry = strictObject(item, ["quoteSummary", "context", "sourceUrl"], "subject_analysis_voc_invalid");
    return {
      quoteSummary: text(entry.quoteSummary, "subject_analysis_voc_invalid"),
      context: text(entry.context, "subject_analysis_voc_invalid"),
      sourceUrl: evidenceUrl(entry.sourceUrl),
    };
  });
  const alternatives = list(source.alternatives, "subject_analysis_alternatives_invalid", (item) => {
    const entry = strictObject(item, ["name", "strengths", "limitations", "sourceUrls"], "subject_analysis_alternatives_invalid");
    const sourceUrls = list(entry.sourceUrls, "subject_analysis_alternatives_invalid", (url) => evidenceUrl(url));
    if (sourceUrls.length === 0) fail("subject_analysis_alternatives_invalid");
    return {
      name: text(entry.name, "subject_analysis_alternatives_invalid", 500),
      strengths: textList(entry.strengths, "subject_analysis_alternatives_invalid"),
      limitations: textList(entry.limitations, "subject_analysis_alternatives_invalid"),
      sourceUrls,
    };
  });
  const barriers = list(source.barriers, "subject_analysis_barriers_invalid", (item) => {
    const entry = strictObject(item, ["barrier", "evidence", "sourceUrls"], "subject_analysis_barrier_invalid");
    return {
      barrier: text(entry.barrier, "subject_analysis_barrier_invalid"),
      evidence: text(entry.evidence, "subject_analysis_barrier_invalid"),
      sourceUrls: list(entry.sourceUrls, "subject_analysis_barrier_invalid", (url) => evidenceUrl(url)),
    };
  });

  const productProfile = source.productProfile === null ? null : structuredData(source.productProfile);
  const serviceProfile = source.serviceProfile === null ? null : structuredData(source.serviceProfile);
  let parsedSubtype: ServiceSubtype | null = null;
  if (parsedSubjectType === "product") {
    if (productProfile === null || serviceProfile !== null || source.serviceSubtype !== null) {
      fail("subject_analysis_product_profile_invalid");
    }
  } else {
    if (serviceProfile === null || productProfile !== null) fail("subject_analysis_service_profile_invalid");
    parsedSubtype = serviceSubtype(source.serviceSubtype);
  }

  return {
    contractVersion: "subject-analysis-result.v2",
    phase: "analysis",
    subjectType: parsedSubjectType,
    summary: text(source.summary, "subject_analysis_summary_invalid"),
    verifiedFacts,
    voc,
    alternatives,
    barriers,
    productProfile,
    serviceProfile,
    serviceSubtype: parsedSubtype,
    sourceGaps: textList(source.sourceGaps, "subject_analysis_source_gaps_invalid"),
  };
}

export function parseSubjectAppealInputV2(value: unknown): SubjectAppealInputV2 {
  const source = strictObject(
    value,
    ["contractVersion", "phase", "brandContext", "subject", "analysisResult", "sourcePriority"],
    "subject_appeal_input_v2_invalid",
  );
  if (source.contractVersion !== "subject-analysis.v2") fail("subject_analysis_contract_version_invalid");
  if (source.phase !== "appeal") fail("subject_analysis_phase_invalid");
  const subject = subjectV2(source.subject);
  const analysisResult = parseSubjectAnalysisResultV2(source.analysisResult);
  if (subject.type !== analysisResult.subjectType) fail("subject_analysis_subject_type_mismatch");
  return {
    contractVersion: "subject-analysis.v2",
    phase: "appeal",
    brandContext: structuredData(source.brandContext),
    subject,
    analysisResult,
    sourcePriority: sourcePriority(source.sourcePriority),
  };
}

export function parseSubjectAppealResultV2(value: unknown): SubjectAppealResultV2 {
  const source = strictObject(
    value,
    ["contractVersion", "phase", "targets", "appealsByTarget"],
    "subject_appeal_result_v2_invalid",
  );
  if (source.contractVersion !== "subject-appeal-result.v2") fail("subject_analysis_result_version_invalid");
  if (source.phase !== "appeal") fail("subject_analysis_phase_invalid");
  if (!Array.isArray(source.targets) || source.targets.length !== 3) fail("subject_analysis_targets_invalid");
  const targets = source.targets.map(parseTarget) as [SubjectTarget, SubjectTarget, SubjectTarget];
  const targetIds = new Set(targets.map(({ id }) => id));
  if (targetIds.size !== 3) fail("subject_analysis_target_id_duplicate");

  const appealsSource = object(source.appealsByTarget, "subject_analysis_appeals_invalid");
  if (Object.keys(appealsSource).length !== 3
    || Object.keys(appealsSource).some((targetId) => !targetIds.has(targetId))) {
    fail("subject_analysis_appeals_target_invalid");
  }
  const appealsByTarget: Record<string, SubjectAppeal[]> = {};
  const appealIds = new Set<string>();
  for (const targetId of targetIds) {
    const appeals = list(appealsSource[targetId], "subject_analysis_appeals_invalid", parseAppeal, LIMITS.evidence);
    if (appeals.length < 2) fail("subject_analysis_appeals_minimum_invalid");
    for (const parsed of appeals) {
      if (parsed.targetId !== targetId) fail("subject_analysis_appeals_target_invalid");
      if (appealIds.has(parsed.id)) fail("subject_analysis_appeal_id_duplicate");
      appealIds.add(parsed.id);
    }
    appealsByTarget[targetId] = appeals;
  }
  return {
    contractVersion: "subject-appeal-result.v2",
    phase: "appeal",
    targets,
    appealsByTarget,
  };
}
