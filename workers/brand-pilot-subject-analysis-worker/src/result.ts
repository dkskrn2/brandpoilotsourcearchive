import type { SubjectAnalysisResult, SubjectAppeal, SubjectEvidenceType, SubjectTarget } from "./contracts.js";

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
