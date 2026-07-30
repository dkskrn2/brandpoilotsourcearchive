import type { BrandIntelligenceResultV1 } from "./brandIntelligenceContracts.js";

export interface BrandOfferingV2 {
  kind: "product" | "service";
  name: string;
  description: string | null;
  target: string | null;
  benefit: string | null;
  priceText: string | null;
  purchaseUrl: string | null;
  sourceFactIds: string[];
}

export interface BrandIntelligenceResultV2 {
  contractVersion: "brand-intelligence-result.v2";
  oneLineDefinition: string | null;
  companyOverview: string | null;
  businessDescription: string | null;
  primaryCategory: { code: string | null; name: string } | null;
  subcategories: Array<{ code: string | null; name: string }>;
  primaryTarget: string | null;
  secondaryTargets: string[];
  customerNeeds: string[];
  valueProposition: string | null;
  differentiators: string[];
  coreAppeal: string | null;
  supportingAppeals: string[];
  offerings: BrandOfferingV2[];
  keywords: string[];
  observedTone: { summary: string; sourceFactIds: string[] } | null;
  competitors: Array<{ name: string; description: string; sourceUrls: string[] }>;
  marketContext: Array<{ claim: string; sourceUrls: string[] }>;
  evidence: Array<{
    fieldPath: string;
    claim: string;
    sourceId: string;
    sourceUrl: string | null;
    excerpt: string;
    sourceKind: "owned" | "external" | "upload";
  }>;
  sourceGaps: string[];
}

export type BrandIntelligenceResult =
  | BrandIntelligenceResultV1
  | BrandIntelligenceResultV2;

export interface BrandIntelligenceValidationRegistry {
  ownedFactIds?: ReadonlySet<string>;
  ownedSourceIds?: ReadonlySet<string>;
  uploadSourceIds?: ReadonlySet<string>;
  externalSources?: ReadonlyMap<string, string>;
}

export interface BrandIntelligenceCommonView {
  contractVersion: "brand-intelligence-result.v1" | "brand-intelligence-result.v2";
  companyName: string | null;
  companyOverview: string | null;
  businessDescription: string | null;
  primaryCategory: { code: string | null; name: string } | null;
  subcategories: Array<{ code: string | null; name: string }>;
  primaryTarget: string | null;
  differentiators: string[];
  coreAppeal: string | null;
  offerings: BrandOfferingV2[];
  competitors: Array<{ name: string; description: string; sourceUrls: string[] }>;
  sourceGaps: string[];
}

const CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

function fail(code: string): never {
  throw new Error(code);
}

function object(value: unknown, keys: readonly string[], code: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(code);
  const source = value as Record<string, unknown>;
  if (Object.keys(source).some((key) => !keys.includes(key))) fail(code);
  return source;
}

function text(value: unknown, code: string, maximum = 4_000): string {
  if (typeof value !== "string") fail(code);
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum || CONTROL_CHARACTERS.test(normalized)) {
    fail(code);
  }
  return normalized;
}

function nullableText(value: unknown, code: string, maximum = 4_000): string | null {
  if (value === null || value === undefined || value === "") return null;
  return text(value, code, maximum);
}

function list<T>(
  value: unknown,
  code: string,
  parse: (item: unknown) => T,
  maximum: number,
): T[] {
  if (!Array.isArray(value) || value.length > maximum) fail(code);
  return value.map(parse);
}

function url(value: unknown, code: string): string {
  const normalized = text(value, code, 2_048);
  try {
    const parsed = new URL(normalized);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) fail(code);
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return fail(code);
  }
}

function nullableUrl(value: unknown, code: string): string | null {
  if (value === null || value === undefined || value === "") return null;
  return url(value, code);
}

function category(value: unknown, code: string) {
  const source = object(value, ["code", "name"], code);
  return {
    code: nullableText(source.code, code, 200),
    name: text(source.name, code, 300),
  };
}

function factIds(
  value: unknown,
  registry: BrandIntelligenceValidationRegistry,
): string[] {
  return list(
    value,
    "brand_intelligence_source_fact_ids_invalid",
    (item) => {
      const id = text(item, "brand_intelligence_source_fact_ids_invalid", 200);
      if (registry.ownedFactIds && !registry.ownedFactIds.has(id)) {
        fail("brand_intelligence_owned_fact_registry_mismatch");
      }
      return id;
    },
    50,
  );
}

