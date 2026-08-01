export interface OwnedFact {
  id: string;
  claim: string;
  sourceId: string;
  segmentId: string;
  sourceUrl: string | null;
  quotes: string[];
  category: string;
  support: "supported" | "conflicting" | "missing";
}

export interface ExternalCandidate {
  url: string;
  reason: string;
}

export interface OfferingCompanyNameSuggestion {
  name: string;
  sourceFactIds: string[];
}

export type OfferingKind = "product" | "service";

export interface OfferingSuggestion {
  kind: OfferingKind;
  name: string;
  description: string | null;
  target: string | null;
  benefit: string | null;
  priceText: string | null;
  purchaseUrl: string | null;
  sourceFactIds: string[];
}

export type OfferingFaqCategory =
  | "service"
  | "product"
  | "price"
  | "location"
  | "operation"
  | "other";

export interface OfferingFaqSuggestion {
  question: string;
  answer: string;
  category: OfferingFaqCategory;
  sourceFactIds: string[];
}

export interface OfferingSuggestions {
  companyNameSuggestion: OfferingCompanyNameSuggestion | null;
  offerings: OfferingSuggestion[];
  faqSuggestions: OfferingFaqSuggestion[];
}

export interface OfferingSuggestionDropCounts {
  companyNameSuggestion: number;
  offerings: number;
  faqSuggestions: number;
}

export interface StageEnvelope<T> {
  stageVersion: string;
  output: T;
}

export interface RegisteredSegment {
  sourceId: string;
  sourceUrl: string | null;
  normalizedText: string;
}

function fail(code: string): never {
  throw new Error(code);
}

function strictObject(
  value: unknown,
  keys: readonly string[],
  code: string,
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(code);
  const source = value as Record<string, unknown>;
  if (Object.keys(source).some((key) => !keys.includes(key))) fail(code);
  return source;
}

function text(value: unknown, code: string, maximum = 4_000): string {
  if (typeof value !== "string") fail(code);
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum
    || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(normalized)) {
    fail(code);
  }
  return normalized;
}

function normalizedForQuote(value: string): string {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim();
}

function httpsUrl(value: unknown, code: string): string {
  const raw = text(value, code, 2_048);
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) fail(code);
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return fail(code);
  }
}

function nullableText(value: unknown, code: string, maximum: number): string | null {
  return value === null || value === undefined || value === ""
    ? null
    : text(value, code, maximum);
}

function nullableHttpsUrl(value: unknown, code: string): string | null {
  return value === null || value === undefined || value === ""
    ? null
    : httpsUrl(value, code);
}

function sourceFactIdList(value: unknown, code: string): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 50) fail(code);
  return Array.from(value, (entry) => {
    if (typeof entry !== "string" || entry.length > 200) fail(code);
    text(entry, code, 200);
    return entry;
  });
}

function hasRegistryMismatch(
  sourceFactIds: readonly string[],
  factIds: ReadonlySet<string>,
): boolean {
  return sourceFactIds.some((id) => !factIds.has(id));
}

