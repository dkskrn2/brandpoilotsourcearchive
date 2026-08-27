import type { ContentGenerationInputV3 } from "./generation.js";
import type { FrozenManualVisualSelection } from "./manualVisualSelection.js";

export function projectEditorialProductFacts(input: ContentGenerationInputV3) {
  if (input.product === null) return null;
  return {
    kind: input.product.kind,
    name: input.product.name,
    description: input.product.description,
    features: input.product.features,
    benefits: input.product.benefits,
    cautions: input.product.cautions,
    evergreenPurchaseInfo: input.product.evergreenPurchaseInfo,
    availableImages: input.product.images.map(({ assetId, role }) => ({ assetId, role })),
  };
}

export function projectEditorialVisualInputs(input: ContentGenerationInputV3) {
  return {
    explicitUserDirection: input.userImageInstruction,
    brandStyleImages: input.references.brandStyleImages.map(({ referenceItemId, description, tags }) => ({
      referenceItemId,
      description,
      tags,
    })),
    avatarStyleImageId: input.references.avatarStyleImageId,
    attachments: (input.references.attachments ?? []).map(({ id, role, fileName }) => ({ id, role, fileName })),
  };
}

export function projectManualEditorialProductFacts(selection: FrozenManualVisualSelection) {
  if (selection.product === null) return null;
  return {
    kind: selection.product.kind,
    name: selection.product.name,
    description: selection.product.description,
    features: selection.product.features,
    benefits: selection.product.benefits,
    cautions: selection.product.cautions,
    evergreenPurchaseInfo: selection.product.evergreenPurchaseInfo,
    availableImages: selection.product.images.map(({ assetId, role }) => ({ assetId, role })),
  };
}

export function projectManualEditorialVisualInputs(
  input: ContentGenerationInputV3,
  selection: FrozenManualVisualSelection,
) {
  const shared = {
    explicitUserDirection: input.userImageInstruction,
    attachments: (input.references.attachments ?? []).map(({ id, role, fileName }) => ({ id, role, fileName })),
  };
  if (selection.contractVersion === "manual-visual-selection-frozen.v1") {
    return { ...shared, stylePreset: selection.stylePreset, avatar: selection.avatar };
  }
  return {
    ...shared,
    visualPreset: selection.preset ? {
      name: selection.preset.name,
      designStyle: selection.preset.designStyle.analysis,
      hasAvatar: selection.preset.avatar !== null,
    } : null,
  };
}
