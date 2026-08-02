import { describe, expect, it, vi } from "vitest";
import type { AiContentSnapshotBlob } from "./aiContentSnapshotBlob.js";
import {
  createAiContentSnapshotRepository,
  type AiContentSnapshotQueryable,
} from "./aiContentSnapshotRepository.js";

const scope = {
  workspaceId: "10000000-0000-4000-8000-000000000001",
  brandId: "20000000-0000-4000-8000-000000000002",
};
const ids = {
  core: "30000000-0000-4000-8000-000000000003",
  product: "40000000-0000-4000-8000-000000000004",
  productVersion: "50000000-0000-4000-8000-000000000005",
  hero: "60000000-0000-4000-8000-000000000006",
  detail: "60000000-0000-4000-8000-000000000007",
  logo: "60000000-0000-4000-8000-000000000008",
  document: "60000000-0000-4000-8000-000000000009",
  referenceA: "70000000-0000-4000-8000-000000000007",
  referenceB: "70000000-0000-4000-8000-000000000008",
  snapshotA: "80000000-0000-4000-8000-000000000008",
  snapshotB: "80000000-0000-4000-8000-000000000009",
  style: "90000000-0000-4000-8000-000000000009",
};

function result(rows: Array<Record<string, unknown>>) {
  return { rows, rowCount: rows.length };
}

function queryable(query: AiContentSnapshotQueryable["query"]): AiContentSnapshotQueryable {
  return { query };
}

function blob() {
  const freezeOwnedImage = vi.fn(async (input: {
    brandId: string;
    sourceStoragePath: string;
    mimeType: string;
    expectedChecksum?: string | null;
  }) => ({
    storageUrl: `https://blob.example/frozen/${input.sourceStoragePath}`,
    storagePath: `frozen/${input.sourceStoragePath}`,
    mimeType: input.mimeType.toLowerCase() as "image/png" | "image/jpeg" | "image/webp",
    checksum: input.expectedChecksum ?? "a".repeat(64),
  }));
  return { freezeOwnedImage } satisfies AiContentSnapshotBlob;
}

