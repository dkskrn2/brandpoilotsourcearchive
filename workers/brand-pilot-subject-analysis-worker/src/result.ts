import type {
  ServiceSubtype,
  SubjectAnalysisResult,
  SubjectAnalysisResultV2,
  SubjectAppeal,
  SubjectEvidenceType,
  SubjectTarget,
  SubjectType,
} from "./contracts.js";

export class SubjectAnalysisContractError extends Error {
  readonly retryable = false;
  constructor(message: string) { super(message); this.name = "SubjectAnalysisContractError"; }
}

const fail = (code: string): never => { throw new SubjectAnalysisContractError(code); };
const record = (value: unknown, code: string): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(code);
  return value as Record<string, unknown>;
};
const exact = (value: unknown, keys: string[], code: string) => {
  const source = record(value, code);
  if (Object.keys(source).some((key) => !keys.includes(key))) fail(code);
  return source;
};
const stringValue = (value: unknown, code: string, max = 2000): string => {
  if (typeof value !== "string") fail(code);
  const normalized = (value as string).trim();
  if (!normalized || normalized.length > max) fail(code);
  return normalized;
};
const https = (value: unknown, code: string): string => {
  const url = stringValue(value, code, 2048);
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) fail(code);
  } catch { fail(code); }
  return url;
};
const strings = (value: unknown, code: string, max = 50): string[] => {
  if (!Array.isArray(value) || value.length > max) fail(code);
  const items = value as unknown[];
  return items.map((item) => stringValue(item, code));
};

