import type {
  BrandEvidenceSourceType,
  BrandIntelligenceResultV1,
} from "./brandIntelligenceContracts.js";

export interface BrandCoreV1 {
  contractVersion: "brand-core.v1";
  companyOverview?: string;
  businessDescription?: string;
  primaryCategory?: { code: string | null; name: string };
  subcategories?: Array<{ code: string | null; name: string }>;
  primaryTarget?: string;
  differentiators?: string[];
  coreAppeal?: string;
  summary: { oneLine: string; description: string };
  audiences: Array<{ name: string; problem: string; desiredOutcome: string }>;
  valueProposition: { primary: string; differentiators: string[]; proofPoints: string[] };
  messaging: {
    appeals: string[];
    tone: string[];
    preferredPhrases: string[];
    brandDirection: string;
    priorityMessages: string[];
  };
}

export interface BrandRulesV1 {
  contractVersion: "brand-rules.v1";
  requiredPhrases: string[];
  forbiddenPhrases: string[];
  exaggerationRules: string[];
  ctaRules: { defaultCta: string; allowed: string[] };
  channelRules: Record<string, string[]>;
  designRules: {
    colors: string[];
    fonts: string[];
    notes: string[];
    referenceImages: Array<{
      referenceItemId: string;
      description: string;
      tags: string[];
    }>;
  };
  autoApprovalRules: { enabled: boolean; conditions: string[] };
}

export type BrandCoreFieldPath =
  | "summary.oneLine"
  | "summary.description"
  | "audiences"
  | "valueProposition.primary"
  | "valueProposition.differentiators"
  | "valueProposition.proofPoints"
  | "messaging.appeals"
  | "messaging.tone"
  | "messaging.preferredPhrases"
  | "messaging.brandDirection"
  | "messaging.priorityMessages";

export type BrandEvidenceSource = BrandEvidenceSourceType | "public_web" | "analysis";

export interface BrandEvidenceItem {
  fieldPath: BrandCoreFieldPath;
  sourceType: BrandEvidenceSource;
  sourceId: string;
  sourceUrl: string | null;
  excerpt: string;
  confidence: number | null;
}

export type BrandReviewDecision = "ai_suggested" | "user_edited" | "approved";

export interface BrandFieldReview {
  decision: BrandReviewDecision;
  reviewerUserId: string | null;
  reviewedAt: string | null;
}

export type BrandReviewState = Partial<Record<BrandCoreFieldPath, BrandFieldReview>>;

export interface BrandCoreDraftMapping {
  core: BrandCoreV1;
  evidence: BrandEvidenceItem[];
  reviewState: BrandReviewState;
  needsReview: BrandCoreFieldPath[];
}

export const BRAND_CORE_FIELD_PATHS: readonly BrandCoreFieldPath[] = [
  "summary.oneLine",
  "summary.description",
  "audiences",
  "valueProposition.primary",
  "valueProposition.differentiators",
  "valueProposition.proofPoints",
  "messaging.appeals",
  "messaging.tone",
  "messaging.preferredPhrases",
  "messaging.brandDirection",
  "messaging.priorityMessages",
];

const SOURCE_TYPES: readonly BrandEvidenceSource[] = [
  "owned_url",
  "text",
  "markdown",
  "pdf",
  "csv",
  "xlsx",
  "public_web",
  "analysis",
];
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function invalid(path: string): never {
  throw new Error(`brand_core_validation_failed:${path}`);
}

function object(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(path);
  return value as Record<string, unknown>;
}

function strictObject(value: unknown, keys: readonly string[], path: string): Record<string, unknown> {
  const result = object(value, path);
  if (Object.keys(result).some((key) => !keys.includes(key))) invalid(path);
  return result;
}

function text(
  value: unknown,
  path: string,
  options: { max?: number; allowEmpty?: boolean } = {},
): string {
  if (typeof value !== "string") invalid(path);
  const normalized = value.trim();
  if ((!options.allowEmpty && !normalized) || normalized.length > (options.max ?? 4_000)) invalid(path);
  return normalized;
}

