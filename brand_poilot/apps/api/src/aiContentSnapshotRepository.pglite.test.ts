import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AiContentSnapshotBlob } from "./aiContentSnapshotBlob.js";
import {
  createAiContentSnapshotRepository,
  type AiContentSnapshotQueryable,
} from "./aiContentSnapshotRepository.js";

let database: PGlite | undefined;

const ids = {
  workspace: "10000000-0000-4000-8000-000000000001",
  otherWorkspace: "10000000-0000-4000-8000-000000000002",
  brand: "20000000-0000-4000-8000-000000000002",
  otherBrand: "20000000-0000-4000-8000-000000000003",
  core: "30000000-0000-4000-8000-000000000003",
  draftCore: "30000000-0000-4000-8000-000000000004",
  otherCore: "30000000-0000-4000-8000-000000000005",
  rules: "31000000-0000-4000-8000-000000000003",
  product: "40000000-0000-4000-8000-000000000004",
  productVersion: "41000000-0000-4000-8000-000000000004",
  draftVersion: "41000000-0000-4000-8000-000000000005",
  archivedProduct: "40000000-0000-4000-8000-000000000005",
  archivedVersion: "41000000-0000-4000-8000-000000000006",
  draftProduct: "40000000-0000-4000-8000-000000000006",
  draftOnlyVersion: "41000000-0000-4000-8000-000000000007",
  otherProduct: "40000000-0000-4000-8000-000000000007",
  otherProductVersion: "41000000-0000-4000-8000-000000000008",
  hero: "42000000-0000-4000-8000-000000000001",
  detail: "42000000-0000-4000-8000-000000000002",
  logo: "42000000-0000-4000-8000-000000000003",
  document: "42000000-0000-4000-8000-000000000004",
  ownedArtifact: "50000000-0000-4000-8000-000000000001",
  externalSource: "50000000-0000-4000-8000-000000000002",
  deniedSource: "50000000-0000-4000-8000-000000000003",
  archivedSource: "50000000-0000-4000-8000-000000000004",
  otherArtifact: "50000000-0000-4000-8000-000000000005",
  ownedReference: "60000000-0000-4000-8000-000000000001",
  externalReference: "60000000-0000-4000-8000-000000000002",
  deniedReference: "60000000-0000-4000-8000-000000000003",
  archivedReference: "60000000-0000-4000-8000-000000000004",
  otherReference: "60000000-0000-4000-8000-000000000005",
  ownedSnapshot: "61000000-0000-4000-8000-000000000001",
  newerOwnedSnapshot: "61000000-0000-4000-8000-000000000006",
  externalSnapshot: "61000000-0000-4000-8000-000000000002",
  deniedSnapshot: "61000000-0000-4000-8000-000000000003",
  archivedSnapshot: "61000000-0000-4000-8000-000000000004",
  otherSnapshot: "61000000-0000-4000-8000-000000000005",
};

const scope = { workspaceId: ids.workspace, brandId: ids.brand };

const productProfile = {
  contractVersion: "product-service.v1",
  name: "Approved service",
  kind: "service",
  description: "Immutable approved description",
  features: ["Feature"],
  benefits: ["Benefit"],
  cautions: ["Caution"],
  audiences: [],
  appealsByTarget: {},
  evergreenPurchaseInfo: "Always available",
  sourceUrls: ["https://mutable.example/not-returned"],
};