export function parseOfferingSuggestions(
  value: unknown,
  factIds: ReadonlySet<string>,
  options: { registryMismatch?: "reject" | "drop-item" } = {},
): {
  output: OfferingSuggestions;
  dropped: OfferingSuggestionDropCounts;
} {
  const source = strictObject(
    value,
    ["companyNameSuggestion", "offerings", "faqSuggestions"],
    "brand_intelligence_offering_invalid",
  );

  const companySource = source.companyNameSuggestion === null
    ? null
    : strictObject(
        source.companyNameSuggestion,
        ["name", "sourceFactIds"],
        "brand_intelligence_company_name_suggestion_invalid",
      );
  const companyNameSuggestion: OfferingCompanyNameSuggestion | null = companySource
    ? {
        name: text(
          companySource.name,
          "brand_intelligence_company_name_suggestion_invalid",
          100,
        ),
        sourceFactIds: sourceFactIdList(
          companySource.sourceFactIds,
          "brand_intelligence_company_name_suggestion_invalid",
        ),
      }
    : null;

  if (!Array.isArray(source.offerings)) fail("brand_intelligence_offering_invalid");
  if (source.offerings.length > 5) fail("brand_intelligence_offering_limit_exceeded");
  const offerings: OfferingSuggestion[] = Array.from(source.offerings, (entry) => {
    const item = strictObject(entry, [
      "kind", "name", "description", "target", "benefit", "priceText",
      "purchaseUrl", "sourceFactIds",
    ], "brand_intelligence_offering_invalid");
    if (item.kind !== "product" && item.kind !== "service") {
      fail("brand_intelligence_offering_invalid");
    }
    return {
      kind: item.kind,
      name: text(item.name, "brand_intelligence_offering_invalid", 300),
      description: nullableText(
        item.description,
        "brand_intelligence_offering_invalid",
        4_000,
      ),
      target: nullableText(item.target, "brand_intelligence_offering_invalid", 1_000),
      benefit: nullableText(item.benefit, "brand_intelligence_offering_invalid", 1_000),
      priceText: nullableText(
        item.priceText,
        "brand_intelligence_offering_invalid",
        500,
      ),
      purchaseUrl: nullableHttpsUrl(
        item.purchaseUrl,
        "brand_intelligence_offering_invalid",
      ),
      sourceFactIds: sourceFactIdList(
        item.sourceFactIds,
        "brand_intelligence_offering_invalid",
      ),
    };
  });

  if (!Array.isArray(source.faqSuggestions)) fail("brand_intelligence_faq_invalid");
  if (source.faqSuggestions.length > 20) fail("brand_intelligence_faq_limit_exceeded");
  const faqCategories = new Set<OfferingFaqCategory>([
    "service", "product", "price", "location", "operation", "other",
  ]);
  const faqSuggestions: OfferingFaqSuggestion[] = Array.from(
    source.faqSuggestions,
    (entry) => {
      const item = strictObject(
        entry,
        ["question", "answer", "category", "sourceFactIds"],
        "brand_intelligence_faq_invalid",
      );
      if (!faqCategories.has(item.category as OfferingFaqCategory)) {
        fail("brand_intelligence_faq_invalid");
      }
      return {
        question: text(item.question, "brand_intelligence_faq_invalid", 300),
        answer: text(item.answer, "brand_intelligence_faq_invalid", 4_000),
        category: item.category as OfferingFaqCategory,
        sourceFactIds: sourceFactIdList(
          item.sourceFactIds,
          "brand_intelligence_faq_invalid",
        ),
      };
    },
  );

  const dropped: OfferingSuggestionDropCounts = {
    companyNameSuggestion: 0,
    offerings: 0,
    faqSuggestions: 0,
  };
  const dropRegistryMismatch = options.registryMismatch === "drop-item";

  let filteredCompanyNameSuggestion = companyNameSuggestion;
  if (companyNameSuggestion
    && hasRegistryMismatch(companyNameSuggestion.sourceFactIds, factIds)) {
    if (!dropRegistryMismatch) fail("brand_intelligence_offering_registry_mismatch");
    filteredCompanyNameSuggestion = null;
    dropped.companyNameSuggestion = 1;
  }

  const filteredOfferings = offerings.filter((item) => {
    if (!hasRegistryMismatch(item.sourceFactIds, factIds)) return true;
    if (!dropRegistryMismatch) fail("brand_intelligence_offering_registry_mismatch");
    dropped.offerings += 1;
    return false;
  });
  const filteredFaqSuggestions = faqSuggestions.filter((item) => {
    if (!hasRegistryMismatch(item.sourceFactIds, factIds)) return true;
    if (!dropRegistryMismatch) fail("brand_intelligence_offering_registry_mismatch");
    dropped.faqSuggestions += 1;
    return false;
  });

  return {
    output: {
      companyNameSuggestion: filteredCompanyNameSuggestion,
      offerings: filteredOfferings,
      faqSuggestions: filteredFaqSuggestions,
    },
    dropped,
  };
}