function stringList(
  value: unknown,
  path: string,
  options: { maxItems?: number; maxLength?: number; allowEmpty?: boolean } = {},
): string[] {
  if (!Array.isArray(value) || value.length > (options.maxItems ?? 20)) invalid(path);
  if (!options.allowEmpty && value.length === 0) invalid(path);
  return value.map((item) => text(item, path, { max: options.maxLength ?? 500 }));
}

function httpsUrl(value: unknown, path: string): string {
  const normalized = text(value, path, { max: 2_048 });
  try {
    const parsed = new URL(normalized);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) invalid(path);
  } catch {
    invalid(path);
  }
  return normalized;
}

function nullableHttpsUrl(value: unknown, path: string): string | null {
  if (value === null || value === undefined || value === "") return null;
  return httpsUrl(value, path);
}

function parseBrandCore(value: unknown, approval: boolean): BrandCoreV1 {
  const canonicalKeys = [
    "companyOverview", "businessDescription", "primaryCategory", "subcategories",
    "primaryTarget", "differentiators", "coreAppeal",
  ] as const;
  const source = strictObject(
    value,
    ["contractVersion", ...canonicalKeys, "summary", "audiences", "valueProposition", "messaging"],
    "root",
  );
  if (source.contractVersion !== "brand-core.v1") invalid("contractVersion");
  const hasCanonical = canonicalKeys.some((key) => Object.prototype.hasOwnProperty.call(source, key));
  const requireLegacy = approval && !hasCanonical;

  const summary = strictObject(source.summary, ["oneLine", "description"], "summary");
  const audiences = Array.isArray(source.audiences) ? source.audiences : invalid("audiences");
  if (audiences.length > 10 || (requireLegacy && audiences.length === 0)) invalid("audiences");
  const parsedAudiences = audiences.map((item, index) => {
    const audience = strictObject(item, ["name", "problem", "desiredOutcome"], `audiences[${index}]`);
    return {
      name: text(audience.name, `audiences[${index}].name`, { max: 300, allowEmpty: !requireLegacy }),
      problem: text(audience.problem, `audiences[${index}].problem`, { allowEmpty: !requireLegacy }),
      desiredOutcome: text(audience.desiredOutcome, `audiences[${index}].desiredOutcome`, {
        allowEmpty: !requireLegacy,
      }),
    };
  });

  const valueProposition = strictObject(
    source.valueProposition,
    ["primary", "differentiators", "proofPoints"],
    "valueProposition",
  );
  const messaging = strictObject(
    source.messaging,
    ["appeals", "tone", "preferredPhrases", "brandDirection", "priorityMessages"],
    "messaging",
  );
  const parseCategory = (value: unknown, path: string, allowEmpty: boolean) => {
    const category = strictObject(value, ["code", "name"], path);
    return {
      code: category.code === null ? null : text(category.code, `${path}.code`, { max: 200 }),
      name: text(category.name, `${path}.name`, { max: 300, allowEmpty }),
    };
  };
  const legacyDifferentiators = stringList(
    valueProposition.differentiators,
    "valueProposition.differentiators",
    { allowEmpty: !requireLegacy },
  );
  const canonical = hasCanonical ? {
    companyOverview: text(source.companyOverview, "companyOverview", { allowEmpty: !approval }),
    businessDescription: text(source.businessDescription, "businessDescription", { allowEmpty: !approval }),
    primaryCategory: parseCategory(source.primaryCategory, "primaryCategory", !approval),
    subcategories: Array.isArray(source.subcategories)
      ? source.subcategories.map((item, index) => parseCategory(item, `subcategories[${index}]`, false))
      : invalid("subcategories"),
    primaryTarget: text(source.primaryTarget, "primaryTarget", { allowEmpty: !approval }),
    differentiators: stringList(source.differentiators, "differentiators", { allowEmpty: !approval }),
    coreAppeal: text(source.coreAppeal, "coreAppeal", { allowEmpty: !approval }),
  } : null;

  return {
    contractVersion: "brand-core.v1",
    ...(canonical ?? {}),
    summary: {
      oneLine: text(summary.oneLine, "summary.oneLine", { max: 300, allowEmpty: !requireLegacy }),
      description: text(summary.description, "summary.description", { allowEmpty: !requireLegacy }),
    },
    audiences: parsedAudiences,
    valueProposition: {
      primary: text(valueProposition.primary, "valueProposition.primary", { allowEmpty: !approval }),
      differentiators: legacyDifferentiators,
      proofPoints: stringList(valueProposition.proofPoints, "valueProposition.proofPoints", {
        allowEmpty: !requireLegacy,
      }),
    },
    messaging: {
      appeals: stringList(messaging.appeals, "messaging.appeals", { allowEmpty: !requireLegacy }),
      tone: stringList(messaging.tone, "messaging.tone", { allowEmpty: !requireLegacy }),
      preferredPhrases: stringList(messaging.preferredPhrases, "messaging.preferredPhrases", {
        allowEmpty: !requireLegacy,
      }),
      brandDirection: text(messaging.brandDirection, "messaging.brandDirection", {
        allowEmpty: !requireLegacy,
      }),
      priorityMessages: stringList(messaging.priorityMessages, "messaging.priorityMessages", {
        allowEmpty: !requireLegacy,
      }),
    },
  };
}

