import type {
  BrandIntelligenceResult,
  BrandIntelligenceResultV1,
} from "./brandIntelligenceContracts.js";
import { toBrandIntelligenceV1Compatibility } from "./brandIntelligenceV2Contracts.js";
import type { BrandAnalysisScope, BrandIntelligenceRepository } from "./brandIntelligenceRepository.js";

export interface ConfirmedBrandIntelligence {
  versionId: string;
  confirmedAt: string;
  profile: BrandIntelligenceResultV1;
  result?: BrandIntelligenceResult;
}

export function createBrandIntelligenceProvider(repository: BrandIntelligenceRepository) {
  const getConfirmed = async (input: BrandAnalysisScope): Promise<ConfirmedBrandIntelligence | null> => {
    const current = await repository.getCurrentBrandIntelligence(input);
    if (!current?.effectiveResult || !current.confirmedAt) return null;
    return {
      versionId: current.id,
      confirmedAt: current.confirmedAt,
      profile: toBrandIntelligenceV1Compatibility(current.effectiveResult),
      result: current.effectiveResult,
    };
  };
  return {
    getConfirmed,
    getOnboardingContent: repository.getOnboardingContent.bind(repository),
    async requireConfirmed(input: BrandAnalysisScope): Promise<ConfirmedBrandIntelligence> {
      const current = await getConfirmed(input);
      if (!current) throw new Error("brand_intelligence_required");
      return current;
    },
  };
}
