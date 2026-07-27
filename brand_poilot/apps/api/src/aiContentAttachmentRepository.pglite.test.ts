import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createAiContentAttachmentRepository } from "./aiContentAttachmentRepository.js";
import { createAiContentRepository } from "./aiContentRepository.js";
import type { Pool } from "pg";

const WORKSPACE_ID = "10000000-0000-4000-8000-000000000001";
const BRAND_ID = "20000000-0000-4000-8000-000000000001";
const GENERATION_ID = "30000000-0000-4000-8000-000000000001";
const USER_ID = "40000000-0000-4000-8000-000000000001";
const FOREIGN_WORKSPACE_ID = "10000000-0000-4000-8000-000000000002";
const FOREIGN_BRAND_ID = "20000000-0000-4000-8000-000000000002";
const FOREIGN_GENERATION_ID = "30000000-0000-4000-8000-000000000002";
const FOREIGN_USER_ID = "40000000-0000-4000-8000-000000000002";

function pglitePool(database: PGlite): Pool {
  async function query(sql: string, values: unknown[] = []) {
    const result = await database.query(sql, values as never[]);
    return {
      rows: result.rows as Record<string, unknown>[],
      rowCount: result.rows.length || Number(result.affectedRows ?? 0),
    };
  }
  return {
    query,
    async connect() {
      return { query, release() {} };
    },
  } as unknown as Pool;
}