export function parseBrandCoreDraft(value: unknown): BrandCoreV1 {
  return parseBrandCore(value, false);
}

export function parseBrandCoreForApproval(value: unknown): BrandCoreV1 {
  return parseBrandCore(value, true);
}

export function parseBrandEvidence(value: unknown): BrandEvidenceItem[] {
  if (!Array.isArray(value) || value.length > 100) invalid("evidence");
  return value.map((item, index) => {
    const path = `evidence[${index}]`;
    const evidence = strictObject(
      item,
      ["fieldPath", "sourceType", "sourceId", "sourceUrl", "excerpt", "confidence"],
      path,
    );
    if (!BRAND_CORE_FIELD_PATHS.includes(evidence.fieldPath as BrandCoreFieldPath)) invalid(`${path}.fieldPath`);
    if (!SOURCE_TYPES.includes(evidence.sourceType as BrandEvidenceSource)) invalid(`${path}.sourceType`);
    if (
      evidence.confidence !== null
      && (typeof evidence.confidence !== "number"
        || !Number.isFinite(evidence.confidence)
        || evidence.confidence < 0
        || evidence.confidence > 1)
    ) {
      invalid(`${path}.confidence`);
    }
    return {
      fieldPath: evidence.fieldPath as BrandCoreFieldPath,
      sourceType: evidence.sourceType as BrandEvidenceSource,
      sourceId: text(evidence.sourceId, `${path}.sourceId`, { max: 200 }),
      sourceUrl: nullableHttpsUrl(evidence.sourceUrl, `${path}.sourceUrl`),
      excerpt: text(evidence.excerpt, `${path}.excerpt`, { max: 2_000 }),
      confidence: evidence.confidence as number | null,
    };
  });
}

function reviewDecision(value: unknown, path: string): BrandReviewDecision {
  if (value !== "ai_suggested" && value !== "user_edited" && value !== "approved") invalid(path);
  return value;
}

function nullableText(value: unknown, path: string, max = 200): string | null {
  if (value === null || value === undefined) return null;
  return text(value, path, { max });
}

function nullableDate(value: unknown, path: string): string | null {
  const normalized = nullableText(value, path, 100);
  if (normalized === null) return null;
  const timestamp = Date.parse(normalized);
  if (!Number.isFinite(timestamp)) invalid(path);
  return new Date(timestamp).toISOString();
}

export function parseBrandReviewState(value: unknown): BrandReviewState {
  const source = object(value, "reviewState");
  const result: BrandReviewState = {};
  for (const [fieldPath, rawReview] of Object.entries(source)) {
    if (!BRAND_CORE_FIELD_PATHS.includes(fieldPath as BrandCoreFieldPath)) invalid(`reviewState.${fieldPath}`);
    const review = strictObject(
      rawReview,
      ["decision", "reviewerUserId", "reviewedAt"],
      `reviewState.${fieldPath}`,
    );
    const decision = reviewDecision(review.decision, `reviewState.${fieldPath}.decision`);
    const reviewerUserId = nullableText(
      review.reviewerUserId,
      `reviewState.${fieldPath}.reviewerUserId`,
    );
    const reviewedAt = nullableDate(review.reviewedAt, `reviewState.${fieldPath}.reviewedAt`);
    if (decision === "ai_suggested" && (reviewerUserId !== null || reviewedAt !== null)) {
      invalid(`reviewState.${fieldPath}`);
    }
    if (decision !== "ai_suggested" && (!reviewerUserId || !reviewedAt)) {
      invalid(`reviewState.${fieldPath}`);
    }
    result[fieldPath as BrandCoreFieldPath] = { decision, reviewerUserId, reviewedAt };
  }
  return result;
}