async function insertSnapshot(input: {
  id: string;
  itemId: string;
  workspaceId?: string;
  brandId?: string;
  title: string;
  text: string;
  permitted?: boolean;
  media?: Record<string, unknown>;
  version?: number;
}) {
  const db = database as PGlite;
  const workspaceId = input.workspaceId ?? ids.workspace;
  const brandId = input.brandId ?? ids.brand;
  const content = { title: input.title, text: input.text };
  await db.query(
    `with payload as (
       select $9::jsonb as content,
              encode(digest(($9::jsonb)::text, 'sha256'), 'hex') as content_hash
     )
     insert into reference_snapshots (
       id, workspace_id, brand_id, reference_item_id, version,
       content_hash, captured_at, snapshot_json
     )
     select $1::uuid, $2::uuid, $3::uuid, $4::uuid, $12::integer, payload.content_hash, $5::timestamptz,
       jsonb_build_object(
         'snapshotId', $1::uuid::text,
         'itemId', $4::uuid::text,
         'version', $12::integer,
         'title', $6::text,
         'sourceUrl', $7::text,
         'capturedAt', $11::text,
         'contentHash', payload.content_hash,
         'content', payload.content,
         'media', $8::jsonb,
         'sourceAvailability', 'available',
         'provenance', jsonb_build_object('kind', 'fixture'),
         'permittedUse', jsonb_build_object(
           'displayPreview', true,
           'archiveBytes', true,
           'modelInput', $10::boolean,
           'derivativeInspiration', $10::boolean
         )
       )
     from payload`,
    [
      input.id,
      workspaceId,
      brandId,
      input.itemId,
      "2026-07-30T00:00:00.000Z",
      input.title,
      `https://source.example/${input.itemId}`,
      JSON.stringify(input.media ?? {}),
      JSON.stringify(content),
      input.permitted ?? true,
      "2026-07-30T00:00:00.000Z",
      input.version ?? 1,
    ],
  );
}

const freezeOwnedImage = vi.fn(async (input: {
  brandId: string;
  sourceStoragePath: string;
  mimeType: string;
  expectedChecksum?: string | null;
}) => {
  const checksum = input.expectedChecksum ?? (input.sourceStoragePath.includes("hero") ? "1" : "2").repeat(64);
  const extension = input.mimeType === "image/jpeg" ? "jpg" : input.mimeType.split("/")[1];
  return {
    storageUrl: `https://blob.example/ai-content/snapshots/${input.brandId}/${checksum}.${extension}`,
    storagePath: `ai-content/snapshots/${input.brandId}/${checksum}.${extension}`,
    mimeType: input.mimeType as "image/png" | "image/jpeg" | "image/webp",
    checksum,
  };
});

