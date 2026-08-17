import { describe, expect, it, vi } from "vitest";
import {
  freezeManualVisualSelection,
  materializeFrozenManualVisualAssets,
  saveManualVisualSelection,
} from "./aiContentManualVisualSelection.js";

const ids = {
  workspace: "10000000-0000-4000-8000-000000000001",
  brand: "10000000-0000-4000-8000-000000000002",
  generation: "10000000-0000-4000-8000-000000000003",
  product: "10000000-0000-4000-8000-000000000004",
  version: "10000000-0000-4000-8000-000000000005",
  productImage: "10000000-0000-4000-8000-000000000006",
  preset: "10000000-0000-4000-8000-000000000007",
  reference: "10000000-0000-4000-8000-000000000008",
  reference2: "10000000-0000-4000-8000-00000000000b",
  avatar: "10000000-0000-4000-8000-000000000009",
  avatarImage: "10000000-0000-4000-8000-00000000000a",
};

const scope = { workspaceId: ids.workspace, brandId: ids.brand, generationId: ids.generation };
const selection = {
  contractVersion: "manual-visual-selection.v1" as const,
  product: { productServiceId: ids.product, versionId: ids.version },
  stylePreset: { presetId: ids.preset, revision: 3 },
  avatar: { avatarId: ids.avatar, revision: 2 },
};

function client(options: { avatarRevision?: number; partialPresetReference?: boolean } = {}) {
  let stored: Record<string, unknown> | null = null;
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    if (sql.includes("from product_services item")) return { rows: [{
      id: ids.product, kind: "product", display_name: "차 세트", status: "active",
      active_version_id: ids.version, version_id: ids.version, version_status: "approved",
      profile_json: {
        contractVersion: "product-service.v1", name: "차 세트", kind: "product",
        description: "온도별 차 맛을 안내합니다.", features: ["세 종류"], benefits: ["선택 도움"],
        cautions: [], audiences: [], appealsByTarget: {}, evergreenPurchaseInfo: "상시 판매", sourceUrls: [],
      },
    }], rowCount: 1 };
    if (sql.includes("from product_service_assets")) return { rows: [{
      id: ids.productImage, role: "hero", position: 1,
    }], rowCount: 1 };
    if (sql.includes("from brand_style_presets")) return { rows: [{
      id: ids.preset, revision: 3, name: "에디토리얼", description: "선명한 정보 카드",
      visual_tokens_json: { colors: ["red", "white"], fonts: ["sans"], notes: ["high contrast"] },
      status: "active",
    }], rowCount: 1 };
    if (sql.includes("from brand_style_preset_references")) {
      if (options.partialPresetReference && sql.includes("left join reference_items")) return { rows: [
        { reference_item_id: ids.reference, available: true },
        { reference_item_id: ids.reference2, available: false },
      ], rowCount: 2 };
      return { rows: [{ reference_item_id: ids.reference, available: true }], rowCount: 1 };
    }
    if (sql.includes("from brand_avatars")) return { rows: [{
      id: ids.avatar, revision: options.avatarRevision ?? 2, name: "브랜드 모델",
      description: "차를 설명하는 인물", status: "active",
    }], rowCount: 1 };
    if (sql.includes("from brand_avatar_images")) return { rows: [{
      id: ids.avatarImage, position: 1, is_representative: true,
      checksum: "a".repeat(64), mime_type: "image/png", storage_path: "avatar.png",
    }], rowCount: 1 };
    if (sql.startsWith("insert into manual_ai_content_visual_selections")) {
      stored = {
        generation_id: ids.generation, selection_json: JSON.parse(String(params[10])),
        selection_sha256: params[11], frozen_json: null, frozen_sha256: null,
      };
      return { rows: [stored], rowCount: 1 };
    }
    if (sql.includes("from manual_ai_content_visual_selections") && sql.includes("for update")) {
      return { rows: stored ? [stored] : [], rowCount: stored ? 1 : 0 };
    }
    if (sql.startsWith("update manual_ai_content_visual_selections")) {
      stored = { ...stored, frozen_json: JSON.parse(String(params[3])), frozen_sha256: params[4] };
      return { rows: [stored], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  });
  return { query };
}