export function transitionBrandReviewState(
  previous: BrandFieldReview,
  next: BrandFieldReview,
): BrandFieldReview {
  const ranks: Record<BrandReviewDecision, number> = {
    ai_suggested: 0,
    user_edited: 1,
    approved: 2,
  };
  if (ranks[next.decision] < ranks[previous.decision]) {
    throw new Error("brand_core_review_transition_invalid");
  }
  return next;
}

export function parseBrandRules(value: unknown): BrandRulesV1 {
  const source = strictObject(value, [
    "contractVersion",
    "requiredPhrases",
    "forbiddenPhrases",
    "exaggerationRules",
    "ctaRules",
    "channelRules",
    "designRules",
    "autoApprovalRules",
  ], "rules");
  if (source.contractVersion !== "brand-rules.v1") invalid("rules.contractVersion");
  const ctaRules = strictObject(source.ctaRules, ["defaultCta", "allowed"], "rules.ctaRules");
  const channelRules = object(source.channelRules, "rules.channelRules");
  if (Object.keys(channelRules).length > 20) invalid("rules.channelRules");
  const parsedChannelRules: Record<string, string[]> = {};
  for (const [channel, rules] of Object.entries(channelRules)) {
    const normalizedChannel = text(channel, "rules.channelRules", { max: 50 });
    parsedChannelRules[normalizedChannel] = stringList(rules, `rules.channelRules.${channel}`, {
      allowEmpty: true,
    });
  }
  const designRules = strictObject(source.designRules, [
    "colors",
    "fonts",
    "notes",
    "referenceImages",
  ], "rules.designRules");
  const autoApprovalRules = strictObject(
    source.autoApprovalRules,
    ["enabled", "conditions"],
    "rules.autoApprovalRules",
  );
  if (typeof autoApprovalRules.enabled !== "boolean") invalid("rules.autoApprovalRules.enabled");
  return {
    contractVersion: "brand-rules.v1",
    requiredPhrases: stringList(source.requiredPhrases, "rules.requiredPhrases", { allowEmpty: true }),
    forbiddenPhrases: stringList(source.forbiddenPhrases, "rules.forbiddenPhrases", { allowEmpty: true }),
    exaggerationRules: stringList(source.exaggerationRules, "rules.exaggerationRules", {
      allowEmpty: true,
    }),
    ctaRules: {
      defaultCta: text(ctaRules.defaultCta, "rules.ctaRules.defaultCta", {
        max: 500,
        allowEmpty: true,
      }),
      allowed: stringList(ctaRules.allowed, "rules.ctaRules.allowed", { allowEmpty: true }),
    },
    channelRules: parsedChannelRules,
    designRules: (() => {
      const rawReferenceImages = designRules.referenceImages ?? [];
      if (!Array.isArray(rawReferenceImages) || rawReferenceImages.length > 5) {
        invalid("rules.designRules.referenceImages");
      }
      const seenIds = new Set<string>();
      const referenceImages = rawReferenceImages.map((rawImage, index) => {
        const path = `rules.designRules.referenceImages[${index}]`;
        const image = strictObject(
          rawImage,
          ["referenceItemId", "description", "tags"],
          path,
        );
        const referenceItemId = text(image.referenceItemId, `${path}.referenceItemId`, { max: 36 });
        if (!UUID_PATTERN.test(referenceItemId) || seenIds.has(referenceItemId)) {
          invalid("rules.designRules.referenceImages");
        }
        seenIds.add(referenceItemId);
        return {
          referenceItemId,
          description: text(image.description, `${path}.description`, {
            max: 240,
            allowEmpty: true,
          }),
          tags: stringList(image.tags, `${path}.tags`, {
            maxItems: 10,
            maxLength: 40,
            allowEmpty: true,
          }),
        };
      });
      return {
        colors: stringList(designRules.colors, "rules.designRules.colors", { allowEmpty: true }),
        fonts: stringList(designRules.fonts, "rules.designRules.fonts", { allowEmpty: true }),
        notes: stringList(designRules.notes, "rules.designRules.notes", { allowEmpty: true }),
        referenceImages,
      };
    })(),
    autoApprovalRules: {
      enabled: autoApprovalRules.enabled,
      conditions: stringList(autoApprovalRules.conditions, "rules.autoApprovalRules.conditions", {
        allowEmpty: true,
      }),
    },
  };
}