beforeAll(async () => {
  database = await PGlite.create({ extensions: { pgcrypto } });
  const directory = resolve(process.cwd(), "../../db/migrations");
  const files = (await readdir(directory)).filter((file) => file.endsWith(".sql")).sort();
  for (const file of files) {
    const sql = await readFile(resolve(directory, file), "utf8");
    if (sql.startsWith("-- requires: pgvector") || file === "027_wiki_search_v2.sql") continue;
    await database.exec(sql);
  }

  await database.exec(`
    insert into workspaces (id, name, slug) values
      ('${ids.workspace}', 'Snapshots', 'snapshots'),
      ('${ids.otherWorkspace}', 'Other Snapshots', 'other-snapshots');
    insert into brands (id, workspace_id, name) values
      ('${ids.brand}', '${ids.workspace}', 'Primary'),
      ('${ids.otherBrand}', '${ids.otherWorkspace}', 'Other');
    insert into brand_profiles (workspace_id, brand_id) values
      ('${ids.workspace}', '${ids.brand}'),
      ('${ids.otherWorkspace}', '${ids.otherBrand}');

    insert into brand_core_versions (
      id, workspace_id, brand_id, version, status, core_json, created_by, approved_at
    ) values
      ('${ids.core}', '${ids.workspace}', '${ids.brand}', 1, 'approved',
       '{"contractVersion":"brand-core.v1","companyOverview":" Company ","businessDescription":" Business ","primaryCategory":{"code":"marketing","name":" Marketing "},"subcategories":[{"code":"content","name":" Content "}],"primaryTarget":" Operators ","differentiators":[" Owned facts "],"coreAppeal":" Consistency ","summary":{"oneLine":"x","description":"x"},"audiences":[],"valueProposition":{"primary":"x","differentiators":[],"proofPoints":[]},"messaging":{"appeals":[],"tone":[],"preferredPhrases":[],"brandDirection":"","priorityMessages":[]}}',
       'user', now()),
      ('${ids.draftCore}', '${ids.workspace}', '${ids.brand}', 2, 'draft', '{}', 'user', null),
      ('${ids.otherCore}', '${ids.otherWorkspace}', '${ids.otherBrand}', 1, 'approved', '{}', 'user', now());

    insert into storage_artifacts (
      id, workspace_id, brand_id, artifact_type, bucket, path, public_url,
      mime_type, byte_size, checksum
    ) values
      ('${ids.ownedArtifact}', '${ids.workspace}', '${ids.brand}', 'brand_asset', 'vercel-blob',
       'owned/style.png', 'https://blob.example/owned/style.png', 'image/png', 100, '${"a".repeat(64)}'),
      ('${ids.otherArtifact}', '${ids.otherWorkspace}', '${ids.otherBrand}', 'brand_asset', 'vercel-blob',
       'other/style.png', 'https://blob.example/other/style.png', 'image/png', 100, '${"e".repeat(64)}');

    insert into source_urls (
      id, workspace_id, brand_id, source_type, url, url_hash, content_purpose
    ) values
      ('${ids.externalSource}', '${ids.workspace}', '${ids.brand}', 'reference',
       'https://source.example/external', 'external-hash', 'both'),
      ('${ids.deniedSource}', '${ids.workspace}', '${ids.brand}', 'reference',
       'https://source.example/denied', 'denied-hash', 'both'),
      ('${ids.archivedSource}', '${ids.workspace}', '${ids.brand}', 'reference',
       'https://source.example/archived', 'archived-hash', 'both');

    insert into reference_items (
      id, workspace_id, brand_id, kind, title, source_url, storage_artifact_id
    ) values
      ('${ids.ownedReference}', '${ids.workspace}', '${ids.brand}', 'upload',
       'Mutable owned title', 'https://mutable.example/owned', '${ids.ownedArtifact}'),
      ('${ids.otherReference}', '${ids.otherWorkspace}', '${ids.otherBrand}', 'upload',
       'Other title', 'https://mutable.example/other', '${ids.otherArtifact}');
    insert into reference_items (
      id, workspace_id, brand_id, kind, title, source_url, source_url_id, archived_at
    ) values
      ('${ids.externalReference}', '${ids.workspace}', '${ids.brand}', 'external_url',
       'Mutable external title', 'https://mutable.example/external', '${ids.externalSource}', null),
      ('${ids.deniedReference}', '${ids.workspace}', '${ids.brand}', 'external_url',
       'Denied', 'https://mutable.example/denied', '${ids.deniedSource}', null),
      ('${ids.archivedReference}', '${ids.workspace}', '${ids.brand}', 'external_url',
       'Archived', 'https://mutable.example/archived', '${ids.archivedSource}', now());
  `);

  await insertSnapshot({
    id: ids.ownedSnapshot,
    itemId: ids.ownedReference,
    title: "Immutable owned title",
    text: "Immutable owned text",
    media: { storagePath: "owned/style.png", mediaUrl: "https://external.example/ignored.png" },
  });
  await insertSnapshot({
    id: ids.externalSnapshot,
    itemId: ids.externalReference,
    title: "Immutable external title",
    text: "Immutable external text",
    media: { mediaUrl: "https://external.example/live.png", mimeType: "image/png" },
  });
  await insertSnapshot({
    id: ids.deniedSnapshot,
    itemId: ids.deniedReference,
    title: "Denied",
    text: "Denied",
    permitted: false,
  });
  await insertSnapshot({
    id: ids.archivedSnapshot,
    itemId: ids.archivedReference,
    title: "Archived",
    text: "Archived",
  });
  await insertSnapshot({
    id: ids.otherSnapshot,
    itemId: ids.otherReference,
    workspaceId: ids.otherWorkspace,
    brandId: ids.otherBrand,
    title: "Other",
    text: "Other",
    media: { storagePath: "other/style.png" },
  });

  await database.exec(`
    insert into brand_rule_sets (
      id, workspace_id, brand_id, version, status, rules_json, created_by, approved_at
    ) values (
      '${ids.rules}', '${ids.workspace}', '${ids.brand}', 1, 'approved',
      '{"contractVersion":"brand-rules.v1","requiredPhrases":[],"forbiddenPhrases":[],"exaggerationRules":[],"ctaRules":{"defaultCta":"","allowed":[]},"channelRules":{},"designRules":{"colors":["#fff"],"fonts":["Ignored"],"notes":["Ignored"],"referenceImages":[{"referenceItemId":"${ids.ownedReference}","description":" Soft ","tags":[" warm "]},{"referenceItemId":"${ids.externalReference}","description":"External","tags":["skip"]},{"referenceItemId":"${ids.otherReference}","description":"Cross brand","tags":["skip"]}]},"autoApprovalRules":{"enabled":false,"conditions":[]}}',
      'user', now()
    );
    update brand_profiles
       set active_brand_core_id = '${ids.core}', active_brand_rule_set_id = '${ids.rules}'
     where workspace_id = '${ids.workspace}' and brand_id = '${ids.brand}';
    update brand_profiles
       set active_brand_core_id = '${ids.otherCore}'
     where workspace_id = '${ids.otherWorkspace}' and brand_id = '${ids.otherBrand}';

    insert into product_services (
      id, workspace_id, brand_id, kind, display_name, status
    ) values
      ('${ids.product}', '${ids.workspace}', '${ids.brand}', 'service', 'Approved service', 'active'),
      ('${ids.archivedProduct}', '${ids.workspace}', '${ids.brand}', 'product', 'Archived', 'archived'),
      ('${ids.draftProduct}', '${ids.workspace}', '${ids.brand}', 'product', 'Draft only', 'active'),
      ('${ids.otherProduct}', '${ids.otherWorkspace}', '${ids.otherBrand}', 'product', 'Other', 'active');
    insert into product_service_versions (
      id, workspace_id, brand_id, product_service_id, version, status,
      profile_json, approved_at
    ) values
      ('${ids.productVersion}', '${ids.workspace}', '${ids.brand}', '${ids.product}', 1, 'approved',
       '${JSON.stringify(productProfile)}', now()),
      ('${ids.draftVersion}', '${ids.workspace}', '${ids.brand}', '${ids.product}', 2, 'draft',
       '${JSON.stringify({ ...productProfile, name: "Draft" })}', null),
      ('${ids.archivedVersion}', '${ids.workspace}', '${ids.brand}', '${ids.archivedProduct}', 1, 'approved',
       '${JSON.stringify({ ...productProfile, kind: "product", name: "Archived" })}', now()),
      ('${ids.draftOnlyVersion}', '${ids.workspace}', '${ids.brand}', '${ids.draftProduct}', 1, 'draft',
       '${JSON.stringify({ ...productProfile, kind: "product", name: "Draft only" })}', null),
      ('${ids.otherProductVersion}', '${ids.otherWorkspace}', '${ids.otherBrand}', '${ids.otherProduct}', 1, 'approved',
       '${JSON.stringify({ ...productProfile, kind: "product", name: "Other" })}', now());
    update product_services set active_version_id = '${ids.productVersion}' where id = '${ids.product}';
    update product_services set active_version_id = '${ids.archivedVersion}' where id = '${ids.archivedProduct}';
    update product_services set active_version_id = '${ids.otherProductVersion}' where id = '${ids.otherProduct}';

    insert into product_service_assets (
      id, workspace_id, brand_id, product_service_id, product_service_version_id,
      storage_url, storage_path, mime_type, size_bytes, role, position
    ) values
      ('${ids.hero}', '${ids.workspace}', '${ids.brand}', '${ids.product}', '${ids.productVersion}',
       'https://mutable.example/hero.png', 'owned/product-hero.png', 'image/png', 100, 'hero', 1),
      ('${ids.detail}', '${ids.workspace}', '${ids.brand}', '${ids.product}', '${ids.productVersion}',
       'https://mutable.example/detail.webp', 'owned/product-detail.webp', 'image/webp', 100, 'detail', 2),
      ('${ids.logo}', '${ids.workspace}', '${ids.brand}', '${ids.product}', '${ids.productVersion}',
       'https://mutable.example/logo.png', 'owned/product-logo.png', 'image/png', 100, 'logo', 3),
      ('${ids.document}', '${ids.workspace}', '${ids.brand}', '${ids.product}', '${ids.productVersion}',
       'https://mutable.example/spec.pdf', 'owned/product-spec.pdf', 'application/pdf', 100, 'document', 4);
  `);
}, 60_000);