describe("AI content attachment lifecycle in PostgreSQL", () => {
  let database: PGlite;

  beforeAll(async () => {
    database = await PGlite.create({ extensions: { pgcrypto } });
    const directory = resolve(process.cwd(), "../../db/migrations");
    for (const file of (await readdir(directory)).filter((name) => name.endsWith(".sql")).sort()) {
      const sql = await readFile(resolve(directory, file), "utf8");
      if (sql.startsWith("-- requires: pgvector") || file === "027_wiki_search_v2.sql") continue;
      await database.exec(sql);
    }
    await database.exec(`
      insert into app_users (id, email) values ('${USER_ID}', 'attachment-pglite@example.com');
      insert into workspaces (id, name, slug, created_by_user_id)
        values ('${WORKSPACE_ID}', 'Attachment Workspace', 'attachment-pglite', '${USER_ID}');
      insert into workspace_members (workspace_id, user_id, role, status)
        values ('${WORKSPACE_ID}', '${USER_ID}', 'owner', 'active');
      insert into brands (id, workspace_id, name, created_by_user_id)
        values ('${BRAND_ID}', '${WORKSPACE_ID}', 'Attachment Brand', '${USER_ID}');
      insert into app_users (id, email) values ('${FOREIGN_USER_ID}', 'attachment-foreign@example.com');
      insert into workspaces (id, name, slug, created_by_user_id)
        values ('${FOREIGN_WORKSPACE_ID}', 'Foreign Workspace', 'attachment-foreign', '${FOREIGN_USER_ID}');
      insert into workspace_members (workspace_id, user_id, role, status)
        values ('${FOREIGN_WORKSPACE_ID}', '${FOREIGN_USER_ID}', 'owner', 'active');
      insert into brands (id, workspace_id, name, created_by_user_id)
        values ('${FOREIGN_BRAND_ID}', '${FOREIGN_WORKSPACE_ID}', 'Foreign Brand', '${FOREIGN_USER_ID}');
    `);
  }, 45_000);

  beforeEach(async () => {
    await database.exec(`
      truncate table ai_content_attachment_deletion_jobs,
                     ai_content_generation_attachments,
                     ai_content_attachment_upload_sessions,
                     ai_content_attachment_storage_path_guards,
                     ai_content_generations cascade;
      insert into ai_content_generations (
        id, workspace_id, brand_id, type, title, status, analysis_idempotency_key
      ) values (
        '${GENERATION_ID}', '${WORKSPACE_ID}', '${BRAND_ID}', 'card_news',
        'Attachment lifecycle', 'analysis_ready', 'attachment-pglite'
      );
      insert into ai_content_generations (
        id, workspace_id, brand_id, type, title, status, analysis_idempotency_key
      ) values (
        '${FOREIGN_GENERATION_ID}', '${FOREIGN_WORKSPACE_ID}', '${FOREIGN_BRAND_ID}', 'card_news',
        'Foreign attachment lifecycle', 'analysis_ready', 'attachment-pglite-foreign'
      );
    `);
  });

  afterAll(async () => database.close());

  it("counts pending reservations and confirmed live attachments toward five", async () => {
    const repository = createAiContentAttachmentRepository(pglitePool(database));
    const attachment = {
      role: "product" as const,
      fileName: "product.png",
      mimeType: "image/png",
      sizeBytes: 100,
      checksum: "a".repeat(64),
    };
    const sessions = [];
    for (let index = 0; index < 5; index += 1) {
      sessions.push(await repository.createAiContentUploadSession({
        workspaceId: WORKSPACE_ID,
        brandId: BRAND_ID,
        generationId: GENERATION_ID,
        createdByUserId: USER_ID,
        attachment: { ...attachment, fileName: `product-${index}.png` },
      }));
    }

    expect(sessions).toHaveLength(5);
    await expect(repository.createAiContentUploadSession({
      workspaceId: WORKSPACE_ID,
      brandId: BRAND_ID,
      generationId: GENERATION_ID,
      createdByUserId: USER_ID,
      attachment: { ...attachment, fileName: "sixth.png" },
    })).rejects.toThrow("ai_content_attachment_limit_exceeded");
  });

  it("never resurrects a removed legacy storage path", async () => {
    const repository = createAiContentAttachmentRepository(pglitePool(database));
    const input = {
      workspaceId: WORKSPACE_ID,
      brandId: BRAND_ID,
      generationId: GENERATION_ID,
      role: "document" as const,
      fileName: "brief.md",
      mimeType: "text/markdown",
      sizeBytes: 123,
      checksum: "b".repeat(64),
      storageUrl: "https://test.public.blob.vercel-storage.com/legacy/brief.md",
      storagePath: "legacy/brief.md",
    };
    const first = await repository.confirmLegacyAiContentAttachment(input);
    await repository.removeAiContentAttachment({ ...input, attachmentId: first.id });

    await expect(repository.confirmLegacyAiContentAttachment(input))
      .rejects.toThrow("ai_content_attachment_path_conflict");
    const jobs = await database.query(
      "select reason, status from ai_content_attachment_deletion_jobs where attachment_id = $1",
      [first.id],
    );
    expect(jobs.rows).toEqual([{ reason: "user_removed", status: "pending" }]);
  });

  it("keeps an already-live legacy path idempotent without consuming another slot", async () => {
    const repository = createAiContentAttachmentRepository(pglitePool(database));
    const input = {
      workspaceId: WORKSPACE_ID,
      brandId: BRAND_ID,
      generationId: GENERATION_ID,
      role: "document" as const,
      fileName: "idempotent.md",
      mimeType: "text/markdown",
      sizeBytes: 123,
      checksum: "9".repeat(64),
      storageUrl: "https://test.public.blob.vercel-storage.com/legacy/idempotent.md",
      storagePath: "legacy/idempotent.md",
    };

    const first = await repository.confirmLegacyAiContentAttachment(input);
    await expect(repository.confirmLegacyAiContentAttachment(input)).resolves.toEqual(first);
    const count = await database.query(
      "select count(*)::integer as count from ai_content_generation_attachments where deleted_at is null",
    );
    expect(count.rows).toEqual([{ count: 1 }]);
  });

  it("treats exact expiry equality as expired and persists the single terminal transition", async () => {
    const repository = createAiContentAttachmentRepository(pglitePool(database));
    const session = {
      id: "50000000-0000-4000-8000-000000000001",
      nonce: "60000000-0000-4000-8000-000000000001",
    };
    await database.query(
      `insert into ai_content_attachment_upload_sessions (
         id, generation_id, workspace_id, brand_id, created_by_user_id, nonce,
         role, file_name, expected_mime_type, expected_size_bytes, expected_checksum,
         storage_path, status, token_expires_at, created_at
       ) values (
         $1, $2, $3, $4, $5, $6, 'product', 'expires.png', 'image/png', 100, $7,
         'expired/equality/path', 'pending', statement_timestamp(), statement_timestamp() - interval '10 minutes'
       )`,
      [session.id, GENERATION_ID, WORKSPACE_ID, BRAND_ID, USER_ID, session.nonce, "c".repeat(64)],
    );

    await expect(repository.confirmAiContentUploadSession({
      workspaceId: WORKSPACE_ID,
      brandId: BRAND_ID,
      generationId: GENERATION_ID,
      createdByUserId: USER_ID,
      sessionId: session.id,
      nonce: session.nonce,
    }, async () => {
      throw new Error("verifier_must_not_run");
    })).rejects.toThrow("ai_content_upload_session_expired");

    const state = await database.query(
      "select status, expired_at is not null as transitioned from ai_content_attachment_upload_sessions where id = $1",
      [session.id],
    );
    expect(state.rows).toEqual([{ status: "expired", transitioned: true }]);
  });

  it("cannot cancel an already expired reservation", async () => {
    const repository = createAiContentAttachmentRepository(pglitePool(database));
    const sessionId = "50000000-0000-4000-8000-000000000002";
    const nonce = "60000000-0000-4000-8000-000000000002";
    await database.query(
      `insert into ai_content_attachment_upload_sessions (
         id, generation_id, workspace_id, brand_id, created_by_user_id, nonce,
         role, file_name, expected_mime_type, expected_size_bytes, expected_checksum,
         storage_path, status, token_expires_at, created_at
       ) values (
         $1, $2, $3, $4, $5, $6, 'product', 'cancel-expired.png', 'image/png', 100, $7,
         'expired/cancel/path', 'pending', statement_timestamp(), statement_timestamp() - interval '10 minutes'
       )`,
      [sessionId, GENERATION_ID, WORKSPACE_ID, BRAND_ID, USER_ID, nonce, "d".repeat(64)],
    );

    await expect(repository.cancelAiContentUploadSession({
      workspaceId: WORKSPACE_ID,
      brandId: BRAND_ID,
      generationId: GENERATION_ID,
      createdByUserId: USER_ID,
      sessionId,
      nonce,
    })).rejects.toThrow("ai_content_upload_session_expired");

    const state = await database.query(
      "select status from ai_content_attachment_upload_sessions where id = $1",
      [sessionId],
    );
    expect(state.rows).toEqual([{ status: "expired" }]);
  });

  it("records issuance failure without exposing the nonce and delays cleanup until token expiry", async () => {
    const repository = createAiContentAttachmentRepository(pglitePool(database));
    const session = await repository.createAiContentUploadSession({
      workspaceId: WORKSPACE_ID,
      brandId: BRAND_ID,
      generationId: GENERATION_ID,
      createdByUserId: USER_ID,
      attachment: {
        role: "document",
        fileName: "token-failure.md",
        mimeType: "text/markdown",
        sizeBytes: 100,
        checksum: "e".repeat(64),
      },
    });

    await repository.failAiContentUploadSession({
      workspaceId: WORKSPACE_ID,
      brandId: BRAND_ID,
      generationId: GENERATION_ID,
      createdByUserId: USER_ID,
      sessionId: session.id,
      errorCode: "blob_token_unavailable",
    });

    const failed = await database.query(
      `select session.status, session.last_error_code,
              cleanup.reason, cleanup.next_attempt_at >= session.token_expires_at as delayed
         from ai_content_attachment_upload_sessions session
         join ai_content_attachment_deletion_jobs cleanup
           on cleanup.upload_session_id = session.id
        where session.id = $1`,
      [session.id],
    );
    expect(failed.rows).toEqual([{
      status: "failed",
      last_error_code: "blob_token_unavailable",
      reason: "upload_issuance_failed",
      delayed: true,
    }]);
  });

  it("replays a confirmed attachment after locking while rejecting a conflicting nonce", async () => {
    const repository = createAiContentAttachmentRepository(pglitePool(database));
    const session = await repository.createAiContentUploadSession({
      workspaceId: WORKSPACE_ID,
      brandId: BRAND_ID,
      generationId: GENERATION_ID,
      createdByUserId: USER_ID,
      attachment: {
        role: "product",
        fileName: "replay.png",
        mimeType: "image/png",
        sizeBytes: 100,
        checksum: "f".repeat(64),
      },
    });
    const confirmation = {
      workspaceId: WORKSPACE_ID,
      brandId: BRAND_ID,
      generationId: GENERATION_ID,
      createdByUserId: USER_ID,
      sessionId: session.id,
      nonce: session.nonce,
    };
    const first = await repository.confirmAiContentUploadSession(confirmation, async (stored) => ({
      storagePath: stored.storagePath,
      storageUrl: `https://test.public.blob.vercel-storage.com/${stored.storagePath}`,
      mimeType: stored.mimeType,
      sizeBytes: stored.sizeBytes,
    }));
    await database.query(
      "update ai_content_generations set attachments_locked_at = statement_timestamp() where id = $1",
      [GENERATION_ID],
    );

    await expect(repository.confirmAiContentUploadSession(confirmation, async () => {
      throw new Error("verifier_must_not_run");
    })).resolves.toEqual(first);
    await expect(repository.confirmAiContentUploadSession({
      ...confirmation,
      nonce: "70000000-0000-4000-8000-000000000009",
    }, async () => {
      throw new Error("verifier_must_not_run");
    })).rejects.toThrow("ai_content_upload_confirmation_conflict");
  });

  it("uses actor isolation and rejects all new attachment mutations after generation lock", async () => {
    const repository = createAiContentAttachmentRepository(pglitePool(database));
    const session = await repository.createAiContentUploadSession({
      workspaceId: WORKSPACE_ID,
      brandId: BRAND_ID,
      generationId: GENERATION_ID,
      createdByUserId: USER_ID,
      attachment: {
        role: "product",
        fileName: "locked.png",
        mimeType: "image/png",
        sizeBytes: 100,
        checksum: "1".repeat(64),
      },
    });
    const confirmedSession = await repository.createAiContentUploadSession({
      workspaceId: WORKSPACE_ID,
      brandId: BRAND_ID,
      generationId: GENERATION_ID,
      createdByUserId: USER_ID,
      attachment: {
        role: "product",
        fileName: "remove-locked.png",
        mimeType: "image/png",
        sizeBytes: 100,
        checksum: "3".repeat(64),
      },
    });
    const confirmed = await repository.confirmAiContentUploadSession({
      workspaceId: WORKSPACE_ID,
      brandId: BRAND_ID,
      generationId: GENERATION_ID,
      createdByUserId: USER_ID,
      sessionId: confirmedSession.id,
      nonce: confirmedSession.nonce,
    }, async (stored) => ({
      storagePath: stored.storagePath,
      storageUrl: `https://test.public.blob.vercel-storage.com/${stored.storagePath}`,
      mimeType: stored.mimeType,
      sizeBytes: stored.sizeBytes,
    }));
    await database.query(
      "update ai_content_generations set attachments_locked_at = statement_timestamp() where id = $1",
      [GENERATION_ID],
    );

    await expect(repository.confirmAiContentUploadSession({
      workspaceId: WORKSPACE_ID,
      brandId: BRAND_ID,
      generationId: GENERATION_ID,
      createdByUserId: "40000000-0000-4000-8000-000000000099",
      sessionId: session.id,
      nonce: session.nonce,
    }, async () => {
      throw new Error("verifier_must_not_run");
    })).rejects.toThrow("ai_content_upload_session_not_found");
    await expect(repository.confirmAiContentUploadSession({
      workspaceId: WORKSPACE_ID,
      brandId: BRAND_ID,
      generationId: GENERATION_ID,
      createdByUserId: USER_ID,
      sessionId: session.id,
      nonce: session.nonce,
    }, async () => {
      throw new Error("verifier_must_not_run");
    })).rejects.toThrow("ai_content_attachments_locked");
    await expect(repository.removeAiContentAttachment({
      workspaceId: WORKSPACE_ID,
      brandId: BRAND_ID,
      generationId: GENERATION_ID,
      attachmentId: confirmed.id,
    })).rejects.toThrow("ai_content_attachments_locked");
    await expect(repository.assertAiContentAttachmentUploadMutable({
      workspaceId: WORKSPACE_ID,
      brandId: BRAND_ID,
      generationId: GENERATION_ID,
    })).rejects.toThrow("ai_content_attachments_locked");
    await expect(repository.createAiContentUploadSession({
      workspaceId: WORKSPACE_ID,
      brandId: BRAND_ID,
      generationId: GENERATION_ID,
      createdByUserId: USER_ID,
      attachment: {
        role: "product",
        fileName: "locked-new.png",
        mimeType: "image/png",
        sizeBytes: 100,
        checksum: "2".repeat(64),
      },
    })).rejects.toThrow("ai_content_attachments_locked");
  });

  it("routes the public legacy compatibility confirm through reservation limit and never deletes Blob", async () => {
    const pool = pglitePool(database);
    const lifecycle = createAiContentAttachmentRepository(pool);
    const deleteAttachments = vi.fn(async () => undefined);
    const repository = createAiContentRepository(pool, { deleteAttachments });
    for (let index = 0; index < 5; index += 1) {
      await lifecycle.createAiContentUploadSession({
        workspaceId: WORKSPACE_ID,
        brandId: BRAND_ID,
        generationId: GENERATION_ID,
        createdByUserId: USER_ID,
        attachment: {
          role: "product",
          fileName: `pending-${index}.png`,
          mimeType: "image/png",
          sizeBytes: 100,
          checksum: "4".repeat(64),
        },
      });
    }

    await expect(repository.confirmAiContentAttachment({
      workspaceId: WORKSPACE_ID,
      brandId: BRAND_ID,
      generationId: GENERATION_ID,
      role: "document",
      fileName: "legacy-sixth.md",
      mimeType: "text/markdown",
      sizeBytes: 100,
      checksum: "5".repeat(64),
      storageUrl: "https://test.public.blob.vercel-storage.com/legacy/sixth.md",
      storagePath: "legacy/sixth.md",
    })).rejects.toThrow("ai_content_attachment_limit_exceeded");
    expect(deleteAttachments).not.toHaveBeenCalled();
  });

  it("makes the public legacy compatibility confirm obey lock and path immutability", async () => {
    const pool = pglitePool(database);
    const repository = createAiContentRepository(pool, {
      deleteAttachments: vi.fn(async () => undefined),
    });
    const input = {
      workspaceId: WORKSPACE_ID,
      brandId: BRAND_ID,
      generationId: GENERATION_ID,
      role: "document" as const,
      fileName: "immutable.md",
      mimeType: "text/markdown",
      sizeBytes: 100,
      checksum: "6".repeat(64),
      storageUrl: "https://test.public.blob.vercel-storage.com/legacy/immutable.md",
      storagePath: "legacy/immutable.md",
    };
    const created = await repository.confirmAiContentAttachment(input);

    await expect(repository.confirmAiContentAttachment({
      ...input,
      checksum: "7".repeat(64),
    })).rejects.toThrow("ai_content_attachment_path_conflict");
    await repository.removeAiContentAttachment({ ...input, attachmentId: created.id });
    await expect(repository.confirmAiContentAttachment(input))
      .rejects.toThrow("ai_content_attachment_path_conflict");
    await database.query(
      "update ai_content_generations set attachments_locked_at = statement_timestamp() where id = $1",
      [GENERATION_ID],
    );
    await expect(repository.confirmAiContentAttachment({
      ...input,
      storagePath: "legacy/locked.md",
      storageUrl: "https://test.public.blob.vercel-storage.com/legacy/locked.md",
    })).rejects.toThrow("ai_content_attachments_locked");
  });

  it("returns the cancelled session id and schedules cleanup no earlier than token expiry", async () => {
    const repository = createAiContentAttachmentRepository(pglitePool(database));
    const session = await repository.createAiContentUploadSession({
      workspaceId: WORKSPACE_ID,
      brandId: BRAND_ID,
      generationId: GENERATION_ID,
      createdByUserId: USER_ID,
      attachment: {
        role: "product",
        fileName: "cancel.png",
        mimeType: "image/png",
        sizeBytes: 100,
        checksum: "8".repeat(64),
      },
    });

    await expect(repository.cancelAiContentUploadSession({
      workspaceId: WORKSPACE_ID,
      brandId: BRAND_ID,
      generationId: GENERATION_ID,
      createdByUserId: USER_ID,
      sessionId: session.id,
      nonce: session.nonce,
    })).resolves.toEqual({ id: session.id });
    const cleanup = await database.query(
      `select cleanup.next_attempt_at >= session.token_expires_at as delayed
         from ai_content_attachment_deletion_jobs cleanup
         join ai_content_attachment_upload_sessions session
           on session.id = cleanup.upload_session_id
        where session.id = $1`,
      [session.id],
    );
    expect(cleanup.rows).toEqual([{ delayed: true }]);
  });

  it("allows fail and cancel after generation lock while preserving scoped missing results", async () => {
    const repository = createAiContentAttachmentRepository(pglitePool(database));
    const foreign = await repository.createAiContentUploadSession({
      workspaceId: FOREIGN_WORKSPACE_ID,
      brandId: FOREIGN_BRAND_ID,
      generationId: FOREIGN_GENERATION_ID,
      createdByUserId: FOREIGN_USER_ID,
      attachment: {
        role: "product", fileName: "foreign.png", mimeType: "image/png",
        sizeBytes: 100, checksum: "f".repeat(64),
      },
    });
    const failed = await repository.createAiContentUploadSession({
      workspaceId: WORKSPACE_ID,
      brandId: BRAND_ID,
      generationId: GENERATION_ID,
      createdByUserId: USER_ID,
      attachment: {
        role: "product", fileName: "failed.png", mimeType: "image/png",
        sizeBytes: 100, checksum: "a".repeat(64),
      },
    });
    const cancelled = await repository.createAiContentUploadSession({
      workspaceId: WORKSPACE_ID,
      brandId: BRAND_ID,
      generationId: GENERATION_ID,
      createdByUserId: USER_ID,
      attachment: {
        role: "product", fileName: "cancelled.png", mimeType: "image/png",
        sizeBytes: 100, checksum: "b".repeat(64),
      },
    });
    await database.query(
      "update ai_content_generations set attachments_locked_at = statement_timestamp() where id = $1",
      [GENERATION_ID],
    );

    await expect(repository.failAiContentUploadSession({
      workspaceId: WORKSPACE_ID,
      brandId: BRAND_ID,
      generationId: GENERATION_ID,
      createdByUserId: USER_ID,
      sessionId: failed.id,
      errorCode: "token_issue_failed",
    })).resolves.toBeUndefined();
    await expect(repository.cancelAiContentUploadSession({
      workspaceId: WORKSPACE_ID,
      brandId: BRAND_ID,
      generationId: GENERATION_ID,
      createdByUserId: USER_ID,
      sessionId: cancelled.id,
      nonce: cancelled.nonce,
    })).resolves.toEqual({ id: cancelled.id });
    await expect(repository.failAiContentUploadSession({
      workspaceId: WORKSPACE_ID,
      brandId: BRAND_ID,
      generationId: GENERATION_ID,
      createdByUserId: USER_ID,
      sessionId: "50000000-0000-4000-8000-000000000099",
      errorCode: "token_issue_failed",
    })).rejects.toThrow("ai_content_upload_session_not_found");
    await expect(repository.failAiContentUploadSession({
      workspaceId: WORKSPACE_ID,
      brandId: BRAND_ID,
      generationId: GENERATION_ID,
      createdByUserId: USER_ID,
      sessionId: foreign.id,
      errorCode: "token_issue_failed",
    })).rejects.toThrow("ai_content_upload_session_not_found");
    await expect(repository.cancelAiContentUploadSession({
      workspaceId: WORKSPACE_ID,
      brandId: BRAND_ID,
      generationId: GENERATION_ID,
      createdByUserId: USER_ID,
      sessionId: foreign.id,
      nonce: foreign.nonce,
    })).rejects.toThrow("ai_content_upload_session_not_found");
    await expect(repository.confirmAiContentUploadSession({
      workspaceId: WORKSPACE_ID,
      brandId: BRAND_ID,
      generationId: GENERATION_ID,
      createdByUserId: USER_ID,
      sessionId: foreign.id,
      nonce: foreign.nonce,
    }, async () => {
      throw new Error("verifier_must_not_run");
    })).rejects.toThrow("ai_content_upload_session_not_found");
    await expect(repository.cancelAiContentUploadSession({
      workspaceId: WORKSPACE_ID,
      brandId: BRAND_ID,
      generationId: GENERATION_ID,
      createdByUserId: "40000000-0000-4000-8000-000000000099",
      sessionId: cancelled.id,
      nonce: cancelled.nonce,
    })).rejects.toThrow("ai_content_upload_session_not_found");
  });

  it("issues a fresh session path for the same file after removal", async () => {
    const repository = createAiContentAttachmentRepository(pglitePool(database));
    const request = {
      workspaceId: WORKSPACE_ID,
      brandId: BRAND_ID,
      generationId: GENERATION_ID,
      createdByUserId: USER_ID,
      attachment: {
        role: "product" as const,
        fileName: "same.png",
        mimeType: "image/png",
        sizeBytes: 100,
        checksum: "c".repeat(64),
      },
    };
    const first = await repository.createAiContentUploadSession(request);
    const confirmed = await repository.confirmAiContentUploadSession({
      ...request,
      sessionId: first.id,
      nonce: first.nonce,
    }, async (stored) => ({
      storagePath: stored.storagePath,
      storageUrl: `https://test.public.blob.vercel-storage.com/${stored.storagePath}`,
      mimeType: stored.mimeType,
      sizeBytes: stored.sizeBytes,
    }));
    await repository.removeAiContentAttachment({ ...request, attachmentId: confirmed.id });

    const next = await repository.createAiContentUploadSession(request);
    expect(next.id).not.toBe(first.id);
    expect(next.storagePath).not.toBe(first.storagePath);
  });

  it("confirms when the persisted DB boundary is still before expiry", async () => {
    const repository = createAiContentAttachmentRepository(pglitePool(database));
    const sessionId = "50000000-0000-4000-8000-000000000088";
    const nonce = "60000000-0000-4000-8000-000000000088";
    await database.query(
      `insert into ai_content_attachment_upload_sessions (
         id, generation_id, workspace_id, brand_id, created_by_user_id, nonce,
         role, file_name, expected_mime_type, expected_size_bytes, expected_checksum,
         storage_path, status, token_expires_at, created_at
       ) values (
         $1, $2, $3, $4, $5, $6, 'product', 'before-expiry.png', 'image/png', 100, $7,
         'before/expiry/path', 'pending',
         statement_timestamp() + interval '5 seconds',
         statement_timestamp() - interval '9 minutes 55 seconds'
       )`,
      [sessionId, GENERATION_ID, WORKSPACE_ID, BRAND_ID, USER_ID, nonce, "d".repeat(64)],
    );

    await expect(repository.confirmAiContentUploadSession({
      workspaceId: WORKSPACE_ID,
      brandId: BRAND_ID,
      generationId: GENERATION_ID,
      createdByUserId: USER_ID,
      sessionId,
      nonce,
    }, async (stored) => ({
      storagePath: stored.storagePath,
      storageUrl: `https://test.public.blob.vercel-storage.com/${stored.storagePath}`,
      mimeType: stored.mimeType,
      sizeBytes: stored.sizeBytes,
    }))).resolves.toMatchObject({ storagePath: "before/expiry/path" });
  });
});