describe("manual visual selection persistence", () => {
  it("validates tenant-owned revisions, stores the selection, and freezes product text plus optional images", async () => {
    const database = client();
    await saveManualVisualSelection(database, scope, selection);
    const frozen = await freezeManualVisualSelection(database, scope);
    expect(frozen).toMatchObject({
      contractVersion: "manual-visual-selection-frozen.v1",
      product: { name: "차 세트", description: "온도별 차 맛을 안내합니다.", images: [{ assetId: ids.productImage, role: "hero", position: 1 }] },
      stylePreset: { presetId: ids.preset, revision: 3, referenceItemIds: [ids.reference] },
      avatar: { avatarId: ids.avatar, revision: 2, imageAssetIds: [ids.avatarImage] },
    });
    expect(database.query.mock.calls.some(([sql]) => String(sql).startsWith("update manual_ai_content_visual_selections"))).toBe(true);
  });

  it("rejects an avatar revision changed after the user selected it", async () => {
    const database = client({ avatarRevision: 3 });
    await expect(saveManualVisualSelection(database, scope, selection)).rejects.toThrow("manual_visual_selection_stale");
  });

  it("rejects a preset revision when any linked reference has become unavailable", async () => {
    const database = client({ partialPresetReference: true });
    await expect(saveManualVisualSelection(database, scope, selection)).rejects.toThrow("manual_visual_selection_unavailable");
  });

  it("materializes only the selected product, preset references, and avatar images for render input", async () => {
    const database = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("from product_service_assets asset")) return { rows: [{
          id: ids.productImage, role: "hero", position: 1,
          storage_url: "https://blob.example/product.png", storage_path: "products/product.png",
          mime_type: "image/png", checksum: "b".repeat(64),
        }], rowCount: 1 };
        if (sql.includes("from unnest($1::uuid[])") && sql.includes("reference_items item")) return { rows: [{
          reference_item_id: ids.reference, title: "에디토리얼 참고",
          storage_url: "https://blob.example/style.png", storage_path: "styles/style.png",
          mime_type: "image/png", checksum: "c".repeat(64),
        }], rowCount: 1 };
        if (sql.includes("from brand_avatar_images image")) return { rows: [{
          id: ids.avatarImage, position: 1, is_representative: true,
          storage_url: "https://blob.example/avatar.png", storage_path: "avatars/avatar.png",
          mime_type: "image/png", checksum: "d".repeat(64),
        }], rowCount: 1 };
        return { rows: [], rowCount: 0 };
      }),
    };
    const frozen = {
      contractVersion: "manual-visual-selection-frozen.v1" as const,
      product: {
        productServiceId: ids.product, versionId: ids.version, kind: "product" as const,
        name: "차 세트", description: "온도별 차 맛을 안내합니다.", features: ["세 종류"],
        benefits: ["선택 도움"], cautions: [], evergreenPurchaseInfo: "상시 판매",
        images: [{ assetId: ids.productImage, role: "hero" as const, position: 1 }],
      },
      stylePreset: {
        presetId: ids.preset, revision: 3, name: "에디토리얼", description: "선명한 정보 카드",
        visualTokens: { colors: ["red", "white"], fonts: ["sans"], notes: ["high contrast"] },
        referenceItemIds: [ids.reference],
      },
      avatar: {
        avatarId: ids.avatar, revision: 2, name: "브랜드 모델", description: "차를 설명하는 인물",
        imageAssetIds: [ids.avatarImage], objectSha256: "a".repeat(64),
      },
    };

    await expect(materializeFrozenManualVisualAssets(database, scope, frozen)).resolves.toEqual({
      product: {
        id: ids.product, versionId: ids.version, kind: "product", name: "차 세트",
        description: "온도별 차 맛을 안내합니다.", features: ["세 종류"], benefits: ["선택 도움"],
        cautions: [], evergreenPurchaseInfo: "상시 판매",
        images: [{
          assetId: ids.productImage, role: "hero", storageUrl: "https://blob.example/product.png",
          storagePath: "products/product.png", mimeType: "image/png", checksum: "b".repeat(64),
        }],
      },
      brandStyleImages: [{
        referenceItemId: ids.reference, description: "에디토리얼 참고 — 선명한 정보 카드",
        tags: ["style-preset"], storageUrl: "https://blob.example/style.png",
        storagePath: "styles/style.png", mimeType: "image/png", checksum: "c".repeat(64),
      }, {
        referenceItemId: ids.avatarImage, description: "브랜드 모델 — 차를 설명하는 인물",
        tags: ["avatar"], storageUrl: "https://blob.example/avatar.png",
        storagePath: "avatars/avatar.png", mimeType: "image/png", checksum: "d".repeat(64),
      }],
      avatarStyleImageId: ids.avatarImage,
    });
  });
});
