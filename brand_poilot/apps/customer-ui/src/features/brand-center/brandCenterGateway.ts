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
    getRules(brandId: string) {
      return client.requestJson<BrandRulesWorkspace>(`/brands/${brandId}/brand-rules`, {
        method: "GET",
      });
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
