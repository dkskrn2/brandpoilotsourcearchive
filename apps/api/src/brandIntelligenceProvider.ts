import {
  toBrandIntelligenceCommonView,
  type BrandIntelligenceCommonView,
} from "./brandIntelligenceContracts.js";
import type { BrandAnalysisScope, BrandIntelligenceRepository } from "./brandIntelligenceRepository.js";

export interface ConfirmedBrandProfile {
  contractVersion: "brand-intelligence-result.v1" | "brand-intelligence-result.v2";
  companyName?: string | null;
  companyOverview: string;
  businessDescription: string;
  primaryCategory: { code: string | null; name: string };
  subcategories: Array<{ code: string | null; name: string }>;
  primaryTarget: string;
  differentiators: string | string[];
  coreAppeal: string;
  offerings?: BrandIntelligenceCommonView["offerings"];
  competitors: Array<{ name: string; description: string; sourceUrls: string[] }>;
  sourceGaps: string[];
}

export interface ConfirmedBrandIntelligence {
  versionId: string;
  confirmedAt: string;
  profile: ConfirmedBrandProfile;
}

export function createBrandIntelligenceProvider(repository: BrandIntelligenceRepository) {
  const getConfirmed = async (input: BrandAnalysisScope): Promise<ConfirmedBrandIntelligence | null> => {
    const current = await repository.getCurrentBrandIntelligence(input);
    if (!current?.effectiveResult || !current.confirmedAt) return null;
    const company = await repository.getBrandCompanyName?.(input) ?? null;
    const profile = toBrandIntelligenceCommonView(
      current.effectiveResult,
      company?.state === "confirmed" ? company.name : null,
    );
    if (!profile.companyOverview || !profile.businessDescription
      || !profile.primaryCategory || !profile.primaryTarget || !profile.coreAppeal) {
      throw new Error("brand_intelligence_confirmed_profile_invalid");
    }
    return {
      versionId: current.id,
      confirmedAt: current.confirmedAt,
      profile: profile as ConfirmedBrandProfile,
    };
  };
  return {
    getConfirmed,
    async requireConfirmed(input: BrandAnalysisScope): Promise<ConfirmedBrandIntelligence> {
      const current = await getConfirmed(input);
      if (!current) throw new Error("brand_intelligence_required");
      return current;
    },
  };
}