function analysisFieldToCorePath(field: string): BrandCoreFieldPath | null {
  const mapping: Record<string, BrandCoreFieldPath> = {
    companyOverview: "summary.description",
    businessDescription: "summary.description",
    primaryTarget: "audiences",
    differentiators: "valueProposition.differentiators",
    coreAppeal: "valueProposition.primary",
  };
  return mapping[field] ?? null;
}

function sourceTypeFor(sourceId: string, sourceUrl: string | null): BrandEvidenceSource {
  if (sourceId === "owned-url" || sourceId.startsWith("owned-url:")) return "owned_url";
  if (sourceId === "public-web" || sourceId.startsWith("public-web:")) return "public_web";
  if (sourceUrl) return "analysis";
  return "analysis";
}

export function mapAnalysisToBrandCoreDraft(
  analysis: BrandIntelligenceResultV1,
): BrandCoreDraftMapping {
  const core = parseBrandCoreDraft({
    contractVersion: "brand-core.v1",
    companyOverview: analysis.companyOverview,
    businessDescription: analysis.businessDescription,
    primaryCategory: analysis.primaryCategory,
    subcategories: analysis.subcategories,
    primaryTarget: analysis.primaryTarget,
    differentiators: analysis.differentiators ? [analysis.differentiators] : [],
    coreAppeal: analysis.coreAppeal,
    summary: {
      oneLine: analysis.coreAppeal,
      description: analysis.businessDescription || analysis.companyOverview,
    },
    audiences: analysis.primaryTarget
      ? [{ name: analysis.primaryTarget, problem: "", desiredOutcome: "" }]
      : [],
    valueProposition: {
      primary: analysis.coreAppeal,
      differentiators: analysis.differentiators ? [analysis.differentiators] : [],
      proofPoints: [],
    },
    messaging: {
      appeals: analysis.coreAppeal ? [analysis.coreAppeal] : [],
      tone: [],
      preferredPhrases: [],
      brandDirection: analysis.differentiators,
      priorityMessages: [],
    },
  });

  const evidence = parseBrandEvidence(
    analysis.evidence.flatMap((item) => {
      const fieldPath = analysisFieldToCorePath(item.field);
      return fieldPath
        ? [{
            fieldPath,
            sourceType: sourceTypeFor(item.sourceId, item.sourceUrl),
            sourceId: item.sourceId,
            sourceUrl: item.sourceUrl,
            excerpt: item.claim,
            confidence: null,
          }]
        : [];
    }),
  );

  const needsReview = BRAND_CORE_FIELD_PATHS.filter((path) => {
    if (path === "summary.oneLine") return !core.summary.oneLine;
    if (path === "summary.description") return !core.summary.description;
    if (path === "audiences") {
      return core.audiences.length === 0
        || core.audiences.some((audience) => !audience.problem || !audience.desiredOutcome);
    }
    if (path === "valueProposition.primary") return !core.valueProposition.primary;
    if (path === "valueProposition.differentiators") return core.valueProposition.differentiators.length === 0;
    if (path === "valueProposition.proofPoints") return core.valueProposition.proofPoints.length === 0;
    if (path === "messaging.appeals") return core.messaging.appeals.length === 0;
    if (path === "messaging.tone") return core.messaging.tone.length === 0;
    if (path === "messaging.preferredPhrases") return core.messaging.preferredPhrases.length === 0;
    if (path === "messaging.brandDirection") return !core.messaging.brandDirection;
    return core.messaging.priorityMessages.length === 0;
  });

  const reviewState = Object.fromEntries(
    BRAND_CORE_FIELD_PATHS.map((fieldPath) => [
      fieldPath,
      { decision: "ai_suggested", reviewerUserId: null, reviewedAt: null },
    ]),
  ) as BrandReviewState;

  return { core, evidence, reviewState, needsReview };
}
