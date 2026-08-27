import { apiClient } from "../../lib/apiClient";
import type {
  BrandCenterSummary,
  BrandCore,
  BrandCoreVersion,
  BrandCoreWorkspace,
  BrandEvidence,
  BrandReviewState,
  BrandRules,
  BrandRulesWorkspace,
  BrandRuleSet,
} from "./types";

type Client = Pick<ReturnType<typeof apiClient>, "requestJson">;

function invalidRulesResponse(): never {
  throw new Error("brand_rules_response_invalid");
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalidRulesResponse();
  return value as Record<string, unknown>;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) invalidRulesResponse();
  return [...value] as string[];
}

function parseRules(value: unknown): BrandRules {
  const source = record(value);
  if (source.contractVersion !== "brand-rules.v2") invalidRulesResponse();
  const cta = record(source.ctaRules);
  if (typeof cta.defaultCta !== "string") invalidRulesResponse();
  const channels = record(source.channelRules);
  const channelRules = Object.fromEntries(Object.entries(channels).map(([channel, rules]) => [channel, stringArray(rules)]));
  const approval = record(source.autoApprovalRules);
  if (typeof approval.enabled !== "boolean") invalidRulesResponse();
  return {
    contractVersion: "brand-rules.v2",
    requiredPhrases: stringArray(source.requiredPhrases),
    forbiddenPhrases: stringArray(source.forbiddenPhrases),
    exaggerationRules: stringArray(source.exaggerationRules),
    ctaRules: { defaultCta: cta.defaultCta, allowed: stringArray(cta.allowed) },
    channelRules,
    autoApprovalRules: { enabled: approval.enabled, conditions: stringArray(approval.conditions) },
  };
}

function parseRuleSet(value: unknown): BrandRuleSet {
  const source = record(value);
  if (
    typeof source.id !== "string"
    || !Number.isSafeInteger(source.version)
    || (source.status !== "draft" && source.status !== "approved" && source.status !== "superseded")
    || (source.approvedAt !== null && typeof source.approvedAt !== "string")
    || typeof source.updatedAt !== "string"
  ) invalidRulesResponse();
  return {
    id: source.id,
    version: source.version as number,
    status: source.status,
    rules: parseRules(source.rules),
    approvedAt: source.approvedAt,
    updatedAt: source.updatedAt,
  };
}

function parseRulesWorkspace(value: unknown): BrandRulesWorkspace {
  const source = record(value);
  if (!Array.isArray(source.versions)) invalidRulesResponse();
  return {
    active: source.active === null ? null : parseRuleSet(source.active),
    draft: source.draft === null ? null : parseRuleSet(source.draft),
    versions: source.versions.map(parseRuleSet),
  };
}

export function createBrandCenterGateway(client: Client = apiClient()) {
  return {
    getSummary(brandId: string) {
      return client.requestJson<BrandCenterSummary>(`/brands/${brandId}/brand-center`, {
        method: "GET",
      });
    },
    getCore(brandId: string) {
      return client.requestJson<BrandCoreWorkspace>(`/brands/${brandId}/brand-core`, {
        method: "GET",
      });
    },
    createCoreDraft(brandId: string, input: {
      core?: BrandCore;
      evidence?: BrandEvidence[];
      reviewState?: BrandReviewState;
      sourceAnalysisId?: string | null;
    }) {
      return client.requestJson<BrandCoreVersion>(`/brands/${brandId}/brand-core/drafts`, {
        method: "POST",
        body: JSON.stringify(input),
      });
    },
    updateCoreDraft(brandId: string, versionId: string, input: {
      core: BrandCore;
      evidence: BrandEvidence[];
      reviewState: BrandReviewState;
      expectedUpdatedAt: string;
    }) {
      return client.requestJson<BrandCoreVersion>(
        `/brands/${brandId}/brand-core/drafts/${versionId}`,
        {
          method: "PATCH",
          body: JSON.stringify(input),
        },
      );
    },
    approveCoreDraft(brandId: string, versionId: string, expectedUpdatedAt: string) {
      return client.requestJson<BrandCoreVersion>(
        `/brands/${brandId}/brand-core/drafts/${versionId}/approve`,
        {
          method: "POST",
          body: JSON.stringify({ expectedUpdatedAt }),
        },
      );
    },
    async getRules(brandId: string) {
      const value = await client.requestJson<unknown>(`/brands/${brandId}/brand-rules`, {
        method: "GET",
      });
      return parseRulesWorkspace(value);
    },
    saveRuleDraft(brandId: string, rules: BrandRules) {
      return client.requestJson<BrandRuleSet>(`/brands/${brandId}/brand-rules/draft`, {
        method: "PUT",
        body: JSON.stringify(rules),
      });
    },
    approveRules(brandId: string, ruleSetId: string) {
      return client.requestJson<BrandRuleSet>(
        `/brands/${brandId}/brand-rules/${ruleSetId}/approve`,
        { method: "POST" },
      );
    },
  };
}

export const brandCenterGateway = createBrandCenterGateway();
