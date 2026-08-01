import type { BrandIntelligenceResultV2 } from "./contracts.js";
import {
  BrandIntelligenceContractError,
  parseBrandIntelligenceResult,
} from "./result.js";

export interface FinalAuditSource {
  sourceId: string;
  sourceUrl: string | null;
  sourceKind: "owned" | "upload";
  text: string;
}

export interface FinalAuditValidationOptions {
  factIds: ReadonlySet<string>;
  sources: readonly FinalAuditSource[];
  observedExternalUrls: ReadonlySet<string>;
  allowedExternalUrls?: ReadonlySet<string>;
}

const CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

function fail(code: string): never {
  throw new BrandIntelligenceContractError(code);
}

function assertNoControlCharacters(value: unknown): void {
  if (typeof value === "string") {
    if (CONTROL_CHARACTERS.test(value)) fail("brand_intelligence_result_invalid");
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) assertNoControlCharacters(item);
    return;
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value)) assertNoControlCharacters(item);
  }
}
const normalizeEvidenceText = (value: string): string => (
  value.normalize("NFKC").replace(/\s+/g, " ").trim()
);

function canonicalHttpsUrl(value: string): string {
  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
      fail("brand_intelligence_external_registry_mismatch");
    }
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return fail("brand_intelligence_external_registry_mismatch");
  }
}

function rawFactIdsMatch(value: unknown, factIds: ReadonlySet<string>, allowEmpty = false): boolean {
  return Array.isArray(value)
    && (allowEmpty || value.length > 0)
    && value.every((id) => typeof id === "string" && factIds.has(id));
}

function assertRawFactRegistries(
  value: unknown,
  factIds: ReadonlySet<string>,
): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("brand_intelligence_final_audit_invalid");
  }
  const source = value as Record<string, unknown>;
  const companyName = source.companyNameSuggestion;
  if (!(companyName === null || (
    companyName
    && typeof companyName === "object"
    && !Array.isArray(companyName)
    && rawFactIdsMatch((companyName as Record<string, unknown>).sourceFactIds, factIds)
  ))) {
    fail("brand_intelligence_owned_fact_registry_mismatch");
  }
  if (!Array.isArray(source.offerings)
    || source.offerings.some((offering) => (
      !offering
      || typeof offering !== "object"
      || Array.isArray(offering)
      || !rawFactIdsMatch((offering as Record<string, unknown>).sourceFactIds, factIds)
    ))) {
    fail("brand_intelligence_owned_fact_registry_mismatch");
  }
  if (!Array.isArray(source.faqSuggestions)
    || source.faqSuggestions.some((faq) => (
      !faq
      || typeof faq !== "object"
      || Array.isArray(faq)
      || !rawFactIdsMatch((faq as Record<string, unknown>).sourceFactIds, factIds)
    ))) {
    fail("brand_intelligence_owned_fact_registry_mismatch");
  }
}

function canonicalUrlSet(values: ReadonlySet<string>): Set<string> {
  return new Set([...values].map(canonicalHttpsUrl));
}

export function validateFinalAuditResult(
  value: unknown,
  options: FinalAuditValidationOptions,
): BrandIntelligenceResultV2 {
  assertRawFactRegistries(value, options.factIds);
  if (value.contractVersion !== "brand-intelligence-result.v2") {
    fail("brand_intelligence_final_audit_invalid");
  }
  assertNoControlCharacters(value);

  // Raw registry checks deliberately run first so compatibility defaults and
  // string normalization cannot hide fields or alter model-provided IDs.
  const parsedResult = parseBrandIntelligenceResult(value);
  if (parsedResult.contractVersion !== "brand-intelligence-result.v2") {
    fail("brand_intelligence_final_audit_invalid");
  }
  const parsed = parsedResult as BrandIntelligenceResultV2;

  if (parsed.observedTone?.sourceFactIds.some((id) => !options.factIds.has(id))) {
    fail("brand_intelligence_owned_fact_registry_mismatch");
  }

  const observedExternalUrls = canonicalUrlSet(options.observedExternalUrls);
  const allowedExternalUrls = options.allowedExternalUrls
    ? canonicalUrlSet(options.allowedExternalUrls)
    : observedExternalUrls;
  const resultExternalUrls = new Set([
    ...parsed.competitors.flatMap((item) => item.sourceUrls.map(canonicalHttpsUrl)),
    ...parsed.marketContext.flatMap((item) => item.sourceUrls.map(canonicalHttpsUrl)),
    ...parsed.evidence.flatMap((item) => (
      item.sourceKind === "external" && item.sourceUrl
        ? [canonicalHttpsUrl(item.sourceUrl)]
        : []
    )),
  ]);
  if (resultExternalUrls.size > 10) {
    fail("brand_intelligence_external_url_limit_exceeded");
  }
  for (const url of resultExternalUrls) {
    if (!observedExternalUrls.has(url) || !allowedExternalUrls.has(url)) {
      fail("brand_intelligence_external_registry_mismatch");
    }
  }

  const sourceRegistry = new Map<string, {
    sourceUrl: string | null;
    sourceKind: "owned" | "upload";
    normalizedText: string;
  }>();
  for (const source of options.sources) {
    const current = sourceRegistry.get(source.sourceId);
    if (current && (current.sourceUrl !== source.sourceUrl || current.sourceKind !== source.sourceKind)) {
      fail("brand_intelligence_evidence_registry_mismatch");
    }
    sourceRegistry.set(source.sourceId, {
      sourceUrl: source.sourceUrl,
      sourceKind: source.sourceKind,
      normalizedText: normalizeEvidenceText(
        current ? `${current.normalizedText}\n${source.text}` : source.text,
      ),
    });
  }

  for (const item of parsed.evidence) {
    if (item.sourceKind === "external") {
      if (!item.sourceUrl) fail("brand_intelligence_external_registry_mismatch");
      const sourceUrl = canonicalHttpsUrl(item.sourceUrl);
      if (!observedExternalUrls.has(sourceUrl)
        || !allowedExternalUrls.has(sourceUrl)
        || item.sourceId !== `external:${sourceUrl}`) {
        fail("brand_intelligence_external_registry_mismatch");
      }
      continue;
    }

    const source = sourceRegistry.get(item.sourceId);
    if (!source) fail("brand_intelligence_evidence_registry_mismatch");
    if (item.sourceKind !== source.sourceKind
      || (source.sourceKind === "owned"
        && (!item.sourceUrl || canonicalHttpsUrl(item.sourceUrl) !== source.sourceUrl))
      || (source.sourceKind === "upload" && item.sourceUrl !== null)) {
      fail("brand_intelligence_evidence_registry_mismatch");
    }
    if (!source.normalizedText.includes(normalizeEvidenceText(item.excerpt))) {
      fail("brand_intelligence_evidence_quote_mismatch");
    }
  }

  return parsed;
}
