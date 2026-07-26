import { describe, expect, it, vi } from "vitest";
import { createAssetLibraryRepository } from "./assetLibraryRepository.js";
import { createInstagramTrendRepository } from "./instagramTrendRepository.js";

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

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
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

  it("rejects a duplicate checksum before adding an image and rolls back", async () => {
    const fake = fakePool((sql) => {
      const access = member(sql);
      if (access) return access;
      if (sql.includes("from brand_avatars") && sql.includes("for update")) return { rows: [{ id: avatarId }] };
      if (sql.includes("from brand_avatar_images") && sql.includes("checksum")) return { rows: [{ id: imageId }] };
      return {};
    });

    await expect(createAssetLibraryRepository(fake.pool).addAvatarImage(
      { ...scope, avatarId },
      {
        fileName: "duplicate.webp",
        storagePath: `brands/${scope.brandId}/asset-library/avatars/x/${checksum}-duplicate.webp`,
        storageUrl: "https://store.blob.vercel-storage.com/duplicate.webp",
        mimeType: "image/webp",
        sizeBytes: 100,
        checksum,
        representative: false,
      },
    )).rejects.toThrow("avatar_image_duplicate");

    expect(fake.query.mock.calls.some(([sql]) => String(sql).includes("generate_series"))).toBe(false);
    expect(fake.query.mock.calls.some(([sql]) => String(sql).includes("insert into brand_avatar_images"))).toBe(false);
    expect(fake.query.mock.calls.some(([sql]) => String(sql).startsWith("rollback"))).toBe(true);
  });

  it("maps the database uniqueness race to the stable duplicate domain error", async () => {
    const fake = fakePool((sql) => {
      const access = member(sql);
      if (access) return access;
      if (sql.includes("from brand_avatars") && sql.includes("for update")) return { rows: [{ id: avatarId }] };
      if (sql.includes("from brand_avatar_images") && sql.includes("checksum=$4")) return { rows: [] };
      if (sql.includes("generate_series")) return { rows: [{ position: 2 }] };
      if (sql.includes("insert into brand_avatar_images")) {
        throw Object.assign(new Error("duplicate key"), {
          code: "23505",
          constraint: "brand_avatar_images_avatar_checksum_unique",
        });
      }
      return {};
    });

    await expect(createAssetLibraryRepository(fake.pool).addAvatarImage(
      { ...scope, avatarId },
      {
        fileName: "racing.webp",
        storagePath: `brands/${scope.brandId}/asset-library/avatars/x/${checksum}-racing.webp`,
        storageUrl: "https://store.blob.vercel-storage.com/racing.webp",
        mimeType: "image/webp",
        sizeBytes: 100,
        checksum,
        representative: false,
      },
    )).rejects.toThrow("avatar_image_duplicate");
    expect(fake.query.mock.calls.some(([sql]) => String(sql).startsWith("rollback"))).toBe(true);
  });

  it("atomically creates a reserved avatar from confirmed same-actor sessions", async () => {
    const first = "66666666-6666-4666-8666-666666666666";
    const second = "77777777-7777-4777-8777-777777777777";
    const checksums = new Map([[first, checksum], [second, "b".repeat(64)]]);
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
          expected_checksum: checksums.get(id), confirmed_at: new Date(), expires_at: new Date(Date.now() + 60_000),
        })) };
      }
      if (sql.includes("from storage_artifacts") && sql.includes("path like")) {
        return { rows: [first, second].map((id, index) => ({
          id: `artifact-${index}`, path: `${prefix(id)}${checksums.get(id)}-${index}.webp`,
          public_url: `https://store.blob.vercel-storage.com/${prefix(id)}${checksums.get(id)}-${index}.webp`,
          mime_type: "image/webp", byte_size: 100, checksum: checksums.get(id),
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

  it("rejects duplicate-byte staged sessions without creating an avatar or consuming sessions", async () => {
    const first = "66666666-6666-4666-8666-666666666666";
    const second = "77777777-7777-4777-8777-777777777777";
    const prefix = (sessionId: string) =>
      `brands/${scope.brandId}/asset-library/avatars/${avatarId}/${sessionId}/`;
    const fake = fakePool((sql) => {
      const access = member(sql);
      if (access) return access;
      if (sql.includes("from reference_upload_sessions") && sql.includes("for update")) {
        return { rows: [first, second].map((id) => ({
          id,
          workspace_id: scope.workspaceId,
          brand_id: scope.brandId,
          created_by_user_id: scope.actorUserId,
          storage_path_prefix: prefix(id),
          expected_mime_type: "image/webp",
          expected_size_bytes: 100,
          expected_checksum: checksum,
          confirmed_at: new Date(),
          expires_at: new Date(Date.now() + 60_000),
        })) };
      }
      if (sql.includes("from storage_artifacts") && sql.includes("path like")) {
        return { rows: [first, second].map((id, index) => ({
          id: `artifact-${index}`,
          path: `${prefix(id)}${checksum}-${index}.webp`,
          public_url: `https://store.blob.vercel-storage.com/${prefix(id)}${checksum}-${index}.webp`,
          mime_type: "image/webp",
          byte_size: 100,
          checksum,
          created_by_user_id: scope.actorUserId,
        })) };
      }
      return {};
    });

    await expect(createAssetLibraryRepository(fake.pool).createAvatar(scope, {
      avatarId,
      name: "중복 모델",
      description: "",
      imageSessionIds: [first, second],
      representativeSessionId: first,
    })).rejects.toThrow("avatar_image_duplicate");

    expect(fake.query.mock.calls.some(([sql]) => String(sql).includes("insert into brand_avatars"))).toBe(false);
    expect(fake.query.mock.calls.some(([sql]) => String(sql).includes("insert into brand_avatar_images"))).toBe(false);
    expect(fake.query.mock.calls.some(([sql]) => String(sql).includes("delete from reference_upload_sessions"))).toBe(false);
    expect(fake.query.mock.calls.some(([sql]) => String(sql).startsWith("rollback"))).toBe(true);
  });

  it.each([
    ["mixed actor", { created_by_user_id: "99999999-9999-4999-8999-999999999999" }, "asset_library_upload_actor_mismatch"],
    ["wrong reserved avatar", { storage_path_prefix: `brands/${scope.brandId}/asset-library/avatars/99999999-9999-4999-8999-999999999999/${imageId}/` }, "asset_library_upload_path_mismatch"],
    ["expired", { expires_at: new Date(Date.now() - 1) }, "asset_library_upload_expired"],
    ["unconfirmed", { confirmed_at: null }, "asset_library_upload_not_confirmed"],
    ["cancelled", { cancelled_at: new Date() }, "asset_library_upload_cancelled"],
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

  it("keeps cancellation pending through token expiry and does not remove its session early", async () => {
    const prefix = `brands/${scope.brandId}/asset-library/avatars/${avatarId}/${imageId}/`;
    const storagePath = `${prefix}${checksum}-face.webp`;
    const fake = fakePool((sql) => {
      const access = member(sql);
      if (access) return access;
      if (sql.includes("from avatar_upload_cancellation_receipts")) return { rows: [] };
      if (sql.includes("from reference_upload_sessions")) return { rows: [{
        id: imageId, workspace_id: scope.workspaceId, brand_id: scope.brandId,
        created_by_user_id: scope.actorUserId, storage_path_prefix: prefix, storage_path: storagePath,
      }] };
      if (sql.includes("from storage_artifacts")) return { rows: [{ id: "artifact-1", path: storagePath }] };
      return {};
    });
    const cleanupBlobs = vi.fn(async () => undefined);
    await expect(createAssetLibraryRepository(fake.pool).cancelAvatarUpload(
      { ...scope, avatarId, sessionId: imageId }, cleanupBlobs,
    )).resolves.toEqual({ status: "cleanup_pending", immediateCleanup: "succeeded" });
    expect(cleanupBlobs).toHaveBeenCalledWith(prefix, storagePath);
    const statements = fake.query.mock.calls.map(([sql]) => String(sql));
    expect(statements.some((sql) => sql.includes("pg_advisory_xact_lock"))).toBe(true);
    expect(statements.some((sql) => sql.includes("set cancelled_at=now()"))).toBe(true);
    expect(statements.some((sql) => sql.includes("delete from storage_artifacts"))).toBe(false);
    expect(statements.some((sql) => sql.includes("delete from reference_upload_sessions"))).toBe(false);
    expect(statements.some((sql) => sql.includes("insert into avatar_upload_cancellation_receipts"))).toBe(true);
  });

  it("finalizes a pending cancellation only after token expiry and removes a late blob", async () => {
    const prefix = `brands/${scope.brandId}/asset-library/avatars/${avatarId}/${imageId}/`;
    const storagePath = `${prefix}${checksum}-face.webp`;
    const fake = fakePool((sql) => {
      if (sql.includes("left join avatar_upload_cancellation_receipts")) return { rows: [{
        id: imageId, workspace_id: scope.workspaceId, brand_id: scope.brandId,
        created_by_user_id: scope.actorUserId, storage_path_prefix: prefix, storage_path: storagePath,
        expires_at: new Date(Date.now() - 1), receipt_status: "pending",
        avatar_id: avatarId,
      }] };
      return {};
    });
    const providerBlobs = new Set([storagePath]);
    const cleanupBlobs = vi.fn(async (scopedPrefix: string) => {
      for (const path of providerBlobs) if (path.startsWith(scopedPrefix)) providerBlobs.delete(path);
    });
    const result = await createAssetLibraryRepository(fake.pool)
      .cleanupExpiredAvatarUploads(cleanupBlobs, 100);
    expect(result).toEqual({ scanned: 1, cancelled: 1, failed: [] });
    expect(providerBlobs).toEqual(new Set());
    expect(fake.query.mock.calls.some(([sql]) =>
      String(sql).includes("set status='completed'"),
    )).toBe(true);
    expect(fake.query.mock.calls.some(([sql]) =>
      String(sql).includes("delete from reference_upload_sessions"),
    )).toBe(true);
  });

  it("persists pending cancellation when immediate blob cleanup fails", async () => {
    const prefix = `brands/${scope.brandId}/asset-library/avatars/${avatarId}/${imageId}/`;
    const storagePath = `${prefix}${checksum}-face.webp`;
    const fake = fakePool((sql) => {
      const access = member(sql);
      if (access) return access;
      if (sql.includes("from avatar_upload_cancellation_receipts")) return { rows: [] };
      if (sql.includes("from reference_upload_sessions")) return { rows: [{
        id: imageId, workspace_id: scope.workspaceId, brand_id: scope.brandId,
        created_by_user_id: scope.actorUserId, storage_path_prefix: prefix, storage_path: storagePath,
      }] };
      if (sql.includes("from storage_artifacts")) return { rows: [] };
      return {};
    });
    await expect(createAssetLibraryRepository(fake.pool).cancelAvatarUpload(
      { ...scope, avatarId, sessionId: imageId },
      async () => { throw new Error("asset_library_blob_delete_failed"); },
    )).resolves.toEqual({ status: "cleanup_pending", immediateCleanup: "retry_scheduled" });
    expect(fake.query.mock.calls.some(([sql]) =>
      String(sql).includes("set last_error=$2"),
    )).toBe(true);
    expect(fake.query.mock.calls.some(([sql]) => String(sql).includes("delete from reference_upload_sessions"))).toBe(false);
  });

  it("retries finalization when provider deletion succeeds but the database commit fails", async () => {
    const prefix = `brands/${scope.brandId}/asset-library/avatars/${avatarId}/${imageId}/`;
    const storagePath = `${prefix}${checksum}-face.webp`;
    let commitAttempts = 0;
    const fake = fakePool((sql) => {
      if (sql.includes("left join avatar_upload_cancellation_receipts")) return { rows: [{
        id: imageId, workspace_id: scope.workspaceId, brand_id: scope.brandId,
        created_by_user_id: scope.actorUserId, storage_path_prefix: prefix, storage_path: storagePath,
        expires_at: new Date(Date.now() - 60_000), receipt_status: "pending", avatar_id: avatarId,
      }] };
      if (sql === "commit" && commitAttempts++ === 0) throw new Error("database_commit_failed");
      return {};
    });
    const cleanupBlobs = vi.fn(async () => undefined);
    const repository = createAssetLibraryRepository(fake.pool);
    await expect(repository.cleanupExpiredAvatarUploads(cleanupBlobs, 1)).resolves.toEqual({
      scanned: 1,
      cancelled: 0,
      failed: [{ sessionId: imageId, error: "database_commit_failed" }],
    });
    await expect(repository.cleanupExpiredAvatarUploads(cleanupBlobs, 1)).resolves.toEqual({
      scanned: 1,
      cancelled: 1,
      failed: [],
    });
    expect(cleanupBlobs).toHaveBeenCalledTimes(2);
    expect(fake.query.mock.calls.filter(([sql]) => String(sql) === "rollback")).toHaveLength(1);
  });

  it("returns an actor-scoped pending receipt without deleting the blob twice", async () => {
    const deleteBlob = vi.fn(async () => undefined);
    const fake = fakePool((sql) => {
      const access = member(sql);
      if (access) return access;
      if (sql.includes("from avatar_upload_cancellation_receipts")) return { rows: [{
        session_id: imageId, workspace_id: scope.workspaceId, brand_id: scope.brandId,
        avatar_id: avatarId, created_by_user_id: scope.actorUserId, status: "pending",
      }] };
      return {};
    });
    await expect(createAssetLibraryRepository(fake.pool).cancelAvatarUpload(
      { ...scope, avatarId, sessionId: imageId }, deleteBlob,
    )).resolves.toEqual({ status: "cleanup_pending", immediateCleanup: "already_pending" });
    expect(deleteBlob).not.toHaveBeenCalled();
  });

  it("cancels a reference reservation with its own actor-scoped durable receipt", async () => {
    const prefix = `brands/${scope.brandId}/asset-library/references/${imageId}/`;
    const storagePath = `${prefix}${checksum}-brief.pdf`;
    const fake = fakePool((sql) => {
      const access = member(sql);
      if (access) return access;
      if (sql.includes("from reference_upload_cancellation_receipts")) return { rows: [] };
      if (sql.includes("from reference_upload_sessions")) return { rows: [{
        id: imageId, workspace_id: scope.workspaceId, brand_id: scope.brandId,
        created_by_user_id: scope.actorUserId, storage_path_prefix: prefix, storage_path: storagePath,
        expires_at: new Date(Date.now() + 60_000), confirmed_at: null, cancelled_at: null,
      }] };
      if (sql.includes("update reference_upload_sessions") && sql.includes("returning")) {
        return { rows: [{ id: imageId }] };
      }
      return {};
    });
    const cleanupBlobs = vi.fn(async () => undefined);

    await expect(createAssetLibraryRepository(fake.pool).cancelReferenceUpload(
      { ...scope, sessionId: imageId },
      cleanupBlobs,
    )).resolves.toEqual({ status: "cleanup_pending", immediateCleanup: "succeeded" });
    expect(cleanupBlobs).toHaveBeenCalledWith(prefix, storagePath);
    const statements = fake.query.mock.calls.map(([sql]) => String(sql));
    expect(statements.some((sql) => sql.includes("pg_advisory_xact_lock"))).toBe(true);
    expect(statements.some((sql) => sql.includes("insert into reference_upload_cancellation_receipts"))).toBe(true);
    expect(statements.some((sql) => sql.includes("insert into avatar_upload_cancellation_receipts"))).toBe(false);
    expect(statements.some((sql) => sql.includes("delete from reference_upload_sessions"))).toBe(false);
  });

  it("rejects reference cancellation by a different actor without touching storage", async () => {
    const prefix = `brands/${scope.brandId}/asset-library/references/${imageId}/`;
    const fake = fakePool((sql) => {
      const access = member(sql);
      if (access) return access;
      if (sql.includes("from reference_upload_cancellation_receipts")) return { rows: [] };
      if (sql.includes("from reference_upload_sessions")) return { rows: [{
        id: imageId, workspace_id: scope.workspaceId, brand_id: scope.brandId,
        created_by_user_id: "99999999-9999-4999-8999-999999999999",
        storage_path_prefix: prefix,
      }] };
      return {};
    });
    const cleanupBlobs = vi.fn(async () => undefined);

    await expect(createAssetLibraryRepository(fake.pool).cancelReferenceUpload(
      { ...scope, sessionId: imageId },
      cleanupBlobs,
    )).rejects.toThrow("asset_library_upload_actor_mismatch");
    expect(cleanupBlobs).not.toHaveBeenCalled();
  });

  it("finalizes a pathless reference receipt after token expiry by its exact prefix", async () => {
    const prefix = `brands/${scope.brandId}/asset-library/references/${imageId}/`;
    const fake = fakePool((sql) => {
      if (sql.includes("left join reference_upload_cancellation_receipts")) return { rows: [{
        id: imageId, workspace_id: scope.workspaceId, brand_id: scope.brandId,
        created_by_user_id: scope.actorUserId, storage_path_prefix: prefix, storage_path: null,
        expires_at: new Date(Date.now() - 60_000), receipt_status: "pending",
      }] };
      if (sql.includes("from reference_upload_cancellation_receipts") && sql.includes("for update")) {
        return { rows: [{
          session_id: imageId, workspace_id: scope.workspaceId, brand_id: scope.brandId,
          created_by_user_id: scope.actorUserId, status: "pending",
        }] };
      }
      if (sql.includes("from reference_upload_sessions") && sql.includes("for update")) return { rows: [{
        id: imageId, workspace_id: scope.workspaceId, brand_id: scope.brandId,
        created_by_user_id: scope.actorUserId, storage_path_prefix: prefix, storage_path: null,
      }] };
      if (sql.includes("update reference_upload_cancellation_receipts")
        && sql.includes("next_attempt_at") && sql.includes("returning")) {
        return { rows: [{ session_id: imageId }] };
      }
      if (sql.includes("from reference_items") && sql.includes("storage_artifacts")) return { rows: [] };
      return {};
    });
    const cleanupBlobs = vi.fn(async () => undefined);

    await expect(createAssetLibraryRepository(fake.pool).cleanupExpiredReferenceUploads(cleanupBlobs, 1))
      .resolves.toEqual({ scanned: 1, cancelled: 1, preserved: 0, failed: [] });
    expect(cleanupBlobs).toHaveBeenCalledWith(prefix, undefined);
    expect(fake.query.mock.calls[0]?.[1]).toEqual([1]);
    const statements = fake.query.mock.calls.map(([sql]) => String(sql));
    expect(statements.some((sql) =>
      sql.includes("from reference_upload_cancellation_receipts") && sql.includes("for update"),
    )).toBe(true);
    expect(statements.some((sql) =>
      sql.includes("update reference_upload_cancellation_receipts")
        && sql.includes("next_attempt_at") && sql.includes("returning"),
    )).toBe(true);
  });

  it("preserves an upload artifact that a confirmed reference already consumes", async () => {
    const prefix = `brands/${scope.brandId}/asset-library/references/${imageId}/`;
    const storagePath = `${prefix}${checksum}-brief.pdf`;
    const fake = fakePool((sql) => {
      if (sql.includes("left join reference_upload_cancellation_receipts")) return { rows: [{
        id: imageId, workspace_id: scope.workspaceId, brand_id: scope.brandId,
        created_by_user_id: scope.actorUserId, storage_path_prefix: prefix, storage_path: storagePath,
        expires_at: new Date(Date.now() - 60_000), receipt_status: "pending",
      }] };
      if (sql.includes("from reference_upload_cancellation_receipts") && sql.includes("for update")) {
        return { rows: [{
          session_id: imageId, workspace_id: scope.workspaceId, brand_id: scope.brandId,
          created_by_user_id: scope.actorUserId, status: "pending",
        }] };
      }
      if (sql.includes("from reference_upload_sessions") && sql.includes("for update")) return { rows: [{
        id: imageId, workspace_id: scope.workspaceId, brand_id: scope.brandId,
        created_by_user_id: scope.actorUserId, storage_path_prefix: prefix, storage_path: storagePath,
      }] };
      if (sql.includes("update reference_upload_cancellation_receipts")
        && sql.includes("next_attempt_at") && sql.includes("returning")) {
        return { rows: [{ session_id: imageId }] };
      }
      if (sql.includes("from reference_items") && sql.includes("storage_artifacts")) {
        return { rows: [{ id: "reference-1" }] };
      }
      return {};
    });
    const cleanupBlobs = vi.fn(async () => undefined);

    await expect(createAssetLibraryRepository(fake.pool).cleanupExpiredReferenceUploads(cleanupBlobs, 1))
      .resolves.toEqual({ scanned: 1, cancelled: 0, preserved: 1, failed: [] });
    expect(cleanupBlobs).not.toHaveBeenCalled();
    expect(fake.query.mock.calls.some(([sql]) => String(sql).includes("delete from storage_artifacts"))).toBe(false);
    expect(fake.query.mock.calls.some(([sql]) => String(sql).includes("set status='completed'"))).toBe(true);
  });

  it("serializes reference confirmation against cancellation before locking the session", async () => {
    const prefix = `brands/${scope.brandId}/asset-library/references/${imageId}/`;
    const fake = fakePool((sql) => {
      const access = member(sql);
      if (access) return access;
      if (sql.includes("from reference_upload_sessions")) return { rows: [{
        id: imageId, workspace_id: scope.workspaceId, brand_id: scope.brandId,
        created_by_user_id: scope.actorUserId, storage_path_prefix: prefix,
        expires_at: new Date(Date.now() + 60_000), confirmed_at: null, cancelled_at: null,
      }] };
      if (sql.includes("insert into storage_artifacts")) return { rows: [{ id: "artifact-1" }] };
      if (sql.includes("insert into reference_items")) return { rows: [{
        id: "reference-1", workspace_id: scope.workspaceId, brand_id: scope.brandId,
        kind: "upload", content_purpose: "both", origin: "Upload", title: "brief.pdf",
        preview_url: null, source_url: `https://store.blob.vercel-storage.com/${prefix}${checksum}-brief.pdf`,
        format: "application/pdf", metadata: { fileName: "brief.pdf" }, is_favorite: false,
        archived_at: null, reference_brand_id: null, created_at: new Date(), updated_at: new Date(),
      }] };
      return {};
    });

    await createAssetLibraryRepository(fake.pool).confirmReferenceUpload(
      { ...scope, sessionId: imageId },
      {
        fileName: "brief.pdf", storagePath: `${prefix}${checksum}-brief.pdf`,
        storageUrl: `https://store.blob.vercel-storage.com/${prefix}${checksum}-brief.pdf`,
        mimeType: "application/pdf", sizeBytes: 100, checksum,
      },
    );
    const statements = fake.query.mock.calls.map(([sql]) => String(sql));
    expect(statements.findIndex((sql) => sql.includes("pg_advisory_xact_lock")))
      .toBeLessThan(statements.findIndex((sql) => sql.includes("from reference_upload_sessions")));
  });

  it.each([
    ["consumed", null, "asset_library_upload_session_not_found"],
    ["foreign actor", "99999999-9999-4999-8999-999999999999", "asset_library_upload_actor_mismatch"],
  ])("rejects %s upload cancellation without touching storage", async (_label, actor, expected) => {
    const prefix = `brands/${scope.brandId}/asset-library/avatars/${avatarId}/${imageId}/`;
    const fake = fakePool((sql) => {
      const access = member(sql);
      if (access) return access;
      if (sql.includes("from avatar_upload_cancellation_receipts")) return { rows: [] };
      if (sql.includes("from reference_upload_sessions")) {
        return actor ? { rows: [{
          id: imageId, workspace_id: scope.workspaceId, brand_id: scope.brandId,
          created_by_user_id: actor, storage_path_prefix: prefix,
        }] } : { rows: [] };
      }
      return {};
    });
    const deleteBlob = vi.fn(async () => undefined);
    await expect(createAssetLibraryRepository(fake.pool).cancelAvatarUpload(
      { ...scope, avatarId, sessionId: imageId }, deleteBlob,
    )).rejects.toThrow(expected);
    expect(deleteBlob).not.toHaveBeenCalled();
  });

  it("sweeps only expired avatar sessions and reports retriable cleanup failures", async () => {
    const first = imageId;
    const second = "66666666-6666-4666-8666-666666666666";
    const prefix = (id: string) => `brands/${scope.brandId}/asset-library/avatars/${avatarId}/${id}/`;
    const fake = fakePool((sql, values) => {
      if (sql.includes("left join avatar_upload_cancellation_receipts")) return { rows: [first, second].map((id) => ({
        id, workspace_id: scope.workspaceId, brand_id: scope.brandId,
        created_by_user_id: scope.actorUserId, storage_path_prefix: prefix(id),
        storage_path: `${prefix(id)}${checksum}-face.webp`,
        expires_at: new Date(Date.now() - 1), receipt_status: null, avatar_id: avatarId,
      })) };
      if (sql.includes("from avatar_upload_cancellation_receipts")) return { rows: [] };
      if (sql.includes("from reference_upload_sessions")) {
        const id = String(values[0]);
        return { rows: [{
          id, workspace_id: scope.workspaceId, brand_id: scope.brandId,
          created_by_user_id: scope.actorUserId, storage_path_prefix: prefix(id),
          storage_path: `${prefix(id)}${checksum}-face.webp`,
          expires_at: new Date(Date.now() - 1), cancelled_at: null,
        }] };
      }
      if (sql.includes("update reference_upload_sessions") && sql.includes("returning")) {
        const id = String(values[0]);
        return { rows: [{
          id, workspace_id: scope.workspaceId, brand_id: scope.brandId,
          created_by_user_id: scope.actorUserId, storage_path_prefix: prefix(id),
          storage_path: `${prefix(id)}${checksum}-face.webp`,
          expires_at: new Date(Date.now() - 1), cancelled_at: new Date(),
        }] };
      }
      if (sql.includes("insert into avatar_upload_cancellation_receipts")) {
        return { rows: [{ session_id: values[0] }] };
      }
      if (sql.includes("from storage_artifacts")) return { rows: [] };
      return {};
    });
    const deleteBlob = vi.fn(async (pathPrefix: string) => {
      if (pathPrefix.includes(second)) throw new Error("asset_library_blob_delete_failed");
    });
    const result = await createAssetLibraryRepository(fake.pool).cleanupExpiredAvatarUploads(deleteBlob, 2);
    expect(result).toEqual({
      scanned: 2,
      cancelled: 1,
      failed: [{ sessionId: second, error: "asset_library_blob_delete_failed" }],
    });
    expect(fake.query.mock.calls[0]?.[1]).toEqual([2]);
  });

  it("does not create a receipt or clean blobs when the expiry transition affects zero rows", async () => {
    const prefix = `brands/${scope.brandId}/asset-library/avatars/${avatarId}/${imageId}/`;
    let receiptInserted = false;
    const fake = fakePool((sql) => {
      if (sql.includes("left join avatar_upload_cancellation_receipts")) return { rows: [{
        id: imageId, workspace_id: scope.workspaceId, brand_id: scope.brandId,
        created_by_user_id: scope.actorUserId, storage_path_prefix: prefix,
        storage_path: `${prefix}${checksum}-face.webp`,
        expires_at: new Date(Date.now() - 1), receipt_status: null, avatar_id: avatarId,
      }] };
      if (sql.includes("from avatar_upload_cancellation_receipts") && sql.includes("for update")) {
        return { rows: [] };
      }
      if (sql.includes("from reference_upload_sessions") && sql.includes("for update")) {
        return { rows: [{
          id: imageId, workspace_id: scope.workspaceId, brand_id: scope.brandId,
          created_by_user_id: scope.actorUserId, storage_path_prefix: prefix,
          storage_path: `${prefix}${checksum}-face.webp`,
          expires_at: new Date(Date.now() - 1), cancelled_at: null,
        }] };
      }
      if (sql.includes("update reference_upload_sessions") && sql.includes("returning")) {
        return { rowCount: 0 };
      }
      if (sql.includes("insert into avatar_upload_cancellation_receipts")) receiptInserted = true;
      return {};
    });
    const cleanupBlobs = vi.fn(async () => undefined);

    await expect(createAssetLibraryRepository(fake.pool).cleanupExpiredAvatarUploads(cleanupBlobs, 1))
      .resolves.toEqual({ scanned: 1, cancelled: 0, failed: [] });
    expect(receiptInserted).toBe(false);
    expect(cleanupBlobs).not.toHaveBeenCalled();
  });

  it("preserves a created avatar when its locked session expires before the sweep acquires it", async () => {
    const prefix = `brands/${scope.brandId}/asset-library/avatars/${avatarId}/${imageId}/`;
    const storagePath = `${prefix}${checksum}-face.webp`;
    const session = {
      id: imageId, workspace_id: scope.workspaceId, brand_id: scope.brandId,
      created_by_user_id: scope.actorUserId, storage_path_prefix: prefix, storage_path: storagePath,
      expected_mime_type: "image/webp", expected_size_bytes: 100, expected_checksum: checksum,
      confirmed_at: new Date(500), expires_at: new Date(2_000), cancelled_at: null,
    };
    const artifact = {
      id: "artifact-1", path: storagePath,
      public_url: `https://store.blob.vercel-storage.com/${storagePath}`,
      mime_type: "image/webp", byte_size: 100, checksum,
      created_by_user_id: scope.actorUserId,
    };
    const createValidated = deferred();
    const allowCreateCommit = deferred();
    const sweepWaitingForSession = deferred();
    const createReleasedSession = deferred();
    const cleanupCalled = deferred<"cleanup">();
    let sessionExists = true;
    let receiptInserted = false;
    let connectionCount = 0;
    let avatarImageInserted = false;

    const makeClient = (connection: number) => ({
      query: vi.fn(async (rawSql: string, values: unknown[] = []) => {
        const sql = rawSql.replace(/\s+/g, " ").trim();
        const access = member(sql);
        if (access) return { rows: access.rows, rowCount: access.rows.length };
        if (connection === 1 && sql.includes("id=any($1::uuid[])") && sql.includes("for update")) {
          return { rows: [session], rowCount: 1 };
        }
        if (connection === 1 && sql.includes("from storage_artifacts") && sql.includes("path like any")) {
          createValidated.resolve();
          await allowCreateCommit.promise;
          return { rows: [artifact], rowCount: 1 };
        }
        if (connection === 1 && sql.includes("insert into brand_avatars")) {
          return { rows: [{ id: values[0] }], rowCount: 1 };
        }
        if (connection === 1 && sql.includes("insert into brand_avatar_images")) {
          avatarImageInserted = true;
          return { rows: [], rowCount: 1 };
        }
        if (connection === 1 && sql.includes("delete from reference_upload_sessions")) {
          sessionExists = false;
          return { rows: [], rowCount: 1 };
        }
        if (connection === 1 && sql.includes("from brand_avatars avatar")) {
          return { rows: [{
            id: avatarId, workspace_id: scope.workspaceId, brand_id: scope.brandId,
            name: "모델", description: "", is_default: false, status: "active",
            created_by_user_id: scope.actorUserId, created_at: new Date(), updated_at: new Date(),
            images: [artifact],
          }], rowCount: 1 };
        }
        if (connection === 1 && sql === "commit") {
          createReleasedSession.resolve();
          return { rows: [], rowCount: 0 };
        }
        if (connection === 2 && sql.includes("from avatar_upload_cancellation_receipts")
          && sql.includes("for update")) {
          return { rows: [], rowCount: 0 };
        }
        if (connection === 2 && sql.includes("from reference_upload_sessions")
          && sql.includes("for update")) {
          sweepWaitingForSession.resolve();
          await createReleasedSession.promise;
          return { rows: sessionExists ? [session] : [], rowCount: sessionExists ? 1 : 0 };
        }
        if (sql.includes("insert into avatar_upload_cancellation_receipts")) receiptInserted = true;
        return { rows: [], rowCount: 0 };
      }),
      release: vi.fn(),
    });
    const pool = {
      query: vi.fn(async (rawSql: string) => {
        const sql = rawSql.replace(/\s+/g, " ").trim();
        if (sql.includes("left join avatar_upload_cancellation_receipts")) {
          return {
            rows: [{
              ...session, expires_at: new Date(2_000), receipt_status: null, avatar_id: avatarId,
            }],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      }),
      connect: vi.fn(async () => makeClient(++connectionCount)),
    };
    const cleanupBlobs = vi.fn(async () => {
      cleanupCalled.resolve("cleanup");
    });
    const clock = vi.spyOn(Date, "now").mockReturnValue(1_000);
    const repository = createAssetLibraryRepository(pool as never);

    const creating = repository.createAvatar(scope, {
      avatarId, name: "모델", description: "", imageSessionIds: [imageId],
      representativeSessionId: imageId,
    });
    await createValidated.promise;
    clock.mockReturnValue(3_000);
    const sweeping = repository.cleanupExpiredAvatarUploads(cleanupBlobs, 1);

    try {
      const firstEvent = await Promise.race([
        sweepWaitingForSession.promise.then(() => "waiting_on_create_lock" as const),
        cleanupCalled.promise,
      ]);
      expect(firstEvent).toBe("waiting_on_create_lock");
    } finally {
      allowCreateCommit.resolve();
    }

    const [created, swept] = await Promise.all([creating, sweeping]);
    expect(created.id).toBe(avatarId);
    expect(swept).toEqual({ scanned: 1, cancelled: 0, failed: [] });
    expect(avatarImageInserted).toBe(true);
    expect(sessionExists).toBe(false);
    expect(receiptInserted).toBe(false);
    expect(cleanupBlobs).not.toHaveBeenCalled();
    clock.mockRestore();
  });

  it("uses the exact legacy reservation prefix when file and storage paths are null", async () => {
    const prefix = `brands/${scope.brandId}/asset-library/avatars/${avatarId}/${imageId}/`;
    const fake = fakePool((sql, values) => {
      if (sql.includes("left join avatar_upload_cancellation_receipts")) return { rows: [{
        id: imageId, workspace_id: scope.workspaceId, brand_id: scope.brandId,
        created_by_user_id: scope.actorUserId, storage_path_prefix: prefix,
        storage_path: null, file_name: null, expires_at: new Date(Date.now() - 1),
        receipt_status: null, avatar_id: avatarId,
      }] };
      if (sql.includes("from avatar_upload_cancellation_receipts") && sql.includes("for update")) {
        return { rows: [] };
      }
      if (sql.includes("from reference_upload_sessions") && sql.includes("for update")) {
        return { rows: [{
          id: imageId, workspace_id: scope.workspaceId, brand_id: scope.brandId,
          created_by_user_id: scope.actorUserId, storage_path_prefix: prefix,
          storage_path: null, expires_at: new Date(Date.now() - 1), cancelled_at: null,
        }] };
      }
      if (sql.includes("update reference_upload_sessions") && sql.includes("returning")) {
        return { rows: [{
          id: imageId, workspace_id: scope.workspaceId, brand_id: scope.brandId,
          created_by_user_id: scope.actorUserId, storage_path_prefix: prefix,
          storage_path: null, expires_at: new Date(Date.now() - 1), cancelled_at: new Date(),
        }] };
      }
      if (sql.includes("insert into avatar_upload_cancellation_receipts")) {
        return { rows: [{ session_id: values[0] }] };
      }
      return {};
    });
    const cleanupBlobs = vi.fn(async () => undefined);
    await createAssetLibraryRepository(fake.pool).cleanupExpiredAvatarUploads(cleanupBlobs, 100);
    expect(cleanupBlobs).toHaveBeenCalledWith(prefix, undefined);
  });

  it("backs off failed cleanup rows so newer expired sessions can enter the next batch", async () => {
    const oldIds = Array.from({ length: 100 }, (_, index) =>
      `00000000-0000-4000-8${String(index).padStart(3, "0")}-${String(index).padStart(12, "0")}`);
    const healthy = "99999999-9999-4999-8999-999999999999";
    let selection = 0;
    const fake = fakePool((sql, values) => {
      if (sql.includes("left join avatar_upload_cancellation_receipts")) {
        selection += 1;
        const ids = selection === 1 ? oldIds : [healthy];
        return { rows: ids.map((id) => ({
          id, workspace_id: scope.workspaceId, brand_id: scope.brandId,
          created_by_user_id: scope.actorUserId,
          storage_path_prefix: `brands/${scope.brandId}/asset-library/avatars/${avatarId}/${id}/`,
          expires_at: new Date(Date.now() - 1), receipt_status: null, avatar_id: avatarId,
        })) };
      }
      if (sql.includes("from avatar_upload_cancellation_receipts") && sql.includes("for update")) {
        return { rows: [] };
      }
      if (sql.includes("from reference_upload_sessions") && sql.includes("for update")) {
        const id = String(values[0]);
        return { rows: [{
          id, workspace_id: scope.workspaceId, brand_id: scope.brandId,
          created_by_user_id: scope.actorUserId,
          storage_path_prefix: `brands/${scope.brandId}/asset-library/avatars/${avatarId}/${id}/`,
          storage_path: null, expires_at: new Date(Date.now() - 1), cancelled_at: null,
        }] };
      }
      if (sql.includes("update reference_upload_sessions") && sql.includes("returning")) {
        const id = String(values[0]);
        return { rows: [{
          id, workspace_id: scope.workspaceId, brand_id: scope.brandId,
          created_by_user_id: scope.actorUserId,
          storage_path_prefix: `brands/${scope.brandId}/asset-library/avatars/${avatarId}/${id}/`,
          storage_path: null, expires_at: new Date(Date.now() - 1), cancelled_at: new Date(),
        }] };
      }
      if (sql.includes("insert into avatar_upload_cancellation_receipts")) {
        return { rows: [{ session_id: values[0] }] };
      }
      return {};
    });
    const cleanupBlobs = vi.fn(async (prefix: string) => {
      if (!prefix.includes(healthy)) throw new Error("asset_library_blob_delete_failed");
    });
    const repository = createAssetLibraryRepository(fake.pool);
    const first = await repository.cleanupExpiredAvatarUploads(cleanupBlobs, 100);
    const second = await repository.cleanupExpiredAvatarUploads(cleanupBlobs, 100);
    expect(first.failed).toHaveLength(100);
    expect(second.cancelled).toBe(1);
    expect(fake.query.mock.calls.some(([sql]) =>
      String(sql).includes("next_attempt_at") && String(sql).includes("attempt_count"),
    )).toBe(true);
  });

  it("rolls back an existing-avatar duplicate without consuming its upload session", async () => {
    const prefix = `brands/${scope.brandId}/asset-library/avatars/${avatarId}/${imageId}/`;
    const fake = fakePool((sql) => {
      const access = member(sql);
      if (access) return access;
      if (sql.includes("from reference_upload_sessions")) return { rows: [{
        id: imageId,
        workspace_id: scope.workspaceId,
        brand_id: scope.brandId,
        created_by_user_id: scope.actorUserId,
        storage_path_prefix: prefix,
        confirmed_at: null,
        expires_at: new Date(Date.now() + 60_000),
      }] };
      if (sql.includes("from brand_avatars") && sql.includes("for update")) return { rows: [{ id: avatarId }] };
      if (sql.includes("from brand_avatar_images") && sql.includes("checksum=$4")) {
        return { rows: [{ id: "existing-image" }] };
      }
      return {};
    });

    await expect(createAssetLibraryRepository(fake.pool).confirmAvatarUpload(
      { ...scope, avatarId, sessionId: imageId },
      {
        fileName: "duplicate.webp",
        storagePath: `${prefix}${checksum}-duplicate.webp`,
        storageUrl: `https://store.blob.vercel-storage.com/${prefix}${checksum}-duplicate.webp`,
        mimeType: "image/webp",
        sizeBytes: 100,
        checksum,
        representative: false,
      },
    )).rejects.toThrow("avatar_image_duplicate");

    expect(fake.query.mock.calls.some(([sql]) => String(sql).includes("insert into brand_avatar_images"))).toBe(false);
    expect(fake.query.mock.calls.some(([sql]) =>
      String(sql).includes("update reference_upload_sessions set confirmed_at"),
    )).toBe(false);
    expect(fake.query.mock.calls.some(([sql]) =>
      String(sql).includes("delete from reference_upload_sessions"),
    )).toBe(false);
    expect(fake.query.mock.calls.some(([sql]) => String(sql).startsWith("rollback"))).toBe(true);
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

  it("archives a canonical URL source, frees quota, and restores the same item on re-add", async () => {
    const referenceId = "88888888-8888-4888-8888-888888888888";
    const sourceId = "99999999-9999-4999-8999-999999999999";
    let archived = false;
    let sourceEnabled = true;
    const row = () => ({
      id: referenceId, workspace_id: scope.workspaceId, brand_id: scope.brandId,
      kind: "external_url", content_purpose: "both", origin: "example.com",
      title: "Example", preview_url: null, source_url: "https://example.com/a",
      format: "url", metadata: {}, is_favorite: false,
      archived_at: archived ? new Date() : null, reference_brand_id: null,
      source_url_id: sourceId, created_at: new Date(), updated_at: new Date(),
    });
    const fake = fakePool((sql) => {
      const access = member(sql, "admin");
      if (access) return access;
      if (sql.includes("from reference_items") && sql.includes("for update")) {
        return { rows: [row()] };
      }
      if (sql.includes("update reference_items") && sql.includes("archived_at=now()")) {
        archived = true;
        return { rowCount: 1 };
      }
      if (sql.includes("update source_urls") && sql.includes("enabled=false")) {
        sourceEnabled = false;
        return { rowCount: 1 };
      }
      if (sql.includes("from brands") && sql.includes("for update")) return { rows: [{ id: scope.brandId }] };
      if (sql.includes("count(*)") && sql.includes("source_urls")) {
        return { rows: [{ count: sourceEnabled ? 10 : 9 }] };
      }
      if (sql.includes("from source_urls") && sql.includes("url_hash")) return { rows: [{ id: sourceId }] };
      if (sql.includes("from reference_items") && sql.includes("source_url_id")) return { rows: [row()] };
      if (sql.includes("update source_urls") && sql.includes("enabled=true")) {
        sourceEnabled = true;
        return { rowCount: 1 };
      }
      if (sql.includes("update reference_items") && sql.includes("archived_at=null")) {
        archived = false;
        return { rows: [row()] };
      }
      return {};
    });
    const repository = createAssetLibraryRepository(fake.pool);

    await repository.archiveReference({ ...scope, referenceId });
    expect(sourceEnabled).toBe(false);

    const restored = await repository.addReferenceUrl(scope, {
      url: "https://example.com/a", title: "Example", contentPurpose: "both",
    });
    expect(restored.id).toBe(referenceId);
    expect(sourceEnabled).toBe(true);
    expect(archived).toBe(false);
    expect(fake.query.mock.calls.filter(([sql]) =>
      String(sql).includes("insert into reference_items"),
    )).toHaveLength(0);
  });

  it("does not disable source URLs when archiving a saved trend projection", async () => {
    const savedId = "66666666-6666-4666-8666-666666666666";
    const fake = fakePool((sql) => {
      const access = member(sql, "admin");
      if (access) return access;
      if (sql.includes("from reference_items")) {
        return { rows: [{
          id: imageId, kind: "trend", source_url_id: null,
          saved_trend_id: savedId,
          workspace_id: scope.workspaceId, brand_id: scope.brandId,
        }] };
      }
      if (sql.includes("from brand_trend_saved_media") && sql.includes("for update")) {
        return { rows: [{ id: savedId }] };
      }
      if (sql.includes("archive_brand_trend_saved_reference")) {
        return { rows: [{ reference_item_id: imageId }] };
      }
      if (sql.includes("delete from brand_trend_saved_media")) return { rows: [{ id: savedId }] };
      return {};
    });
    await createAssetLibraryRepository(fake.pool).archiveReference({
      ...scope, referenceId: imageId,
    });
    expect(fake.query.mock.calls.some(([sql]) =>
      String(sql).includes("update source_urls"),
    )).toBe(false);
  });

  it("locks a saved trend row before its canonical reference during archive", async () => {
    const savedId = "66666666-6666-4666-8666-666666666666";
    const fake = fakePool((sql) => {
      const access = member(sql, "admin");
      if (access) return access;
      if (sql.includes("from reference_items") && !sql.includes("for update")) {
        return { rows: [{
          id: imageId, kind: "trend", source_url_id: null, saved_trend_id: savedId,
        }] };
      }
      if (sql.includes("from brand_trend_saved_media") && sql.includes("for update")) {
        return { rows: [{ id: savedId }] };
      }
      if (sql.includes("from reference_items") && sql.includes("for update")) {
        return { rows: [{
          id: imageId, kind: "trend", source_url_id: null, saved_trend_id: savedId,
        }] };
      }
      if (sql.includes("archive_brand_trend_saved_reference")) {
        return { rows: [{ reference_item_id: imageId }] };
      }
      if (sql.includes("delete from brand_trend_saved_media")) return { rows: [{ id: savedId }] };
      return {};
    });

    await createAssetLibraryRepository(fake.pool).archiveReference({
      ...scope, referenceId: imageId,
    });

    const rowLocks = fake.query.mock.calls
      .map(([sql]) => String(sql).replace(/\s+/g, " ").trim())
      .filter((sql) => sql.includes("for update") && (
        sql.includes("brand_trend_saved_media") || sql.includes("reference_items")
      ));
    expect(rowLocks).toHaveLength(2);
    expect(rowLocks[0]).toContain("brand_trend_saved_media");
    expect(rowLocks[1]).toContain("reference_items");
  });

  it.each(["remove", "resave"] as const)(
    "serializes canonical archive with legacy %s without a lock cycle",
    async (legacyOperation) => {
    const savedId = "66666666-6666-4666-8666-666666666666";
    const state = { saved: true, archived: false, sourceEnabled: true };
    const owners = new Map<string, number>();
    const held = new Map<number, Set<string>>();
    const waiters = new Map<string, Array<() => void>>();
    const firstRequests = new Set<number>();
    const bothRequested = deferred();
    let nextClientId = 0;

    async function acquire(key: "saved" | "reference", clientId: number) {
      if (!firstRequests.has(clientId)) {
        firstRequests.add(clientId);
        if (firstRequests.size === 2) bothRequested.resolve();
        await bothRequested.promise;
      }
      while (owners.has(key) && owners.get(key) !== clientId) {
        await new Promise<void>((resolve) => {
          waiters.set(key, [...(waiters.get(key) ?? []), resolve]);
        });
      }
      owners.set(key, clientId);
      held.set(clientId, new Set([...(held.get(clientId) ?? []), key]));
    }

    function release(clientId: number) {
      for (const key of held.get(clientId) ?? []) {
        if (owners.get(key) === clientId) owners.delete(key);
        for (const wake of waiters.get(key) ?? []) wake();
        waiters.delete(key);
      }
      held.delete(clientId);
    }

    const pool = {
      async connect() {
        const clientId = ++nextClientId;
        return {
          async query(rawSql: string) {
            const sql = rawSql.replace(/\s+/g, " ").trim();
            if (["begin", "rollback"].includes(sql)) {
              if (sql === "rollback") release(clientId);
              return { rows: [], rowCount: 0 };
            }
            if (sql === "commit") {
              release(clientId);
              return { rows: [], rowCount: 0 };
            }
            if (sql.includes("from workspace_members")) {
              return { rows: [{ role: "admin" }], rowCount: 1 };
            }
            if (sql.includes("select workspace_id from brands")) {
              return { rows: [{ workspace_id: scope.workspaceId }], rowCount: 1 };
            }
            if (sql.includes("from instagram_trend_media media")) {
              return {
                rows: [{
                  id: imageId,
                  instagram_media_id: "ig-lock-order",
                  username: "creator",
                  caption: "lock order",
                  media_type: "IMAGE",
                  media_url: "https://cdn.example.com/lock.webp",
                  permalink: "https://www.instagram.com/p/lock-order/",
                  posted_at: new Date(),
                  like_count: 1,
                  comments_count: 0,
                  raw_metadata: {},
                }],
                rowCount: 1,
              };
            }
            if (sql.includes("from source_urls") && sql.includes("url_hash")) {
              return {
                rows: [{
                  id: avatarId,
                  brand_id: scope.brandId,
                  source_type: "reference",
                  url: "https://www.instagram.com/p/lock-order/",
                  title: "lock order",
                  status: state.sourceEnabled ? "crawled" : "disabled",
                  enabled: state.sourceEnabled,
                  last_crawled_at: new Date(),
                  last_error: null,
                }],
                rowCount: 1,
              };
            }
            if (sql.includes("update source_urls") && sql.includes("enabled = true")) {
              state.sourceEnabled = true;
              return {
                rows: [{
                  id: avatarId,
                  brand_id: scope.brandId,
                  source_type: "reference",
                  url: "https://www.instagram.com/p/lock-order/",
                  title: "lock order",
                  status: "crawled",
                  enabled: true,
                  last_crawled_at: new Date(),
                  last_error: null,
                }],
                rowCount: 1,
              };
            }
            if (sql.includes("insert into brand_trend_saved_media")) {
              return state.saved
                ? { rows: [], rowCount: 0 }
                : (() => {
                  state.saved = true;
                  return { rows: [{ id: savedId }], rowCount: 1 };
                })();
            }
            if (sql.includes("from reference_items") && !sql.includes("for update")) {
              return state.archived
                ? { rows: [], rowCount: 0 }
                : { rows: [{ id: imageId, kind: "trend", source_url_id: null, saved_trend_id: savedId }], rowCount: 1 };
            }
            if (sql.includes("from brand_trend_saved_media") && sql.includes("for update")) {
              await acquire("saved", clientId);
              return state.saved
                ? { rows: [{ id: savedId }], rowCount: 1 }
                : { rows: [], rowCount: 0 };
            }
            if (sql.includes("from reference_items") && sql.includes("for update")) {
              await acquire("reference", clientId);
              return !state.archived && state.saved
                ? { rows: [{ id: imageId, kind: "trend", source_url_id: null, saved_trend_id: savedId }], rowCount: 1 }
                : { rows: [], rowCount: 0 };
            }
            if (sql.includes("archive_brand_trend_saved_reference")) {
              await acquire("saved", clientId);
              await acquire("reference", clientId);
              if (!state.saved) return { rows: [{ reference_item_id: null }], rowCount: 1 };
              state.archived = true;
              state.sourceEnabled = false;
              return { rows: [{ reference_item_id: imageId }], rowCount: 1 };
            }
            if (sql.includes("upsert_brand_trend_saved_reference")) {
              await acquire("saved", clientId);
              await acquire("reference", clientId);
              if (!state.saved) return { rows: [{ reference_item_id: null }], rowCount: 1 };
              state.archived = false;
              state.sourceEnabled = true;
              return { rows: [{ reference_item_id: imageId }], rowCount: 1 };
            }
            if (sql.includes("insert into source_snapshots")) {
              return { rows: [{ id: "snapshot-1" }], rowCount: 1 };
            }
            if (sql.includes("delete from brand_trend_saved_media")) {
              const existed = state.saved;
              state.saved = false;
              return existed
                ? { rows: [{ id: savedId, trend_media_id: imageId }], rowCount: 1 }
                : { rows: [], rowCount: 0 };
            }
            throw new Error(`unexpected query: ${sql}`);
          },
          release() {},
        };
      },
    };
    const assets = createAssetLibraryRepository(pool as never);
    const trends = createInstagramTrendRepository({
      pool: pool as never,
      decryptCredential: String,
      fetchTopMedia: vi.fn() as never,
    });

    const legacyPromise = legacyOperation === "remove"
      ? trends.removeInstagramTrendSource(scope.brandId, imageId, scope.actorUserId)
      : trends.saveInstagramTrendSource(scope.brandId, imageId, scope.actorUserId);
    const settled = await Promise.race([
      Promise.allSettled([
        assets.archiveReference({ ...scope, referenceId: imageId }),
        legacyPromise,
      ]),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("lock_order_deadlock")), 1_000)),
    ]);

    expect(settled.some((result) => result.status === "fulfilled")).toBe(true);
    expect(settled.filter((result) => result.status === "rejected").every((result) =>
      /reference_not_found|instagram_trend_source_save_failed/.test(
        String((result as PromiseRejectedResult).reason),
      ))).toBe(true);
    expect(state).toEqual({ saved: false, archived: true, sourceEnabled: false });
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
    expect(listSql).not.toContain("observations");
    expect(listSql).not.toContain("interpretation");
    expect(listSql).not.toContain("select item.*");
    expect(listSql).toContain("jsonb_build_object");
    expect(listSql).toContain("patternAvailable");
    expect(fake.query.mock.calls.some(([sql]) =>
      String(sql).includes("brand_trend_saved_media") && String(sql).includes("instagram_trend_media"),
    )).toBe(true);
    const brandItemsSql = fake.query.mock.calls.map(([sql]) => String(sql)).find((sql) =>
      sql.includes("brand_trend_saved_media") && sql.includes("instagram_trend_media"));
    expect(brandItemsSql).not.toContain("select item.*");
    expect(brandItemsSql).toContain("patternAvailable");
  });

  it("loads a tenant-scoped reference detail without mutating its stored snapshot", async () => {
    const row = {
      id: imageId, workspace_id: scope.workspaceId, brand_id: scope.brandId,
      kind: "external_url", content_purpose: "both", origin: "example.com",
      title: "Crawled title", preview_url: "https://cdn.example.com/og.webp",
      source_url: "https://example.com/article", format: "url",
      metadata: { description: "legacy description" }, is_favorite: false,
      archived_at: null, reference_brand_id: null, created_at: new Date(), updated_at: new Date(),
      detail_description: "Latest summary", detail_body: "Latest extracted body",
      snapshot_id: "snapshot-1", snapshot_fetched_at: new Date(),
      snapshot_metadata: { ogImage: "https://cdn.example.com/og.webp" },
    };
    const fake = fakePool((sql) => {
      if (sql.includes("from reference_items item") && sql.includes("source_snapshots")) {
        return { rows: [row] };
      }
      return {};
    });

    const detail = await createAssetLibraryRepository(fake.pool).getReference({
      workspaceId: scope.workspaceId,
      brandId: scope.brandId,
      referenceId: imageId,
    });
    expect(detail).toMatchObject({
      id: imageId,
      title: "Crawled title",
      sourceUrl: "https://example.com/article",
      description: "Latest summary",
      body: "Latest extracted body",
      snapshot: {
        id: "snapshot-1",
        metadata: { ogImage: "https://cdn.example.com/og.webp" },
      },
    });
    const [query, values] = fake.query.mock.calls[0] ?? [];
    expect(String(query)).toContain("item.workspace_id=$2");
    expect(String(query)).toContain("item.brand_id=$3");
    expect(values).toEqual([imageId, scope.workspaceId, scope.brandId]);
    expect(fake.query.mock.calls.some(([sql]) => /^\s*update\b/i.test(String(sql)))).toBe(false);
  });
});
