import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { createManualVisualAssetsRepository } from "./manualVisualAssetsRepository.js";

describe("manual visual assets repository", () => {
  it("exposes tenant-scoped preset operations without reading legacy design rules", () => {
    expect(typeof createManualVisualAssetsRepository).toBe("function");
    const source = readFileSync(new URL("./manualVisualAssetsRepository.ts", import.meta.url), "utf8");
    expect(source).toContain("brand_style_preset_references");
    expect(source).toContain("workspace_id=$2 and preset.brand_id=$3");
    expect(source).not.toContain("designRules");
    expect(source).not.toContain("referenceImages");
  });

  it("requires owned active references and revision CAS before updating", () => {
    const source = readFileSync(new URL("./manualVisualAssetsRepository.ts", import.meta.url), "utf8");
    expect(source).toContain("archived_at is null");
    expect(source).toContain("join storage_artifacts artifact");
    expect(source).toContain("artifact.deleted_at is null");
    expect(source).toContain("lower(artifact.mime_type) in ('image/png','image/jpeg','image/webp')");
    expect(source).toContain("revision=$4");
    expect(source).toContain("for update");
  });

  it("requires an admin when an update clears the current default preset", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql === "begin" || sql === "rollback") return { rows: [], rowCount: 0 };
      if (sql.includes("select member.role")) return { rows: [{ role: "member" }], rowCount: 1 };
      if (sql.includes("from reference_items item")) return { rows: [{ id: "reference" }], rowCount: 1 };
      if (sql.includes("from brand_style_presets preset") && sql.includes("for update")) {
        return { rows: [{ id: "preset", is_default: true }], rowCount: 1 };
      }
      if (sql.includes("from brand_style_presets preset")) return { rows: [{
        id: "preset", workspace_id: "workspace", brand_id: "brand", name: "Style", description: "",
        visual_tokens_json: { colors: [], fonts: [], notes: [] }, reference_item_ids: [],
        is_default: false, status: "active", revision: 2,
        created_at: "2026-08-14T00:00:00.000Z", updated_at: "2026-08-14T00:00:00.000Z",
      }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    });
    const repository = createManualVisualAssetsRepository({
      connect: vi.fn(async () => ({ query, release: vi.fn() })),
    } as never);

    await expect(repository.updateBrandStylePreset({
      workspaceId: "workspace", brandId: "brand", actorUserId: "member", presetId: "preset", expectedRevision: 1,
    }, {
      contractVersion: "brand-style-preset.v1",
      name: "Style", description: "", visualTokens: { colors: [], fonts: [], notes: [] },
      referenceItemIds: ["10000000-0000-4000-8000-000000000001"], isDefault: false,
    })).rejects.toThrow("brand_style_preset_admin_required");
  });

  it("compacts positions and promotes the next image when deleting the hero", async () => {
    const updates: Array<{ sql: string; params: unknown[] }> = [];
    const query = vi.fn(async (sql: string, params: unknown[] = []) => {
      if (sql === "begin" || sql === "commit") return { rows: [], rowCount: 0 };
      if (sql.includes("select member.role")) return { rows: [{ role: "member" }], rowCount: 1 };
      if (sql.includes("where asset.id=$1") && sql.includes("for update")) {
        return { rows: [{
          id: "image-1", storage_artifact_id: "artifact-1", product_service_version_id: "version-1",
          role: "hero", position: 1,
        }], rowCount: 1 };
      }
      if (sql.includes("where asset.product_service_version_id=$1") && sql.includes("for update")) {
        return { rows: [
          { id: "image-1", role: "hero", position: 1 },
          { id: "image-2", role: "detail", position: 2 },
          { id: "image-3", role: "detail", position: 3 },
        ], rowCount: 3 };
      }
      if (sql.startsWith("update product_service_assets")) updates.push({ sql, params });
      return { rows: [], rowCount: 1 };
    });
    const repository = createManualVisualAssetsRepository({
      connect: vi.fn(async () => ({ query, release: vi.fn() })),
    } as never);

    await repository.deleteProductServiceImageAsset({
      workspaceId: "workspace", brandId: "brand", actorUserId: "member",
      productServiceId: "product", imageId: "image-1",
    });

    expect(updates.map(({ params }) => params)).toEqual([
      ["hero", 1, "image-2", "workspace", "brand"],
      ["detail", 2, "image-3", "workspace", "brand"],
    ]);
  });
});