export function parseOwnedFactEnvelope(
  value: unknown,
  segments: ReadonlyMap<string, RegisteredSegment>,
  options: { quoteMismatch?: "reject" | "drop-fact" } = {},
): StageEnvelope<OwnedFact[]> {
  const envelope = strictObject(value, ["stageVersion", "output"], "owned_fact_envelope_invalid");
  if (envelope.stageVersion !== "owned-facts.v1" || !Array.isArray(envelope.output)
    || envelope.output.length > 500) {
    fail("owned_fact_envelope_invalid");
  }
  const ids = new Set<string>();
  const output: OwnedFact[] = [];
  for (const item of envelope.output) {
    const source = strictObject(item, [
      "id", "claim", "sourceId", "segmentId", "sourceUrl", "quotes", "category", "support",
    ], "owned_fact_invalid");
    const id = text(source.id, "owned_fact_invalid", 200);
    if (ids.has(id)) fail("owned_fact_id_duplicate");
    ids.add(id);
    const segmentId = text(source.segmentId, "owned_fact_invalid", 200);
    const segment = segments.get(segmentId);
    const sourceId = text(source.sourceId, "owned_fact_invalid", 200);
    if (!segment || segment.sourceId !== sourceId) {
      fail("owned_fact_source_registry_mismatch");
    }
    if (source.support !== "supported" && source.support !== "conflicting"
      && source.support !== "missing") {
      fail("owned_fact_invalid");
    }
    if (!Array.isArray(source.quotes) || source.quotes.length > 10) {
      fail("owned_fact_invalid");
    }
    const quotes = source.quotes.map((quote) => {
      return normalizedForQuote(text(quote, "owned_fact_invalid", 2_000));
    });
    const sourceUrl = source.sourceUrl === null
      ? null
      : httpsUrl(source.sourceUrl, "owned_fact_invalid");
    if (sourceUrl !== segment.sourceUrl) {
      fail("owned_fact_source_registry_mismatch");
    }
    const claim = text(source.claim, "owned_fact_invalid");
    const category = text(source.category, "owned_fact_invalid", 200);
    const normalizedSegment = normalizedForQuote(segment.normalizedText);
    const quoteMismatch = quotes.some((quote) => !normalizedSegment.includes(quote))
      || (source.support !== "missing" && quotes.length === 0);
    if (quoteMismatch) {
      if (options.quoteMismatch === "drop-fact") continue;
      fail("owned_fact_quote_mismatch");
    }
    output.push({
      id,
      claim,
      sourceId,
      segmentId,
      sourceUrl,
      quotes,
      category,
      support: source.support,
    });
  }
  return { stageVersion: "owned-facts.v1", output };
}

export function parseExternalCandidateEnvelope(
  value: unknown,
): StageEnvelope<ExternalCandidate[]> {
  const envelope = strictObject(
    value,
    ["stageVersion", "output"],
    "external_candidate_envelope_invalid",
  );
  if (envelope.stageVersion !== "external-candidates.v1"
    || !Array.isArray(envelope.output) || envelope.output.length > 50) {
    fail("external_candidate_envelope_invalid");
  }
  const seen = new Set<string>();
  const output: ExternalCandidate[] = [];
  for (const item of envelope.output) {
    const source = strictObject(item, ["url", "reason"], "external_candidate_invalid");
    const candidateUrl = httpsUrl(source.url, "external_candidate_invalid");
    if (seen.has(candidateUrl)) continue;
    seen.add(candidateUrl);
    output.push({
      url: candidateUrl,
      reason: text(source.reason, "external_candidate_invalid", 1_000),
    });
  }
  return { stageVersion: "external-candidates.v1", output };
}