describe("AI content snapshot repository", () => {
  it("loads exactly the current approved core fields without Wiki or FAQ SQL", async () => {
    const queries: string[] = [];
    const database = queryable(async (sql) => {
      queries.push(String(sql));
      return result([{
        version_id: ids.core,
        core_json: {
          contractVersion: "brand-core.v1",
          companyOverview: "  Company overview  ",
          businessDescription: " Business description ",
          primaryCategory: { code: "marketing", name: " Marketing " },
          subcategories: [{ code: "content", name: " Content " }, { code: null, name: " Social " }],
          primaryTarget: " Operators ",
          differentiators: [" Owned facts ", " Approval "],
          coreAppeal: " Consistency ",
          summary: { oneLine: "not selected", description: "not selected" },
          faq: [{ question: "must not leak", answer: "must not leak" }],
        },
      }]);
    });

    await expect(createAiContentSnapshotRepository(database, blob()).loadApprovedCore(scope)).resolves.toEqual({
      versionId: ids.core,
      companyOverview: "Company overview",
      businessDescription: "Business description",
      primaryCategory: "Marketing",
      detailedCategory: "Content, Social",
      primaryTarget: "Operators",
      differentiator: "Owned facts; Approval",
      coreAppeal: "Consistency",
    });
    expect(Object.keys(await createAiContentSnapshotRepository(database, blob()).loadApprovedCore(scope)))
      .toEqual([
        "versionId", "companyOverview", "businessDescription", "primaryCategory",
        "detailedCategory", "primaryTarget", "differentiator", "coreAppeal",
      ]);
    expect(queries.join("\n").toLowerCase()).not.toMatch(/wiki|faq|question|answer/);
    expect(queries.join("\n")).toContain("active_brand_core_id");
  });

  it("freezes only owned hero/detail assets from the active approved product version", async () => {
    const service = blob();
    const profile = {
      contractVersion: "product-service.v1",
      name: "  Launch service ",
      kind: "service",
      description: " Description ",
      features: [" Fast ", ""],
      benefits: [" Clear "],
      cautions: [" Review "],
      audiences: [],
      appealsByTarget: {},
      evergreenPurchaseInfo: " Contact sales ",
      sourceUrls: ["https://mutable.example/never-returned"],
    };
    const database = queryable(async (sql) => {
      expect(String(sql)).toContain("version.id = item.active_version_id");
      return result([
        { item_id: ids.product, item_kind: "service", version_id: ids.productVersion, profile_json: profile,
          asset_id: ids.hero, asset_role: "hero", storage_path: "owned/hero.png", mime_type: "image/png", asset_checksum: null },
        { item_id: ids.product, item_kind: "service", version_id: ids.productVersion, profile_json: profile,
          asset_id: ids.detail, asset_role: "detail", storage_path: "owned/detail.webp", mime_type: "image/webp", asset_checksum: null },
        { item_id: ids.product, item_kind: "service", version_id: ids.productVersion, profile_json: profile,
          asset_id: ids.logo, asset_role: "logo", storage_path: "owned/logo.png", mime_type: "image/png", asset_checksum: null },
        { item_id: ids.product, item_kind: "service", version_id: ids.productVersion, profile_json: profile,
          asset_id: ids.document, asset_role: "document", storage_path: "owned/spec.pdf", mime_type: "application/pdf", asset_checksum: null },
      ]);
    });

    await expect(createAiContentSnapshotRepository(database, service).loadApprovedProduct(scope, ids.product))
      .resolves.toEqual({
        id: ids.product,
        versionId: ids.productVersion,
        kind: "service",
        name: "Launch service",
        description: "Description",
        features: ["Fast"],
        benefits: ["Clear"],
        cautions: ["Review"],
        evergreenPurchaseInfo: "Contact sales",
        images: [
          {
            assetId: ids.hero,
            role: "hero",
            storageUrl: "https://blob.example/frozen/owned/hero.png",
            storagePath: "frozen/owned/hero.png",
            mimeType: "image/png",
            checksum: "a".repeat(64),
          },
          {
            assetId: ids.detail,
            role: "detail",
            storageUrl: "https://blob.example/frozen/owned/detail.webp",
            storagePath: "frozen/owned/detail.webp",
            mimeType: "image/webp",
            checksum: "a".repeat(64),
          },
        ],
      });
    expect(service.freezeOwnedImage.mock.calls.map(([input]) => input.sourceStoragePath))
      .toEqual(["owned/hero.png", "owned/detail.webp"]);
  });

  it("returns the same public error for missing core and product resources", async () => {
    const repository = createAiContentSnapshotRepository(
      queryable(async () => result([])),
      blob(),
    );
    await expect(repository.loadApprovedCore(scope)).rejects.toThrow(/^RESOURCE_NOT_AVAILABLE$/);
    await expect(repository.loadApprovedProduct(scope, ids.product)).rejects.toThrow(/^RESOURCE_NOT_AVAILABLE$/);
  });

  it("preserves selected reference order and roles while freezing only DB-owned archived media", async () => {
    const service = blob();
    const snapshot = (id: string, itemId: string, title: string, media: Record<string, unknown>) => ({
      snapshotId: id,
      itemId,
      version: 1,
      title,
      sourceUrl: `https://source.example/${itemId}`,
      capturedAt: "2026-07-30T00:00:00.000Z",
      contentHash: itemId === ids.referenceA ? "a".repeat(64) : "b".repeat(64),
      content: { title, text: `immutable ${title}` },
      media,
      sourceAvailability: "available",
      provenance: {},
      permittedUse: {
        displayPreview: true,
        archiveBytes: true,
        modelInput: true,
        derivativeInspiration: true,
      },
    });
    const database = queryable(async (sql) => {
      const statement = String(sql);
      expect(statement).toContain("reference_items item");
      expect(statement).toContain("reference_snapshots");
      expect(statement).toContain("derivativeInspiration");
      return result([
        {
          reference_item_id: ids.referenceA,
          snapshot_id: ids.snapshotA,
          snapshot_json: snapshot(ids.snapshotA, ids.referenceA, "Owned", { storagePath: "archive/a.jpg" }),
          immutable_storage_path: "archive/a.jpg",
          immutable_mime_type: "image/jpeg",
          immutable_checksum: "c".repeat(64),
          mutable_item_title: "must not leak",
          mutable_source_url: "https://mutable.example/must-not-leak",
        },
        {
          reference_item_id: ids.referenceB,
          snapshot_id: ids.snapshotB,
          snapshot_json: snapshot(ids.snapshotB, ids.referenceB, "External", { mediaUrl: "https://external.example/live.png" }),
          immutable_storage_path: null,
          immutable_mime_type: null,
          immutable_checksum: null,
        },
      ]);
    });

    await expect(createAiContentSnapshotRepository(database, service).freezeReferences(scope, [
      { referenceId: ids.referenceB, roles: ["copy_pattern"] },
      { referenceId: ids.referenceA, roles: ["planning", "visual_composition"] },
    ])).resolves.toEqual([
      {
        referenceItemId: ids.referenceB,
        snapshotId: ids.snapshotB,
        roles: ["copy_pattern"],
        title: "External",
        sourceUrl: `https://source.example/${ids.referenceB}`,
        capturedAt: "2026-07-30T00:00:00.000Z",
        contentHash: "b".repeat(64),
        text: "immutable External",
        image: null,
      },
      {
        referenceItemId: ids.referenceA,
        snapshotId: ids.snapshotA,
        roles: ["planning", "visual_composition"],
        title: "Owned",
        sourceUrl: `https://source.example/${ids.referenceA}`,
        capturedAt: "2026-07-30T00:00:00.000Z",
        contentHash: "a".repeat(64),
        text: "immutable Owned",
        image: {
          storageUrl: "https://blob.example/frozen/archive/a.jpg",
          storagePath: "frozen/archive/a.jpg",
          mimeType: "image/jpeg",
          checksum: "c".repeat(64),
        },
      },
    ]);
    expect(service.freezeOwnedImage).toHaveBeenCalledOnce();
    expect(service.freezeOwnedImage).toHaveBeenCalledWith({
      brandId: scope.brandId,
      sourceStoragePath: "archive/a.jpg",
      mimeType: "image/jpeg",
      expectedChecksum: "c".repeat(64),
    });
  });

  it("rejects duplicate, missing, denied, cross-brand, and noncanonical reference IDs identically", async () => {
    const database = queryable(async () => result([]));
    const repository = createAiContentSnapshotRepository(database, blob());
    const selections = [
      [
        { referenceId: ids.referenceA, roles: ["planning" as const] },
        { referenceId: ids.referenceA, roles: ["copy_pattern" as const] },
      ],
      [{ referenceId: ids.referenceA, roles: ["planning" as const] }],
      [{ referenceId: "not-a-canonical-id", roles: ["planning" as const] }],
    ];
    for (const selected of selections) {
      await expect(repository.freezeReferences(scope, selected)).rejects.toThrow(/^RESOURCE_NOT_AVAILABLE$/);
    }
  });

  it("revalidates identities and current eligibility without replacing frozen bytes", async () => {
    const statements: string[] = [];
    const database = queryable(async (sql) => {
      statements.push(String(sql));
      return result([{ eligible: true }]);
    });
    const service = blob();
    const repository = createAiContentSnapshotRepository(database, service);
    await expect(repository.revalidateFrozenResources({
      scope,
      coreVersionId: ids.core,
      product: {
        id: ids.product,
        versionId: ids.productVersion,
        kind: "service",
        name: "Frozen",
        description: "Frozen",
        features: [],
        benefits: [],
        cautions: [],
        evergreenPurchaseInfo: "",
        images: [],
      },
      references: [{
        referenceItemId: ids.referenceA,
        snapshotId: ids.snapshotA,
        roles: ["planning"],
        title: "Frozen title",
        sourceUrl: "https://source.example/frozen",
        capturedAt: "2026-07-30T00:00:00.000Z",
        contentHash: "a".repeat(64),
        text: "Frozen text",
        image: null,
      }],
    })).resolves.toBeUndefined();
    expect(statements.join("\n")).toContain("core.id = $3");
    expect(statements.join("\n")).not.toContain("profile.active_brand_core_id");
    expect(statements.join("\n")).toContain("version.id = $4");
    expect(statements.join("\n")).not.toContain("item.active_version_id");
    expect(statements.join("\n")).toContain("permittedUse");
    expect(statements.join("\n")).toContain("unnest($3::uuid[], $4::uuid[])");
    expect(statements.join("\n")).toContain("snapshot.id = requested.snapshot_id");
    expect(service.freezeOwnedImage).not.toHaveBeenCalled();
  });

  it("loads approved Brand Rules reference images and snapshots only registered owned uploads", async () => {
    const service = blob();
    const database = queryable(async (sql) => {
      expect(String(sql)).toContain("active_brand_rule_set_id");
      expect(String(sql)).toContain("designRules");
      return result([{
        reference_item_id: ids.style,
        description: "  Soft daylight ",
        tags: [" warm ", " editorial "],
        storage_path: "styles/soft.png",
        mime_type: "image/png",
        checksum: "d".repeat(64),
      }]);
    });

    await expect(createAiContentSnapshotRepository(database, service).loadApprovedStyleImages(scope))
      .resolves.toEqual([{
        referenceItemId: ids.style,
        description: "Soft daylight",
        tags: ["warm", "editorial"],
        storageUrl: "https://blob.example/frozen/styles/soft.png",
        storagePath: "frozen/styles/soft.png",
        mimeType: "image/png",
        checksum: "d".repeat(64),
      }]);
    expect(service.freezeOwnedImage).toHaveBeenCalledWith({
      brandId: scope.brandId,
      sourceStoragePath: "styles/soft.png",
      mimeType: "image/png",
      expectedChecksum: "d".repeat(64),
    });
  });
});
