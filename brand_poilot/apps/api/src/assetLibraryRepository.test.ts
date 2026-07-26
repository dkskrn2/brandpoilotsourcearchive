import { describe, expect, it, vi } from "vitest";
import { createAssetLibraryRepository } from "./assetLibraryRepository.js";

const scope = {
  workspaceId: "11111111-1111-4111-8111-111111111111",
  brandId: "22222222-2222-4222-8222-222222222222",
  actorUserId: "33333333-3333-4333-8333-333333333333",
};
const avatarId = "44444444-4444-4444-8444-444444444444";
const imageId = "55555555-5555-4555-8555-555555555555";
const checksum = "a".repeat(64);

function fakePool(handler: (sql: string, values: unknown[]) => { rows?: unknown[]; rowCount?: number }) {
  const query = vi.fn(async (sql: string, values: unknown[] = []) => {
    const result = handler(sql.replace(/\s+/g, " ").trim(), values);
    return { rows: result.rows ?? [], rowCount: result.rowCount ?? result.rows?.length ?? 0 };
  });
  const client = { query, release: vi.fn() };
  return { pool: { query, connect: vi.fn(async () => client) } as never, query, client };
}

function member(sql: string, role = "member") {
  return sql.includes("from workspace_members") ? { rows: [{ role }] } : null;
}

