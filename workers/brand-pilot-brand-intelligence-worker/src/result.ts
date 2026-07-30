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

function parseV1(value: unknown): BrandIntelligenceResult {
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

function stringList(value: unknown, code: string, max = 50): string[] {
  return array(value, code, (entry) => stringValue(entry, code, 1_000), max);
}

function nullableHttps(value: unknown, code: string): string | null {
  return value === null || value === undefined || value === "" ? null : https(value, code);
}

function parseV2(value: unknown): BrandIntelligenceResult {
  const source = exact(value, [
    "contractVersion", "oneLineDefinition", "companyOverview", "businessDescription",
    "primaryCategory", "subcategories", "primaryTarget", "secondaryTargets",
    "customerNeeds", "valueProposition", "differentiators", "coreAppeal",
    "supportingAppeals", "offerings", "keywords", "observedTone", "competitors",
    "marketContext", "evidence", "sourceGaps",
  ], "brand_intelligence_result_invalid");
  if (source.contractVersion !== "brand-intelligence-result.v2") {
    fail("brand_intelligence_result_version_invalid");
  }
  const offerings = array(source.offerings, "brand_intelligence_offering_limit_exceeded", (entry) => {
    const item = exact(entry, [
      "kind", "name", "description", "target", "benefit", "priceText",
      "purchaseUrl", "sourceFactIds",
    ], "brand_intelligence_offering_invalid");
    if (item.kind !== "product" && item.kind !== "service") {
      fail("brand_intelligence_offering_invalid");
    }
    const kind = item.kind as "product" | "service";
    return {
      kind,
      name: stringValue(item.name, "brand_intelligence_offering_invalid", 300),
      description: nullableString(item.description, "brand_intelligence_offering_invalid", 4_000),
      target: nullableString(item.target, "brand_intelligence_offering_invalid", 1_000),
      benefit: nullableString(item.benefit, "brand_intelligence_offering_invalid", 1_000),
      priceText: nullableString(item.priceText, "brand_intelligence_offering_invalid", 500),
      purchaseUrl: nullableHttps(item.purchaseUrl, "brand_intelligence_offering_invalid"),
      sourceFactIds: stringList(item.sourceFactIds, "brand_intelligence_offering_invalid"),
    };
  }, 5);
  const competitors = array(source.competitors, "brand_intelligence_competitors_invalid", (entry) => {
    const item = exact(entry, ["name", "description", "sourceUrls"], "brand_intelligence_competitor_invalid");
    const sourceUrls = array(item.sourceUrls, "brand_intelligence_competitor_invalid", (url) => (
      https(url, "brand_intelligence_competitor_invalid")
    ), 10);
    if (!sourceUrls.length) fail("brand_intelligence_competitor_invalid");
    return {
      name: stringValue(item.name, "brand_intelligence_competitor_invalid", 300),
      description: stringValue(item.description, "brand_intelligence_competitor_invalid"),
      sourceUrls,
    };
  }, 20);
  const marketContext = array(source.marketContext, "brand_intelligence_market_context_invalid", (entry) => {
    const item = exact(entry, ["claim", "sourceUrls"], "brand_intelligence_market_context_invalid");
    const sourceUrls = array(item.sourceUrls, "brand_intelligence_market_context_invalid", (url) => (
      https(url, "brand_intelligence_market_context_invalid")
    ), 10);
    if (!sourceUrls.length) fail("brand_intelligence_market_context_invalid");
    return {
      claim: stringValue(item.claim, "brand_intelligence_market_context_invalid"),
      sourceUrls,
    };
  }, 20);
  const externalUrls = new Set([
    ...competitors.flatMap((item) => item.sourceUrls),
    ...marketContext.flatMap((item) => item.sourceUrls),
  ]);
  if (externalUrls.size > 10) fail("brand_intelligence_external_url_limit_exceeded");
  const observed = source.observedTone === null
    ? null
    : exact(source.observedTone, ["summary", "sourceFactIds"], "brand_intelligence_observed_tone_invalid");
  return {
    contractVersion: "brand-intelligence-result.v2",
    oneLineDefinition: nullableString(source.oneLineDefinition, "brand_intelligence_one_line_definition_invalid", 500),
    companyOverview: nullableString(source.companyOverview, "brand_intelligence_company_overview_invalid", 4_000),
    businessDescription: nullableString(source.businessDescription, "brand_intelligence_business_description_invalid", 4_000),
    primaryCategory: source.primaryCategory === null
      ? null
      : category(source.primaryCategory, "brand_intelligence_primary_category_invalid"),
    subcategories: array(source.subcategories, "brand_intelligence_subcategories_invalid", (entry) => (
      category(entry, "brand_intelligence_subcategory_invalid")
    ), 20),
    primaryTarget: nullableString(source.primaryTarget, "brand_intelligence_primary_target_invalid", 4_000),
    secondaryTargets: stringList(source.secondaryTargets, "brand_intelligence_secondary_targets_invalid", 20),
    customerNeeds: stringList(source.customerNeeds, "brand_intelligence_customer_needs_invalid", 20),
    valueProposition: nullableString(source.valueProposition, "brand_intelligence_value_proposition_invalid", 4_000),
    differentiators: stringList(source.differentiators, "brand_intelligence_differentiators_invalid", 20),
    coreAppeal: nullableString(source.coreAppeal, "brand_intelligence_core_appeal_invalid", 4_000),
    supportingAppeals: stringList(source.supportingAppeals, "brand_intelligence_supporting_appeals_invalid", 20),
    offerings,
    keywords: stringList(source.keywords, "brand_intelligence_keywords_invalid", 50),
    observedTone: observed ? {
      summary: stringValue(observed.summary, "brand_intelligence_observed_tone_invalid", 1_000),
      sourceFactIds: stringList(observed.sourceFactIds, "brand_intelligence_observed_tone_invalid"),
    } : null,
    competitors,
    marketContext,
    evidence: array(source.evidence, "brand_intelligence_evidence_invalid", (entry) => {
      const item = exact(entry, [
        "fieldPath", "claim", "sourceId", "sourceUrl", "excerpt", "sourceKind",
      ], "brand_intelligence_evidence_invalid");
      if (item.sourceKind !== "owned" && item.sourceKind !== "external"
        && item.sourceKind !== "upload") fail("brand_intelligence_evidence_invalid");
      const sourceKind = item.sourceKind as "owned" | "external" | "upload";
      return {
        fieldPath: stringValue(item.fieldPath, "brand_intelligence_evidence_invalid", 300),
        claim: stringValue(item.claim, "brand_intelligence_evidence_invalid"),
        sourceId: stringValue(item.sourceId, "brand_intelligence_evidence_invalid", 200),
        sourceUrl: nullableHttps(item.sourceUrl, "brand_intelligence_evidence_invalid"),
        excerpt: stringValue(item.excerpt, "brand_intelligence_evidence_invalid", 2_000),
        sourceKind,
      };
    }, 100),
    sourceGaps: stringList(source.sourceGaps, "brand_intelligence_source_gaps_invalid"),
  };
}

export function parseBrandIntelligenceResult(value: unknown): BrandIntelligenceResult {
  const version = value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>).contractVersion
    : null;
  return version === "brand-intelligence-result.v2" ? parseV2(value) : parseV1(value);
}
