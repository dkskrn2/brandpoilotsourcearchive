import { describe, expect, it, vi } from "vitest";
import { createBrandIntelligenceProvider } from "./brandIntelligenceProvider.js";

const scope = { workspaceId: "workspace-1", brandId: "brand-1" };
const profile = {
  contractVersion: "brand-intelligence-result.v1" as const,
  companyOverview: "브랜드 개요",
  businessDescription: "콘텐츠 운영 서비스",
  primaryCategory: { code: "marketing", name: "마케팅" },
  subcategories: [{ code: "content", name: "콘텐츠 마케팅" }],
  primaryTarget: "브랜드 담당자",
  differentiators: "확정한 자사 정보를 재사용",
  coreAppeal: "반복 입력 없이 일관된 콘텐츠 운영",
  competitors: [],
  evidence: [],
  sourceGaps: [],
};

describe("brand intelligence provider", () => {
  it("returns only a confirmed effective result", async () => {
    const getCurrentBrandIntelligence = vi.fn(async () => ({
      id: "analysis-1",
      confirmedAt: "2026-07-21T00:00:00.000Z",
      effectiveResult: profile,
    }));
    const provider = createBrandIntelligenceProvider({ getCurrentBrandIntelligence } as never);

    await expect(provider.getConfirmed(scope)).resolves.toEqual({
      versionId: "analysis-1",
      confirmedAt: "2026-07-21T00:00:00.000Z",
      profile,
    });
    expect(getCurrentBrandIntelligence).toHaveBeenCalledWith(scope);
  });

  it("rejects consumers that require an unconfirmed profile", async () => {
    const provider = createBrandIntelligenceProvider({
      getCurrentBrandIntelligence: vi.fn(async () => null),
    } as never);

    await expect(provider.getConfirmed(scope)).resolves.toBeNull();
    await expect(provider.requireConfirmed(scope)).rejects.toThrow("brand_intelligence_required");
  });
});