describe("asset library repository", () => {
  it("locks the avatar row and rejects a concurrent sixth image", async () => {
    const fake = fakePool((sql) => {
      const access = member(sql);
      if (access) return access;
      if (sql.includes("from brand_avatars") && sql.includes("for update")) return { rows: [{ id: avatarId }] };
      if (sql.includes("generate_series")) return { rows: [{ position: 6 }] };
      return {};
    });
    const repository = createAssetLibraryRepository(fake.pool);
    await expect(repository.addAvatarImage(
      { ...scope, avatarId },
      {
        storagePath: `brands/${scope.brandId}/asset-library/avatars/x/${checksum}-face.webp`,
        storageUrl: "https://store.blob.vercel-storage.com/face.webp",
        fileName: "face.webp", mimeType: "image/webp", sizeBytes: 100, checksum, representative: false,
      },
    )).rejects.toThrow("avatar_image_limit_exceeded");
    const statements = fake.query.mock.calls.map(([sql]) => String(sql).replace(/\s+/g, " "));
    expect(statements.findIndex((sql) => sql.includes("brand_avatars") && sql.includes("for update")))
      .toBeLessThan(statements.findIndex((sql) => sql.includes("generate_series")));
    expect(statements.some((sql) => sql.startsWith("rollback"))).toBe(true);
  });

  it("uses the first free position when adding after an image deletion", async () => {
    const fake = fakePool((sql) => {
      const access = member(sql);
      if (access) return access;
      if (sql.includes("from brand_avatars") && sql.includes("for update")) return { rows: [{ id: avatarId }] };
      if (sql.includes("generate_series")) return { rows: [{ position: 2 }] };
      if (sql.includes("insert into brand_avatar_images")) return {};
      if (sql.includes("from brand_avatars avatar")) return { rows: [{
        id: avatarId, workspace_id: scope.workspaceId, brand_id: scope.brandId,
        name: "A", description: "", is_default: false, status: "active",
        created_by_user_id: scope.actorUserId, created_at: new Date(), updated_at: new Date(), images: [],
      }] };
      return {};
    });
    await createAssetLibraryRepository(fake.pool).addAvatarImage(
      { ...scope, avatarId },
      {
        fileName: "face.webp", storagePath: `brands/${scope.brandId}/asset-library/avatars/x/${checksum}-face.webp`,
        storageUrl: "https://store.blob.vercel-storage.com/face.webp",
        mimeType: "image/webp", sizeBytes: 100, checksum, representative: false,
      },
    );
    const insert = fake.query.mock.calls.find(([sql]) => String(sql).includes("insert into brand_avatar_images"));
    expect(insert?.[1]?.[3]).toBe(2);
  });

  it("atomically creates a reserved avatar from confirmed same-actor sessions", async () => {
    const first = "66666666-6666-4666-8666-666666666666";
    const second = "77777777-7777-4777-8777-777777777777";
    const prefix = (sessionId: string) =>
      `brands/${scope.brandId}/asset-library/avatars/${avatarId}/${sessionId}/`;
    const fake = fakePool((sql, values) => {
      const access = member(sql);
      if (access) return access;
      if (sql.includes("from reference_upload_sessions") && sql.includes("for update")) {
        return { rows: [first, second].map((id) => ({
          id, workspace_id: scope.workspaceId, brand_id: scope.brandId,
          created_by_user_id: scope.actorUserId, storage_path_prefix: prefix(id),
          expected_mime_type: "image/webp", expected_size_bytes: 100,
          expected_checksum: checksum, confirmed_at: new Date(), expires_at: new Date(Date.now() + 60_000),
        })) };
      }
      if (sql.includes("from storage_artifacts") && sql.includes("path like")) {
        return { rows: [first, second].map((id, index) => ({
          id: `artifact-${index}`, path: `${prefix(id)}${checksum}-${index}.webp`,
          public_url: `https://store.blob.vercel-storage.com/${prefix(id)}${checksum}-${index}.webp`,
          mime_type: "image/webp", byte_size: 100, checksum,
          created_by_user_id: scope.actorUserId,
        })) };
      }
      if (sql.includes("insert into brand_avatars")) return { rows: [{ id: values[0] }] };
      if (sql.includes("from brand_avatars avatar")) return { rows: [{
        id: avatarId, workspace_id: scope.workspaceId, brand_id: scope.brandId,
        name: "모델", description: "", is_default: false, status: "active",
        created_by_user_id: scope.actorUserId, created_at: new Date(), updated_at: new Date(),
        images: [],
      }] };
      return {};
    });
    const created = await createAssetLibraryRepository(fake.pool).createAvatar(scope, {
      avatarId, name: "모델", description: "", imageSessionIds: [first, second],
      representativeSessionId: second,
    });
    expect(created.id).toBe(avatarId);
    expect(fake.query.mock.calls.filter(([sql]) => String(sql).includes("insert into brand_avatar_images"))).toHaveLength(2);
    expect(fake.query.mock.calls.some(([sql]) =>
      String(sql).includes("delete from reference_upload_sessions") && String(sql).includes("id = any"),
    )).toBe(true);
  });

  it.each([
    ["mixed actor", { created_by_user_id: "99999999-9999-4999-8999-999999999999" }, "asset_library_upload_actor_mismatch"],
    ["wrong reserved avatar", { storage_path_prefix: `brands/${scope.brandId}/asset-library/avatars/99999999-9999-4999-8999-999999999999/${imageId}/` }, "asset_library_upload_path_mismatch"],
    ["expired", { expires_at: new Date(Date.now() - 1) }, "asset_library_upload_expired"],
    ["unconfirmed", { confirmed_at: null }, "asset_library_upload_not_confirmed"],
  ])("rejects pre-create session attack: %s", async (_label, override, error) => {
    const fake = fakePool((sql) => {
      const access = member(sql);
      if (access) return access;
      if (sql.includes("from reference_upload_sessions")) return { rows: [{
        id: imageId, workspace_id: scope.workspaceId, brand_id: scope.brandId,
        created_by_user_id: scope.actorUserId,
        storage_path_prefix: `brands/${scope.brandId}/asset-library/avatars/${avatarId}/${imageId}/`,
        expected_mime_type: "image/webp", expected_size_bytes: 100, expected_checksum: checksum,
        confirmed_at: new Date(), expires_at: new Date(Date.now() + 60_000), ...override,
      }] };
      return {};
    });
    await expect(createAssetLibraryRepository(fake.pool).createAvatar(scope, {
      avatarId, name: "모델", description: "", imageSessionIds: [imageId],
      representativeSessionId: imageId,
    })).rejects.toThrow(error);
  });

  it("stages a confirmed pre-create upload without creating an avatar image row", async () => {
    const prefix = `brands/${scope.brandId}/asset-library/avatars/${avatarId}/${imageId}/`;
    const fake = fakePool((sql) => {
      const access = member(sql);
      if (access) return access;
      if (sql.includes("from reference_upload_sessions")) return { rows: [{
        id: imageId, workspace_id: scope.workspaceId, brand_id: scope.brandId,
        created_by_user_id: scope.actorUserId, storage_path_prefix: prefix,
        confirmed_at: null, expires_at: new Date(Date.now() + 60_000),
      }] };
      if (sql.includes("from brand_avatars") && sql.includes("for update")) return { rows: [] };
      return {};
    });
    const result = await createAssetLibraryRepository(fake.pool).confirmAvatarUpload(
      { ...scope, avatarId, sessionId: imageId },
      {
        fileName: "face.webp", storagePath: `${prefix}${checksum}-face.webp`,
        storageUrl: `https://store.blob.vercel-storage.com/${prefix}${checksum}-face.webp`,
        mimeType: "image/webp", sizeBytes: 100, checksum, representative: false,
      },
    );
    expect(result).toEqual({ status: "staged", avatarId, sessionId: imageId });
    expect(fake.query.mock.calls.some(([sql]) => String(sql).includes("insert into storage_artifacts"))).toBe(true);
    expect(fake.query.mock.calls.some(([sql]) => String(sql).includes("insert into brand_avatar_images"))).toBe(false);
  });

  it("serializes default changes and keeps exactly one active default", async () => {
    const fake = fakePool((sql) => {
      const access = member(sql, "admin");
      if (access) return access;
      if (sql.includes("update brand_avatars") && sql.includes("returning")) {
        return { rows: [{ id: avatarId, workspace_id: scope.workspaceId, brand_id: scope.brandId, name: "A", description: "", is_default: true, status: "active", created_at: new Date(), updated_at: new Date() }] };
      }
      return {};
    });
    await createAssetLibraryRepository(fake.pool).setDefaultAvatar({ ...scope, avatarId });
    const sql = fake.query.mock.calls.map(([statement]) => String(statement).replace(/\s+/g, " "));
    expect(sql.some((statement) => statement.includes("pg_advisory_xact_lock"))).toBe(true);
    expect(sql.some((statement) => statement.includes("set is_default=false") && statement.includes("workspace_id=$1") && statement.includes("brand_id=$2"))).toBe(true);
    expect(sql.some((statement) => statement.includes("set is_default=true") && statement.includes("status='active'"))).toBe(true);
  });

  it("rejects member archive but permits admin archive in the same tenant", async () => {
    const denied = fakePool((sql) => member(sql, "member") ?? {});
    await expect(createAssetLibraryRepository(denied.pool).archiveAvatar({ ...scope, avatarId }))
      .rejects.toThrow("asset_library_admin_required");

    const allowed = fakePool((sql) => {
      const access = member(sql, "admin");
      if (access) return access;
      if (sql.includes("update brand_avatars")) return { rowCount: 1 };
      return {};
    });
    await createAssetLibraryRepository(allowed.pool).archiveAvatar({ ...scope, avatarId });
    expect(allowed.query.mock.calls.some(([sql, values]) =>
      String(sql).includes("workspace_id=$2") && String(sql).includes("brand_id=$3")
      && values?.[1] === scope.workspaceId && values?.[2] === scope.brandId,
    )).toBe(true);
  });

  it("shares the active reference URL limit and rejects the eleventh URL", async () => {
    const fake = fakePool((sql) => {
      const access = member(sql);
      if (access) return access;
      if (sql.includes("from brands") && sql.includes("for update")) return { rows: [{ id: scope.brandId }] };
      if (sql.includes("count(*)") && sql.includes("source_urls")) return { rows: [{ count: 10 }] };
      return {};
    });
    await expect(createAssetLibraryRepository(fake.pool).addReferenceUrl(scope, {
      url: "https://example.com/new", title: "new", contentPurpose: "both",
    })).rejects.toThrow("source_reference_limit_exceeded");
  });

  it("rejects duplicate origins and scopes every origin lookup to workspace and brand", async () => {
    const fake = fakePool((sql) => {
      const access = member(sql);
      if (access) return access;
      if (sql.includes("from brands") && sql.includes("for update")) return { rows: [{ id: scope.brandId }] };
      if (sql.includes("count(*)") && sql.includes("source_urls")) return { rows: [{ count: 2 }] };
      if (sql.includes("from source_urls") && sql.includes("url_hash")) return { rows: [{ id: "source-1" }] };
      if (sql.includes("from reference_items") && sql.includes("source_url_id")) return { rows: [{ id: "reference-1" }] };
      return {};
    });
    await expect(createAssetLibraryRepository(fake.pool).addReferenceUrl(scope, {
      url: "https://example.com/existing", title: "", contentPurpose: "informational",
    })).rejects.toThrow("reference_origin_duplicate");
    const lookup = fake.query.mock.calls.find(([sql]) => String(sql).includes("from reference_items"));
    expect(String(lookup?.[0])).toContain("workspace_id=$2");
    expect(String(lookup?.[0])).toContain("brand_id=$3");
  });

  it("requires a real saved trend author when creating a reference brand", async () => {
    const fake = fakePool((sql) => {
      const access = member(sql);
      if (access) return access;
      if (sql.includes("from instagram_trend_media")) {
        return { rows: [{ username: "", permalink: "https://www.instagram.com/p/1/" }] };
      }
      return {};
    });
    await expect(createAssetLibraryRepository(fake.pool).createReferenceBrandFromTrend({
      ...scope, mediaId: imageId,
    })).rejects.toThrow("reference_brand_author_unavailable");
  });

  it("lists reference-brand items from actual saved content and keeps patterns separate", async () => {
    const fake = fakePool((sql) => {
      if (sql.includes("select handle from reference_brands")) return { rows: [{ handle: "acme" }] };
      if (sql.includes("from reference_items item") && sql.includes("brand_trend_saved_media")) return { rows: [] };
      if (sql.includes("from reference_patterns")) return { rows: [] };
      return { rows: [] };
    });
    const repository = createAssetLibraryRepository(fake.pool);
    await repository.listReferenceBrandItems({
      workspaceId: scope.workspaceId, brandId: scope.brandId, referenceBrandId: imageId,
    });
    await repository.listReferences({
      workspaceId: scope.workspaceId, brandId: scope.brandId,
    }, {});
    const listSql = fake.query.mock.calls.map(([sql]) => String(sql)).find((sql) =>
      sql.includes("from reference_items item") && !sql.includes("brand_trend_saved_media"));
    expect(listSql).not.toContain("reference_patterns");
    expect(fake.query.mock.calls.some(([sql]) =>
      String(sql).includes("brand_trend_saved_media") && String(sql).includes("instagram_trend_media"),
    )).toBe(true);
  });
});