beforeEach(async () => {
  freezeOwnedImage.mockClear();
  const db = database as PGlite;
  await db.exec("begin");
  await db.query("delete from reference_snapshots where id=$1", [ids.newerOwnedSnapshot]);
  await db.query("update brand_core_versions set status='draft', approved_at=null where id=$1", [ids.draftCore]);
  await db.query("update brand_core_versions set status='approved', approved_at=now() where id=$1", [ids.core]);
  await db.query("update brand_profiles set active_brand_core_id=$1 where workspace_id=$2 and brand_id=$3", [
    ids.core,
    ids.workspace,
    ids.brand,
  ]);
  await db.query("update product_service_versions set status='draft', approved_at=null where id=$1", [ids.draftVersion]);
  await db.query("update product_service_versions set status='approved', approved_at=now() where id=$1", [ids.productVersion]);
  await db.query("update product_services set status='active', active_version_id=$1 where id=$2", [
    ids.productVersion,
    ids.product,
  ]);
  await db.query("update reference_items set archived_at=null where id=$1", [ids.ownedReference]);
});

afterEach(async () => {
  await (database as PGlite).exec("rollback");
});

afterAll(async () => {
  await database?.close();
});

function repository() {
  return createAiContentSnapshotRepository(
    database as unknown as AiContentSnapshotQueryable,
    { freezeOwnedImage } satisfies AiContentSnapshotBlob,
  );
}

