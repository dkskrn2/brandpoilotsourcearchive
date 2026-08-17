import { buildAssetLibraryPath, validateAssetLibraryUpload, type AssetLibraryUploadKind } from "./assetLibraryUpload.js";
import type { AssetUploadInput } from "./assetLibraryContracts.js";

export type ManualVisualAssetUploadKind = Extract<AssetLibraryUploadKind, "product">;

export function validateManualVisualAssetUpload(kind: ManualVisualAssetUploadKind, input: AssetUploadInput): AssetUploadInput {
  return validateAssetLibraryUpload(kind, input);
}

export function buildManualVisualAssetPath(input: {
  kind: ManualVisualAssetUploadKind;
  brandId: string;
  ownerId: string;
  sessionId: string;
  checksum: string;
  fileName: string;
}): string {
  if (input.kind !== "product") throw new Error("asset_library_upload_scope_invalid");
  return buildAssetLibraryPath({
    ...input,
    productId: input.ownerId,
  });
}
