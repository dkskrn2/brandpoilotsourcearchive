import type { ContentGenerationInputV3 } from "./generation.js";

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
    attachments: input.references.attachments.map(({ id, role, fileName }) => ({ id, role, fileName })),
  };
}