describe("AI content snapshot repository PostgreSQL contract", () => {
  it("loads approved core/product/style resources and freezes only owned image paths", async () => {
    const snapshots = repository();
    await expect(snapshots.loadApprovedCore(scope)).resolves.toEqual({
      versionId: ids.core,
      companyOverview: "Company",
      businessDescription: "Business",
      primaryCategory: "Marketing",
      detailedCategory: "Content",
      primaryTarget: "Operators",
      differentiator: "Owned facts",
      coreAppeal: "Consistency",
    });

    const product = await snapshots.loadApprovedProduct(scope, ids.product);
    expect(product).toMatchObject({
      id: ids.product,
      versionId: ids.productVersion,
      kind: "service",
      name: "Approved service",
      description: "Immutable approved description",
    });
    expect(product.images.map(({ assetId, role }) => ({ assetId, role }))).toEqual([
      { assetId: ids.hero, role: "hero" },
      { assetId: ids.detail, role: "detail" },
    ]);
    expect(JSON.stringify(product)).not.toMatch(/logo|document|mutable\.example/);

    await expect(snapshots.loadApprovedStyleImages(scope)).resolves.toEqual([{
      referenceItemId: ids.ownedReference,
      description: "Soft",
      tags: ["warm"],
      storageUrl: `https://blob.example/ai-content/snapshots/${ids.brand}/${"a".repeat(64)}.png`,
      storagePath: `ai-content/snapshots/${ids.brand}/${"a".repeat(64)}.png`,
      mimeType: "image/png",
      checksum: "a".repeat(64),
    }]);

    expect(freezeOwnedImage.mock.calls.map(([input]) => input.sourceStoragePath)).toEqual([
      "owned/product-hero.png",
      "owned/product-detail.webp",
      "owned/style.png",
    ]);
  });

  it("freezes immutable references in input order and leaves external-only media null", async () => {
    const references = await repository().freezeReferences(scope, [
      { referenceId: ids.externalReference, roles: ["copy_pattern"] },
      { referenceId: ids.ownedReference, roles: ["planning", "visual_composition"] },
    ]);

    expect(references.map(({ referenceItemId, roles }) => ({ referenceItemId, roles }))).toEqual([
      { referenceItemId: ids.externalReference, roles: ["copy_pattern"] },
      { referenceItemId: ids.ownedReference, roles: ["planning", "visual_composition"] },
    ]);
    expect(references[0]).toMatchObject({
      title: "Immutable external title",
      text: "Immutable external text",
      image: null,
    });
    expect(references[1]).toMatchObject({
      title: "Immutable owned title",
      text: "Immutable owned text",
      image: {
        storagePath: `ai-content/snapshots/${ids.brand}/${"a".repeat(64)}.png`,
        checksum: "a".repeat(64),
      },
    });
    expect(JSON.stringify(references)).not.toContain("mutable.example");
    expect(freezeOwnedImage.mock.calls.map(([input]) => input.sourceStoragePath))
      .toEqual(["owned/style.png"]);
  });

  it.each([
    ids.archivedProduct,
    ids.draftProduct,
    ids.otherProduct,
    ids.productVersion,
  ])("uses one public error for archived, draft, cross-brand, and noncanonical product %s", async (productId) => {
    await expect(repository().loadApprovedProduct(scope, productId))
      .rejects.toThrow(/^RESOURCE_NOT_AVAILABLE$/);
  });

  it.each([
    ids.deniedReference,
    ids.archivedReference,
    ids.otherReference,
    ids.externalSnapshot,
  ])("uses one public error for denied, archived, cross-brand, and noncanonical reference %s", async (referenceId) => {
    await expect(repository().freezeReferences(scope, [{ referenceId, roles: ["planning"] }]))
      .rejects.toThrow(/^RESOURCE_NOT_AVAILABLE$/);
  });

  it("rejects valid reference and snapshot IDs when their requested pairs are swapped", async () => {
    const snapshots = repository();
    const references = await snapshots.freezeReferences(scope, [
      { referenceId: ids.ownedReference, roles: ["planning"] },
      { referenceId: ids.externalReference, roles: ["copy_pattern"] },
    ]);

    await expect(snapshots.revalidateFrozenResources({
      scope,
      coreVersionId: ids.core,
      product: null,
      references: [
        { ...references[0]!, snapshotId: references[1]!.snapshotId },
        { ...references[1]!, snapshotId: references[0]!.snapshotId },
      ],
    })).rejects.toThrow(/^RESOURCE_NOT_AVAILABLE$/);
  });

  it("revalidates the exact frozen identities without following newer active pointers or the latest reference snapshot", async () => {
    const snapshots = repository();
    const core = await snapshots.loadApprovedCore(scope);
    const product = await snapshots.loadApprovedProduct(scope, ids.product);
    const references = await snapshots.freezeReferences(scope, [
      { referenceId: ids.ownedReference, roles: ["planning"] },
    ]);
    freezeOwnedImage.mockClear();

    await insertSnapshot({
      id: ids.newerOwnedSnapshot,
      itemId: ids.ownedReference,
      title: "Newer mutable reference",
      text: "Newer text that must not replace the frozen snapshot",
      version: 2,
    });
    await (database as PGlite).query(
      "update brand_profiles set active_brand_core_id=$1 where workspace_id=$2 and brand_id=$3",
      [ids.draftCore, ids.workspace, ids.brand],
    );
    await (database as PGlite).query(
      "update product_services set active_version_id=$1 where id=$2",
      [ids.draftVersion, ids.product],
    );

    await expect(snapshots.revalidateFrozenResources({
      scope,
      coreVersionId: core.versionId,
      product,
      references,
    })).resolves.toBeUndefined();
    expect(freezeOwnedImage).not.toHaveBeenCalled();
    await expect(snapshots.loadApprovedCore(scope)).rejects.toThrow(/^RESOURCE_NOT_AVAILABLE$/);
    await expect(snapshots.loadApprovedProduct(scope, ids.product)).rejects.toThrow(/^RESOURCE_NOT_AVAILABLE$/);
    const currentReference = await snapshots.freezeReferences(scope, [
      { referenceId: ids.ownedReference, roles: ["planning"] },
    ]);
    expect(currentReference[0]?.snapshotId).toBe(ids.newerOwnedSnapshot);
    expect(references[0]?.snapshotId).toBe(ids.ownedSnapshot);
  });

  it("rejects the original core identity after its approval is revoked even when a newer core is approved", async () => {
    const snapshots = repository();
    const core = await snapshots.loadApprovedCore(scope);
    await (database as PGlite).query("update brand_core_versions set status='superseded' where id=$1", [ids.core]);
    await (database as PGlite).query(
      "update brand_core_versions set status='approved', approved_at=now() where id=$1",
      [ids.draftCore],
    );
    await (database as PGlite).query(
      "update brand_profiles set active_brand_core_id=$1 where workspace_id=$2 and brand_id=$3",
      [ids.draftCore, ids.workspace, ids.brand],
    );

    await expect(snapshots.revalidateFrozenResources({
      scope,
      coreVersionId: core.versionId,
      product: null,
      references: [],
    })).rejects.toThrow(/^RESOURCE_NOT_AVAILABLE$/);
  });

  it("rejects the original product identity after the product is archived", async () => {
    const snapshots = repository();
    const core = await snapshots.loadApprovedCore(scope);
    const product = await snapshots.loadApprovedProduct(scope, ids.product);
    await (database as PGlite).query("update product_services set status='archived' where id=$1", [ids.product]);

    await expect(snapshots.revalidateFrozenResources({
      scope,
      coreVersionId: core.versionId,
      product,
      references: [],
    })).rejects.toThrow(/^RESOURCE_NOT_AVAILABLE$/);
  });

  it("rejects the original product version after approval is revoked even when a newer version is active and approved", async () => {
    const snapshots = repository();
    const core = await snapshots.loadApprovedCore(scope);
    const product = await snapshots.loadApprovedProduct(scope, ids.product);
    await (database as PGlite).query(
      "update product_service_versions set status='superseded' where id=$1",
      [ids.productVersion],
    );
    await (database as PGlite).query(
      "update product_service_versions set status='approved', approved_at=now() where id=$1",
      [ids.draftVersion],
    );
    await (database as PGlite).query(
      "update product_services set active_version_id=$1 where id=$2",
      [ids.draftVersion, ids.product],
    );

    await expect(snapshots.revalidateFrozenResources({
      scope,
      coreVersionId: core.versionId,
      product,
      references: [],
    })).rejects.toThrow(/^RESOURCE_NOT_AVAILABLE$/);
  });

  it("rejects the original reference identity after the item is archived even when a newer snapshot exists", async () => {
    const snapshots = repository();
    const core = await snapshots.loadApprovedCore(scope);
    const references = await snapshots.freezeReferences(scope, [
      { referenceId: ids.ownedReference, roles: ["planning"] },
    ]);
    await insertSnapshot({
      id: ids.newerOwnedSnapshot,
      itemId: ids.ownedReference,
      title: "Newer archived reference",
      text: "Newer snapshot",
      version: 2,
    });

    await (database as PGlite).query(
      "update reference_items set archived_at=now() where id=$1",
      [ids.ownedReference],
    );
    await expect(snapshots.revalidateFrozenResources({
      scope,
      coreVersionId: core.versionId,
      product: null,
      references,
    })).rejects.toThrow(/^RESOURCE_NOT_AVAILABLE$/);
  });
});
