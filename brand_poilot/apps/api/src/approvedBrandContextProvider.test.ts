import { describe, expect, it, vi } from "vitest";
import { createApprovedBrandContextProvider } from "./approvedBrandContextProvider.js";
import type { BrandCoreRepository, BrandCoreVersion, BrandRuleSet } from "./brandCoreRepository.js";

const scope = {
  workspaceId: "10000000-0000-4000-8000-000000000001",
  brandId: "20000000-0000-4000-8000-000000000002",
};

const core = {
  id: "core-1",
  ...scope,
  sourceAnalysisId: null,
  version: 1,
  status: "approved",
  evidence: [],
  reviewState: {},
  createdBy: "user",
  createdByUserId: "user-1",
  approvedByUserId: "user-1",
  approvedAt: "2026-07-26T00:00:00.000Z",
  createdAt: "2026-07-26T00:00:00.000Z",
  updatedAt: "2026-07-26T00:00:00.000Z",
  core: {
    contractVersion: "brand-core.v1",
    summary: { oneLine: "한 줄", description: "설명" },
    audiences: [{ name: "담당자", problem: "시간 부족", desiredOutcome: "일관된 운영" }],
    valueProposition: { primary: "업무 절감", differentiators: ["근거"], proofPoints: ["검토"] },
    messaging: {
      appeals: ["절감"],
      tone: ["명확함"],
      preferredPhrases: ["근거를 바탕으로"],
      brandDirection: "과장 없음",
      priorityMessages: ["승인 정보"],
    },
  },
} as BrandCoreVersion;

const rules = {
  id: "rules-1",
  ...scope,
  version: 1,
  status: "approved",
  createdBy: "user",
  createdByUserId: "user-1",
  approvedByUserId: "user-1",
  approvedAt: "2026-07-26T00:00:00.000Z",
  createdAt: "2026-07-26T00:00:00.000Z",
  updatedAt: "2026-07-26T00:00:00.000Z",
  rules: {
    contractVersion: "brand-rules.v1",
    requiredPhrases: [],
    forbiddenPhrases: ["무조건"],
    exaggerationRules: [],
    ctaRules: { defaultCta: "", allowed: [] },
    channelRules: {},
    designRules: { colors: [], fonts: [], notes: [], referenceImages: [] },
    autoApprovalRules: { enabled: false, conditions: [] },
  },
  } as unknown as BrandRuleSet;

function repository(activeCore: BrandCoreVersion | null, activeRules: BrandRuleSet | null) {
  return {
    getActive: vi.fn().mockResolvedValue(activeCore),
    getActiveRules: vi.fn().mockResolvedValue(activeRules),
  } as unknown as BrandCoreRepository;
}

describe("approved brand context provider", () => {
  it("returns only active approved core and rules", async () => {
    const provider = createApprovedBrandContextProvider(repository(core, rules));
    await expect(provider.requireApproved(scope)).resolves.toEqual({
      coreVersionId: "core-1",
      rulesVersionId: "rules-1",
      core: core.core,
      rules: rules.rules,
    });
  });

  it("does not fall back to legacy profile or analysis data", async () => {
    const provider = createApprovedBrandContextProvider(repository(null, null));
    await expect(provider.requireApproved(scope)).rejects.toThrow("approved_brand_context_required");
  });
});
