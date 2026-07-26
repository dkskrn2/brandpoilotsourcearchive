import type { BrandCoreV1, BrandRulesV1 } from "./brandCoreContracts.js";
import type { BrandCoreRepository, BrandScope } from "./brandCoreRepository.js";

export interface ApprovedBrandContext {
  coreVersionId: string;
  rulesVersionId: string | null;
  core: BrandCoreV1;
  rules: BrandRulesV1 | null;
}

export function createApprovedBrandContextProvider(repository: BrandCoreRepository) {
  const getApproved = async (scope: BrandScope): Promise<ApprovedBrandContext | null> => {
    const [core, rules] = await Promise.all([
      repository.getActive(scope),
      repository.getActiveRules(scope),
    ]);
    if (!core || core.status !== "approved") return null;
    return {
      coreVersionId: core.id,
      rulesVersionId: rules?.status === "approved" ? rules.id : null,
      core: core.core,
      rules: rules?.status === "approved" ? rules.rules : null,
    };
  };

  return {
    getApproved,
    async requireApproved(scope: BrandScope): Promise<ApprovedBrandContext> {
      const context = await getApproved(scope);
      if (!context) throw new Error("approved_brand_context_required");
      return context;
    },
  };
}
