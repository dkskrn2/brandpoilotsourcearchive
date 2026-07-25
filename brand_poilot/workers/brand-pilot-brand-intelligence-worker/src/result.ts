import type { BrandIntelligenceResult } from "./contracts.js";

export class BrandIntelligenceContractError extends Error {
  readonly retryable = false;
  constructor(message: string) {
    super(message);
    this.name = "BrandIntelligenceContractError";
  }
}

const fail = (code: string): never => { throw new BrandIntelligenceContractError(code); };
const record = (value: unknown, code: string): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(code);
  return value as Record<string, unknown>;
};
const exact = (value: unknown, keys: readonly string[], code: string) => {
  const source = record(value, code);
  if (Object.keys(source).some((key) => !keys.includes(key))) fail(code);
  return source;
};
const stringValue = (value: unknown, code: string, max = 4_000): string => {
  if (typeof value !== "string") fail(code);
  const normalized = (value as string).trim();
  if (!normalized || normalized.length > max) fail(code);
  return normalized;
};
const nullableString = (value: unknown, code: string, max = 300): string | null => (
  value === null || value === undefined || value === "" ? null : stringValue(value, code, max)
);
const https = (value: unknown, code: string): string => {
  const url = stringValue(value, code, 2_048);
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) fail(code);
  } catch { fail(code); }
  return url;
};
const array = <T>(value: unknown, code: string, parser: (entry: unknown) => T, max = 50): T[] => {
  if (!Array.isArray(value) || value.length > max) fail(code);
  return (value as unknown[]).map(parser);
};

function category(value: unknown, code: string) {
  const source = exact(value, ["code", "name"], code);
  return { code: nullableString(source.code, code), name: stringValue(source.name, code, 300) };
}

export function parseBrandIntelligenceResult(value: unknown): BrandIntelligenceResult {
  const source = exact(value, [
    "contractVersion", "companyOverview", "businessDescription", "primaryCategory",
    "subcategories", "primaryTarget", "differentiators", "coreAppeal", "competitors",
    "evidence", "sourceGaps",
  ], "brand_intelligence_result_invalid");
  if (source.contractVersion !== "brand-intelligence-result.v1") {
    fail("brand_intelligence_result_version_invalid");
  }
  return {
    contractVersion: "brand-intelligence-result.v1",
    companyOverview: stringValue(source.companyOverview, "brand_intelligence_company_overview_invalid"),
    businessDescription: stringValue(source.businessDescription, "brand_intelligence_business_description_invalid"),
    primaryCategory: category(source.primaryCategory, "brand_intelligence_primary_category_invalid"),
    subcategories: array(source.subcategories, "brand_intelligence_subcategories_invalid", (entry) => (
      category(entry, "brand_intelligence_subcategory_invalid")
    ), 20),
    primaryTarget: stringValue(source.primaryTarget, "brand_intelligence_primary_target_invalid"),
    differentiators: stringValue(source.differentiators, "brand_intelligence_differentiators_invalid"),
    coreAppeal: stringValue(source.coreAppeal, "brand_intelligence_core_appeal_invalid"),
    competitors: array(source.competitors, "brand_intelligence_competitors_invalid", (entry) => {
      const item = exact(entry, ["name", "description", "sourceUrls"], "brand_intelligence_competitor_invalid");
      const sourceUrls = array(item.sourceUrls, "brand_intelligence_competitor_invalid", (url) => (
        https(url, "brand_intelligence_competitor_invalid")
      ), 10);
      if (sourceUrls.length === 0) fail("brand_intelligence_competitor_invalid");
      return {
        name: stringValue(item.name, "brand_intelligence_competitor_invalid", 300),
        description: stringValue(item.description, "brand_intelligence_competitor_invalid"),
        sourceUrls,
      };
    }, 20),
    evidence: array(source.evidence, "brand_intelligence_evidence_invalid", (entry) => {
      const item = exact(entry, ["field", "claim", "sourceId", "sourceUrl"], "brand_intelligence_evidence_invalid");
      return {
        field: stringValue(item.field, "brand_intelligence_evidence_invalid", 100),
        claim: stringValue(item.claim, "brand_intelligence_evidence_invalid"),
        sourceId: stringValue(item.sourceId, "brand_intelligence_evidence_invalid", 200),
        sourceUrl: item.sourceUrl === null ? null : https(item.sourceUrl, "brand_intelligence_evidence_invalid"),
      };
    }, 100),
    sourceGaps: array(source.sourceGaps, "brand_intelligence_source_gaps_invalid", (entry) => (
      stringValue(entry, "brand_intelligence_source_gaps_invalid")
    )),
  };
}