export function parseBrandIntelligenceResultV2(
  value: unknown,
  registry: BrandIntelligenceValidationRegistry = {},
): BrandIntelligenceResultV2 {
  const source = object(value, [
    "contractVersion", "oneLineDefinition", "companyOverview", "businessDescription",
    "primaryCategory", "subcategories", "primaryTarget", "secondaryTargets",
    "customerNeeds", "valueProposition", "differentiators", "coreAppeal",
    "supportingAppeals", "offerings", "keywords", "observedTone", "competitors",
    "marketContext", "evidence", "sourceGaps",
  ], "brand_intelligence_result_invalid");
  if (source.contractVersion !== "brand-intelligence-result.v2") {
    fail("brand_intelligence_result_version_invalid");
  }

  const offerings = list(
    source.offerings,
    "brand_intelligence_offering_limit_exceeded",
    (item): BrandOfferingV2 => {
      const entry = object(item, [
        "kind", "name", "description", "target", "benefit", "priceText",
        "purchaseUrl", "sourceFactIds",
      ], "brand_intelligence_offering_invalid");
      if (entry.kind !== "product" && entry.kind !== "service") {
        fail("brand_intelligence_offering_invalid");
      }
      return {
        kind: entry.kind,
        name: text(entry.name, "brand_intelligence_offering_invalid", 300),
        description: nullableText(entry.description, "brand_intelligence_offering_invalid"),
        target: nullableText(entry.target, "brand_intelligence_offering_invalid", 1_000),
        benefit: nullableText(entry.benefit, "brand_intelligence_offering_invalid", 1_000),
        priceText: nullableText(entry.priceText, "brand_intelligence_offering_invalid", 500),
        purchaseUrl: nullableUrl(entry.purchaseUrl, "brand_intelligence_offering_invalid"),
        sourceFactIds: factIds(entry.sourceFactIds, registry),
      };
    },
    5,
  );

  const competitors = list(source.competitors, "brand_intelligence_competitors_invalid", (item) => {
    const entry = object(item, ["name", "description", "sourceUrls"], "brand_intelligence_competitor_invalid");
    const sourceUrls = list(
      entry.sourceUrls,
      "brand_intelligence_competitor_invalid",
      (itemUrl) => url(itemUrl, "brand_intelligence_competitor_invalid"),
      10,
    );
    if (!sourceUrls.length) fail("brand_intelligence_competitor_invalid");
    return {
      name: text(entry.name, "brand_intelligence_competitor_invalid", 300),
      description: text(entry.description, "brand_intelligence_competitor_invalid"),
      sourceUrls,
    };
  }, 20);

  const marketContext = list(source.marketContext, "brand_intelligence_market_context_invalid", (item) => {
    const entry = object(item, ["claim", "sourceUrls"], "brand_intelligence_market_context_invalid");
    const sourceUrls = list(
      entry.sourceUrls,
      "brand_intelligence_market_context_invalid",
      (itemUrl) => url(itemUrl, "brand_intelligence_market_context_invalid"),
      10,
    );
    if (!sourceUrls.length) fail("brand_intelligence_market_context_invalid");
    return {
      claim: text(entry.claim, "brand_intelligence_market_context_invalid"),
      sourceUrls,
    };
  }, 20);

  const evidence = list(source.evidence, "brand_intelligence_evidence_invalid", (item): BrandIntelligenceResultV2["evidence"][number] => {
    const entry = object(item, [
      "fieldPath", "claim", "sourceId", "sourceUrl", "excerpt", "sourceKind",
    ], "brand_intelligence_evidence_invalid");
    if (entry.sourceKind !== "owned" && entry.sourceKind !== "external"
      && entry.sourceKind !== "upload") {
      fail("brand_intelligence_evidence_invalid");
    }
    const sourceId = text(entry.sourceId, "brand_intelligence_evidence_invalid", 200);
    const sourceUrl = nullableUrl(entry.sourceUrl, "brand_intelligence_evidence_invalid");
    if (entry.sourceKind === "owned" && registry.ownedSourceIds
      && !registry.ownedSourceIds.has(sourceId)) {
      fail("brand_intelligence_evidence_registry_mismatch");
    }
    if (entry.sourceKind === "upload" && registry.uploadSourceIds
      && !registry.uploadSourceIds.has(sourceId)) {
      fail("brand_intelligence_evidence_registry_mismatch");
    }
    if (entry.sourceKind === "external" && (
      !sourceUrl
      || (registry.externalSources
        && registry.externalSources.get(sourceUrl) !== sourceId)
    )) {
      fail("brand_intelligence_external_registry_mismatch");
    }
    return {
      fieldPath: text(entry.fieldPath, "brand_intelligence_evidence_invalid", 300),
      claim: text(entry.claim, "brand_intelligence_evidence_invalid"),
      sourceId,
      sourceUrl,
      excerpt: text(entry.excerpt, "brand_intelligence_evidence_invalid", 2_000),
      sourceKind: entry.sourceKind,
    };
  }, 100);

  const externalUrls = new Set([
    ...competitors.flatMap((entry) => entry.sourceUrls),
    ...marketContext.flatMap((entry) => entry.sourceUrls),
    ...evidence.flatMap((entry) => entry.sourceKind === "external" && entry.sourceUrl
      ? [entry.sourceUrl]
      : []),
  ]);
  if (externalUrls.size > 10) fail("brand_intelligence_external_url_limit_exceeded");
  if (registry.externalSources) {
    for (const externalUrl of externalUrls) {
      if (!registry.externalSources.has(externalUrl)) {
        fail("brand_intelligence_external_registry_mismatch");
      }
    }
  }

  const observedToneSource = source.observedTone === null
    ? null
    : object(source.observedTone, ["summary", "sourceFactIds"], "brand_intelligence_observed_tone_invalid");

  return {
    contractVersion: "brand-intelligence-result.v2",
    oneLineDefinition: nullableText(source.oneLineDefinition, "brand_intelligence_one_line_definition_invalid", 500),
    companyOverview: nullableText(source.companyOverview, "brand_intelligence_company_overview_invalid"),
    businessDescription: nullableText(source.businessDescription, "brand_intelligence_business_description_invalid"),
    primaryCategory: source.primaryCategory === null
      ? null
      : category(source.primaryCategory, "brand_intelligence_primary_category_invalid"),
    subcategories: list(
      source.subcategories,
      "brand_intelligence_subcategories_invalid",
      (item) => category(item, "brand_intelligence_subcategory_invalid"),
      20,
    ),
    primaryTarget: nullableText(source.primaryTarget, "brand_intelligence_primary_target_invalid"),
    secondaryTargets: list(source.secondaryTargets, "brand_intelligence_secondary_targets_invalid", (item) => (
      text(item, "brand_intelligence_secondary_targets_invalid", 1_000)
    ), 20),
    customerNeeds: list(source.customerNeeds, "brand_intelligence_customer_needs_invalid", (item) => (
      text(item, "brand_intelligence_customer_needs_invalid", 1_000)
    ), 20),
    valueProposition: nullableText(source.valueProposition, "brand_intelligence_value_proposition_invalid"),
    differentiators: list(source.differentiators, "brand_intelligence_differentiators_invalid", (item) => (
      text(item, "brand_intelligence_differentiators_invalid", 1_000)
    ), 20),
    coreAppeal: nullableText(source.coreAppeal, "brand_intelligence_core_appeal_invalid"),
    supportingAppeals: list(source.supportingAppeals, "brand_intelligence_supporting_appeals_invalid", (item) => (
      text(item, "brand_intelligence_supporting_appeals_invalid", 1_000)
    ), 20),
    offerings,
    keywords: list(source.keywords, "brand_intelligence_keywords_invalid", (item) => (
      text(item, "brand_intelligence_keywords_invalid", 200)
    ), 50),
    observedTone: observedToneSource
      ? {
          summary: text(observedToneSource.summary, "brand_intelligence_observed_tone_invalid", 1_000),
          sourceFactIds: factIds(observedToneSource.sourceFactIds, registry),
        }
      : null,
    competitors,
    marketContext,
    evidence,
    sourceGaps: list(source.sourceGaps, "brand_intelligence_source_gaps_invalid", (item) => (
      text(item, "brand_intelligence_source_gaps_invalid")
    ), 50),
  };
}

export function toBrandIntelligenceCommonView(
  result: BrandIntelligenceResult,
  confirmedCompanyName: string | null,
): BrandIntelligenceCommonView {
  if (result.contractVersion === "brand-intelligence-result.v1") {
    return {
      contractVersion: result.contractVersion,
      companyName: confirmedCompanyName,
      companyOverview: result.companyOverview,
      businessDescription: result.businessDescription,
      primaryCategory: result.primaryCategory,
      subcategories: result.subcategories,
      primaryTarget: result.primaryTarget,
      differentiators: result.differentiators ? [result.differentiators] : [],
      coreAppeal: result.coreAppeal,
      offerings: [],
      competitors: result.competitors,
      sourceGaps: result.sourceGaps,
    };
  }
  return {
    contractVersion: result.contractVersion,
    companyName: confirmedCompanyName,
    companyOverview: result.companyOverview,
    businessDescription: result.businessDescription,
    primaryCategory: result.primaryCategory,
    subcategories: result.subcategories,
    primaryTarget: result.primaryTarget,
    differentiators: result.differentiators,
    coreAppeal: result.coreAppeal,
    offerings: result.offerings,
    competitors: result.competitors,
    sourceGaps: result.sourceGaps,
  };
}