const evidenceUrl = (value: unknown, code = "subject_analysis_source_url_invalid"): string => {
  const url = stringValue(value, code, 2048);
  if (url.startsWith("attachment://")) {
    const attachmentId = url.slice("attachment://".length);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(attachmentId)) fail(code);
    return url.toLowerCase();
  }
  return https(url, code);
};

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
  const objectValue = value as object;
  const prototype = Object.getPrototypeOf(objectValue);
  if (prototype !== Object.prototype && prototype !== null) fail(invalid);
  const ownKeys = Reflect.ownKeys(objectValue);
  if (ownKeys.length > 100) fail(limit);
  if (ownKeys.some((key) => typeof key !== "string")) fail(invalid);
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of ownKeys as string[]) {
    if (key.length > 200) fail(limit);
    if (key === "__proto__" || key === "prototype" || key === "constructor") fail(invalid);
    budget.characters += key.length;
    if (budget.characters > 100_000) fail(limit);
    const descriptor = Object.getOwnPropertyDescriptor(objectValue, key);
    if (!descriptor?.enumerable || !("value" in descriptor)) fail(invalid);
    Object.defineProperty(result, key, {
      value: structuredJson((descriptor as PropertyDescriptor & { value: unknown }).value, budget, depth + 1),
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

function assertV2PayloadBudget(value: unknown): void {
  const budget = { nodes: 0, characters: 0 };
  const visit = (current: unknown, depth: number): void => {
    budget.nodes += 1;
    if (budget.nodes > 2_000 || depth > 20) fail("subject_analysis_v2_payload_limit_exceeded");
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
    if (budget.characters > 100_000) fail("subject_analysis_v2_payload_limit_exceeded");
  };
  visit(value, 0);
}

function subjectType(value: unknown): SubjectType {
  if (value !== "product" && value !== "service") fail("subject_analysis_subject_type_invalid");
  return value as SubjectType;
}

function serviceSubtype(value: unknown): ServiceSubtype {
  if (value !== "saas" && value !== "consulting" && value !== "education"
    && value !== "agency" && value !== "subscription" && value !== "professional"
    && value !== "other_service") {
    fail("subject_analysis_service_subtype_invalid");
  }
  return value as ServiceSubtype;
}

function evidence(value: unknown): { claim: string; support: string; sourceUrl: string } {
  const source = exact(value, ["claim", "support", "sourceUrl"], "subject_analysis_evidence_invalid");
  return { claim: stringValue(source.claim, "subject_analysis_evidence_invalid"), support: stringValue(source.support, "subject_analysis_evidence_invalid"), sourceUrl: https(source.sourceUrl, "subject_analysis_evidence_source_invalid") };
}

function target(value: unknown): SubjectTarget {
  const source = exact(value, ["id", "name", "traits", "painPoints", "purchaseMotivations", "uspEvidence"], "subject_analysis_target_invalid");
  const evidenceItems = Array.isArray(source.uspEvidence) ? source.uspEvidence as unknown[] : fail("subject_analysis_target_invalid");
  return { id: stringValue(source.id, "subject_analysis_target_invalid", 200), name: stringValue(source.name, "subject_analysis_target_invalid"), traits: strings(source.traits, "subject_analysis_target_invalid"), painPoints: strings(source.painPoints, "subject_analysis_target_invalid"), purchaseMotivations: strings(source.purchaseMotivations, "subject_analysis_target_invalid"), uspEvidence: evidenceItems.map(evidence) };
}

function appeal(value: unknown): SubjectAppeal {
  const source = exact(value, ["id", "targetId", "title", "description", "evidenceType", "connectionReason", "sources"], "subject_analysis_appeal_invalid");
  const evidenceType = source.evidenceType;
  if (evidenceType !== "product_fact" && evidenceType !== "public_research" && evidenceType !== "manual_input") fail("subject_analysis_appeal_invalid");
  if (!Array.isArray(source.sources)) fail("subject_analysis_appeal_sources_invalid");
  const sourceItems = source.sources as unknown[];
  const sources = sourceItems.map((item) => {
    const entry = exact(item, ["title", "url"], "subject_analysis_appeal_sources_invalid");
    return { title: stringValue(entry.title, "subject_analysis_appeal_sources_invalid", 500), url: https(entry.url, "subject_analysis_appeal_source_invalid") };
  });
  if (evidenceType === "public_research" && sources.length === 0) fail("subject_analysis_appeal_sources_required");
  return { id: stringValue(source.id, "subject_analysis_appeal_invalid", 200), targetId: stringValue(source.targetId, "subject_analysis_appeal_invalid", 200), title: stringValue(source.title, "subject_analysis_appeal_invalid", 500), description: stringValue(source.description, "subject_analysis_appeal_invalid"), evidenceType: evidenceType as SubjectEvidenceType, connectionReason: stringValue(source.connectionReason, "subject_analysis_appeal_invalid"), sources };
}

export function parseSubjectAnalysisResult(value: unknown): SubjectAnalysisResult {
  const source = exact(value, ["contractVersion", "summary", "needs", "alternatives", "voc", "usps", "targets", "appealsByTarget", "recommendedImageId", "sourceGaps"], "subject_analysis_result_invalid");
  if (source.contractVersion !== "subject-analysis-result.v1") fail("subject_analysis_result_version_invalid");
  if (!Array.isArray(source.targets) || source.targets.length !== 3) fail("subject_analysis_targets_invalid");
  const targetItems = source.targets as unknown[];
  const targets = targetItems.map(target) as [SubjectTarget, SubjectTarget, SubjectTarget];
  const targetIds = new Set(targets.map((item) => item.id));
  if (targetIds.size !== 3) fail("subject_analysis_target_id_duplicate");
  const appealsSource = record(source.appealsByTarget, "subject_analysis_appeals_invalid");
  const appealsByTarget: Record<string, SubjectAppeal[]> = {};
  const appealIds = new Set<string>();
  for (const targetId of targetIds) {
    const raw = appealsSource[targetId];
    if (!Array.isArray(raw) || raw.length < 2) fail("subject_analysis_appeals_minimum_invalid");
    const appealItems = raw as unknown[];
    appealsByTarget[targetId] = appealItems.map((item) => {
      const parsed = appeal(item);
      if (parsed.targetId !== targetId) fail("subject_analysis_appeals_target_invalid");
      if (appealIds.has(parsed.id)) fail("subject_analysis_appeal_id_duplicate");
      appealIds.add(parsed.id);
      return parsed;
    });
  }
  if (Object.keys(appealsSource).some((key) => !targetIds.has(key))) fail("subject_analysis_appeals_target_invalid");
  const needItems: unknown[] = Array.isArray(source.needs) ? source.needs : fail("subject_analysis_needs_invalid");
  const needs = needItems.map((item) => { const e = exact(item, ["text", "sourceUrl"], "subject_analysis_needs_invalid"); return { text: stringValue(e.text, "subject_analysis_needs_invalid"), sourceUrl: https(e.sourceUrl, "subject_analysis_needs_source_invalid") }; });
  const alternativeItems: unknown[] = Array.isArray(source.alternatives) ? source.alternatives : fail("subject_analysis_alternatives_invalid");
  const alternatives = alternativeItems.map((item) => { const e = exact(item, ["name", "strengths", "limitations", "sourceUrls"], "subject_analysis_alternatives_invalid"); const urls: unknown[] = Array.isArray(e.sourceUrls) ? e.sourceUrls : fail("subject_analysis_alternatives_source_invalid"); if (urls.length === 0) fail("subject_analysis_alternatives_source_invalid"); return { name: stringValue(e.name, "subject_analysis_alternatives_invalid"), strengths: strings(e.strengths, "subject_analysis_alternatives_invalid"), limitations: strings(e.limitations, "subject_analysis_alternatives_invalid"), sourceUrls: urls.map((url) => https(url, "subject_analysis_alternatives_source_invalid")) }; });
  const vocItems: unknown[] = Array.isArray(source.voc) ? source.voc : fail("subject_analysis_voc_invalid");
  const voc = vocItems.map((item) => { const e = exact(item, ["quoteSummary", "context", "sourceUrl"], "subject_analysis_voc_invalid"); return { quoteSummary: stringValue(e.quoteSummary, "subject_analysis_voc_invalid"), context: stringValue(e.context, "subject_analysis_voc_invalid"), sourceUrl: https(e.sourceUrl, "subject_analysis_voc_source_invalid") }; });
  const uspItems: unknown[] = Array.isArray(source.usps) ? source.usps : fail("subject_analysis_usps_invalid");
  const usps = uspItems.map(evidence);
  const recommendedImageId = source.recommendedImageId === null ? null : stringValue(source.recommendedImageId, "subject_analysis_recommended_image_invalid", 200);
  return { contractVersion: "subject-analysis-result.v1", summary: stringValue(source.summary, "subject_analysis_summary_invalid"), needs, alternatives, voc, usps, targets, appealsByTarget, recommendedImageId, sourceGaps: strings(source.sourceGaps, "subject_analysis_source_gaps_invalid") };
}

export function parseSubjectAnalysisResultV2(value: unknown): SubjectAnalysisResultV2 {
  assertV2PayloadBudget(value);
  const source = exact(
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

  const verifiedFactItems: unknown[] = Array.isArray(source.verifiedFacts)
    ? source.verifiedFacts
    : fail("subject_analysis_verified_facts_invalid");
  if (verifiedFactItems.length > 50) fail("subject_analysis_verified_facts_invalid");
  const verifiedFacts = verifiedFactItems.map((item) => {
    const fact = exact(item, ["claim", "support", "sourceUrl"], "subject_analysis_verified_fact_invalid");
    return {
      claim: stringValue(fact.claim, "subject_analysis_verified_fact_invalid"),
      support: stringValue(fact.support, "subject_analysis_verified_fact_invalid"),
      sourceUrl: evidenceUrl(fact.sourceUrl),
    };
  });

  const vocItems: unknown[] = Array.isArray(source.voc) ? source.voc : fail("subject_analysis_voc_invalid");
  if (vocItems.length > 50) fail("subject_analysis_voc_invalid");
  const voc = vocItems.map((item) => {
    const entry = exact(item, ["quoteSummary", "context", "sourceUrl"], "subject_analysis_voc_invalid");
    return {
      quoteSummary: stringValue(entry.quoteSummary, "subject_analysis_voc_invalid"),
      context: stringValue(entry.context, "subject_analysis_voc_invalid"),
      sourceUrl: evidenceUrl(entry.sourceUrl),
    };
  });

  const alternativeItems: unknown[] = Array.isArray(source.alternatives)
    ? source.alternatives
    : fail("subject_analysis_alternatives_invalid");
  if (alternativeItems.length > 50) fail("subject_analysis_alternatives_invalid");
  const alternatives = alternativeItems.map((item) => {
    const entry = exact(item, ["name", "strengths", "limitations", "sourceUrls"], "subject_analysis_alternatives_invalid");
    const urls: unknown[] = Array.isArray(entry.sourceUrls)
      ? entry.sourceUrls
      : fail("subject_analysis_alternatives_invalid");
    if (urls.length === 0 || urls.length > 50) fail("subject_analysis_alternatives_invalid");
    return {
      name: stringValue(entry.name, "subject_analysis_alternatives_invalid", 500),
      strengths: strings(entry.strengths, "subject_analysis_alternatives_invalid"),
      limitations: strings(entry.limitations, "subject_analysis_alternatives_invalid"),
      sourceUrls: urls.map((url) => evidenceUrl(url)),
    };
  });

  const barrierItems: unknown[] = Array.isArray(source.barriers)
    ? source.barriers
    : fail("subject_analysis_barriers_invalid");
  if (barrierItems.length > 50) fail("subject_analysis_barriers_invalid");
  const barriers = barrierItems.map((item) => {
    const entry = exact(item, ["barrier", "evidence", "sourceUrls"], "subject_analysis_barrier_invalid");
    const urls: unknown[] = Array.isArray(entry.sourceUrls)
      ? entry.sourceUrls
      : fail("subject_analysis_barrier_invalid");
    if (urls.length > 50) fail("subject_analysis_barrier_invalid");
    return {
      barrier: stringValue(entry.barrier, "subject_analysis_barrier_invalid"),
      evidence: stringValue(entry.evidence, "subject_analysis_barrier_invalid"),
      sourceUrls: urls.map((url) => evidenceUrl(url)),
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
    summary: stringValue(source.summary, "subject_analysis_summary_invalid"),
    verifiedFacts,
    voc,
    alternatives,
    barriers,
    productProfile,
    serviceProfile,
    serviceSubtype: parsedSubtype,
    sourceGaps: strings(source.sourceGaps, "subject_analysis_source_gaps_invalid"),
  };
}
