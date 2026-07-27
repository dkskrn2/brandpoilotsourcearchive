import { randomUUID, timingSafeEqual } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { AttachmentUploadTokenInput, LegacyConfirmAttachmentInput } from "./aiContentContracts.js";
import { buildAiContentUploadSessionPath } from "./aiContentUpload.js";
import type {
  AiContentAttachmentRecord,
  BrandGenerationScope,
} from "./aiContentRepository.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CONFIRM_TIMEOUT_MS = 15_000;

type Queryable = Pick<PoolClient, "query">;

export interface AiContentUploadSessionRecord {
  id: string;
  generationId: string;
  workspaceId: string;
  brandId: string;
  createdByUserId: string;
  nonce: string;
  role: AttachmentUploadTokenInput["role"];
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  checksum: string;
  storagePath: string;
  status: "pending" | "confirmed" | "cancelled" | "expired" | "failed";
  tokenExpiresAt: string;
  createdAt: string;
}

export interface AiContentUploadVerificationSession {
  id: string;
  generationId: string;
  workspaceId: string;
  brandId: string;
  role: AttachmentUploadTokenInput["role"];
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  checksum: string;
  storagePath: string;
  tokenExpiresAt: string;
}

export interface VerifiedAiContentUpload {
  storageUrl: string;
  storagePath: string;
  mimeType: string;
  sizeBytes: number;
}

export interface AiContentAttachmentLifecycleRepository {
  assertAiContentAttachmentUploadMutable(input: BrandGenerationScope): Promise<void>;
  createAiContentUploadSession(
    input: BrandGenerationScope & {
      createdByUserId: string;
      attachment: AttachmentUploadTokenInput;
    },
  ): Promise<AiContentUploadSessionRecord>;
  failAiContentUploadSession(
    input: BrandGenerationScope & {
      sessionId: string;
      createdByUserId: string;
      errorCode: string;
    },
  ): Promise<void>;
  confirmAiContentUploadSession(
    input: BrandGenerationScope & {
      sessionId: string;
      nonce: string;
      createdByUserId: string;
    },
    verify: (
      session: AiContentUploadVerificationSession,
      abortSignal: AbortSignal,
    ) => Promise<VerifiedAiContentUpload>,
  ): Promise<AiContentAttachmentRecord>;
  cancelAiContentUploadSession(
    input: BrandGenerationScope & {
      sessionId: string;
      nonce: string;
      createdByUserId: string;
    },
  ): Promise<{ id: string }>;
  confirmLegacyAiContentAttachment(
    input: BrandGenerationScope & LegacyConfirmAttachmentInput,
  ): Promise<AiContentAttachmentRecord>;
  removeAiContentAttachment(
    input: BrandGenerationScope & { attachmentId: string },
  ): Promise<{ id: string }>;
}

interface Options {
  createId?: () => string;
}

class CommitAndThrow extends Error {
  constructor(readonly publicError: Error) {
    super(publicError.message);
  }
}

function requireUuid(value: string, code: string) {
  if (!UUID.test(value)) throw new Error(code);
  return value.toLowerCase();
}

function validateScope(input: BrandGenerationScope) {
  return {
    workspaceId: requireUuid(input.workspaceId, "ai_content_workspace_id_invalid"),
    brandId: requireUuid(input.brandId, "ai_content_brand_id_invalid"),
    generationId: requireUuid(input.generationId, "ai_content_generation_id_invalid"),
  };
}

function iso(value: unknown): string {
  return new Date(value as string | Date).toISOString();
}

function mapAttachment(row: Record<string, unknown>): AiContentAttachmentRecord {
  return {
    id: String(row.id),
    generationId: String(row.generation_id),
    role: row.role as AiContentAttachmentRecord["role"],
    fileName: String(row.file_name),
    mimeType: String(row.mime_type),
    sizeBytes: Number(row.size_bytes),
    checksum: String(row.checksum),
    storageUrl: String(row.storage_url),
    storagePath: String(row.storage_path),
    createdAt: iso(row.created_at),
  };
}

function mapSession(row: Record<string, unknown>): AiContentUploadSessionRecord {
  return {
    id: String(row.id),
    generationId: String(row.generation_id),
    workspaceId: String(row.workspace_id),
    brandId: String(row.brand_id),
    createdByUserId: String(row.created_by_user_id),
    nonce: String(row.nonce),
    role: row.role as AiContentUploadSessionRecord["role"],
    fileName: String(row.file_name),
    mimeType: String(row.expected_mime_type),
    sizeBytes: Number(row.expected_size_bytes),
    checksum: String(row.expected_checksum),
    storagePath: String(row.storage_path),
    status: row.status as AiContentUploadSessionRecord["status"],
    tokenExpiresAt: iso(row.token_expires_at),
    createdAt: iso(row.created_at),
  };
}

function safeEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function lockGeneration(client: Queryable, scope: BrandGenerationScope) {
  const result = await client.query(
    `select id, attachments_locked_at
       from ai_content_generations
      where id = $1 and workspace_id = $2 and brand_id = $3
      for update`,
    [scope.generationId, scope.workspaceId, scope.brandId],
  );
  if (!result.rowCount) throw new Error("ai_content_generation_not_found");
  return result.rows[0] as Record<string, unknown>;
}

function assertMutable(generation: Record<string, unknown>) {
  if (generation.attachments_locked_at) throw new Error("ai_content_attachments_locked");
}

function connectionError(error: unknown): Error {
  return error instanceof Error ? error : new Error("database_transaction_connection_failed");
}

async function bestEffortRollback(client: Queryable): Promise<Error | undefined> {
  try {
    await client.query("ROLLBACK");
    return undefined;
  } catch (error) {
    return connectionError(error);
  }
}

async function inTransaction<T>(pool: Pool, operation: (client: Queryable) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  let releaseError: Error | undefined;
  try {
    try {
      await client.query("BEGIN");
    } catch (error) {
      releaseError = connectionError(error);
      throw error;
    }

    let result: T;
    try {
      result = await operation(client);
    } catch (primaryError) {
      if (primaryError instanceof CommitAndThrow) {
        try {
          await client.query("COMMIT");
        } catch (commitError) {
          releaseError = connectionError(commitError);
          releaseError = await bestEffortRollback(client) ?? releaseError;
          throw commitError;
        }
        throw primaryError.publicError;
      }
      const rollbackError = await bestEffortRollback(client);
      if (rollbackError) releaseError = rollbackError;
      throw primaryError;
    }

    try {
      await client.query("COMMIT");
    } catch (commitError) {
      releaseError = connectionError(commitError);
      releaseError = await bestEffortRollback(client) ?? releaseError;
      throw commitError;
    }
    return result;
  } finally {
    client.release(releaseError);
  }
}

async function countReservedSlots(client: Queryable, scope: BrandGenerationScope) {
  const result = await client.query(
    `select (
       (select count(*) from ai_content_attachment_upload_sessions session
         where session.generation_id = $1 and session.workspace_id = $2 and session.brand_id = $3
           and session.status = 'pending'
           and session.token_expires_at > statement_timestamp())
       +
       (select count(*) from ai_content_generation_attachments attachment
         where attachment.generation_id = $1 and attachment.workspace_id = $2 and attachment.brand_id = $3
           and attachment.deleted_at is null)
     )::integer as attachment_count`,
    [scope.generationId, scope.workspaceId, scope.brandId],
  );
  return Number(result.rows[0]?.attachment_count ?? 0);
}

async function scheduleCleanup(
  client: Queryable,
  session: Record<string, unknown>,
  reason: string,
  nextAttemptExpression: "statement_timestamp()" | "token_expires_at",
) {
  await client.query(
    `insert into ai_content_attachment_deletion_jobs (
       id, workspace_id, brand_id, generation_id, attachment_id, upload_session_id,
       storage_url, storage_path, reason, status, next_attempt_at
     ) values (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending',
       ${nextAttemptExpression === "token_expires_at" ? "$10" : "statement_timestamp()"}
     )
     on conflict (workspace_id, storage_path) do nothing`,
    [
      randomUUID(),
      session.workspace_id,
      session.brand_id,
      session.generation_id,
      session.confirmed_attachment_id ?? null,
      session.id,
      session.storage_url ?? null,
      session.storage_path,
      reason,
      ...(nextAttemptExpression === "token_expires_at" ? [session.token_expires_at] : []),
    ],
  );
}

export function createAiContentAttachmentRepository(
  pool: Pool,
  options: Options = {},
): AiContentAttachmentLifecycleRepository {
  const createId = options.createId ?? randomUUID;

  return {
    async assertAiContentAttachmentUploadMutable(input) {
      const scope = validateScope(input);
      await inTransaction(pool, async (client) => {
        assertMutable(await lockGeneration(client, scope));
      });
    },

    async createAiContentUploadSession(input) {
      const scope = validateScope(input);
      const createdByUserId = requireUuid(input.createdByUserId, "ai_content_actor_user_id_invalid");
      const sessionId = requireUuid(createId(), "ai_content_upload_session_id_invalid");
      const attemptId = requireUuid(createId(), "ai_content_upload_attempt_id_invalid");
      const nonce = requireUuid(createId(), "ai_content_upload_nonce_invalid");
      const storagePath = buildAiContentUploadSessionPath({
        ...scope,
        sessionId,
        attemptId,
        fileName: input.attachment.fileName,
      });

      return inTransaction(pool, async (client) => {
        assertMutable(await lockGeneration(client, scope));
        if (await countReservedSlots(client, scope) >= 5) {
          throw new Error("ai_content_attachment_limit_exceeded");
        }
        const result = await client.query(
          `insert into ai_content_attachment_upload_sessions (
             id, generation_id, workspace_id, brand_id, created_by_user_id, nonce,
             role, file_name, expected_mime_type, expected_size_bytes, expected_checksum,
             storage_path, status, token_expires_at, created_at
           ) values (
             $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
             'pending', statement_timestamp() + interval '10 minutes', statement_timestamp()
           )
           returning *`,
          [
            sessionId,
            scope.generationId,
            scope.workspaceId,
            scope.brandId,
            createdByUserId,
            nonce,
            input.attachment.role,
            input.attachment.fileName,
            input.attachment.mimeType,
            input.attachment.sizeBytes,
            input.attachment.checksum,
            storagePath,
          ],
        );
        return mapSession(result.rows[0] as Record<string, unknown>);
      });
    },

    async failAiContentUploadSession(input) {
      const scope = validateScope(input);
      const sessionId = requireUuid(input.sessionId, "ai_content_upload_session_id_invalid");
      const actor = requireUuid(input.createdByUserId, "ai_content_actor_user_id_invalid");
      if (!/^[a-z0-9_]{1,100}$/.test(input.errorCode)) {
        throw new Error("ai_content_upload_error_code_invalid");
      }
      return inTransaction(pool, async (client) => {
        await lockGeneration(client, scope);
        const result = await client.query(
          `select *, token_expires_at <= statement_timestamp() as is_expired
             from ai_content_attachment_upload_sessions
            where id = $1 and generation_id = $2 and workspace_id = $3 and brand_id = $4
              and created_by_user_id = $5
            for update`,
          [sessionId, scope.generationId, scope.workspaceId, scope.brandId, actor],
        );
        if (!result.rowCount) throw new Error("ai_content_upload_session_not_found");
        const session = result.rows[0] as Record<string, unknown>;
        if (session.status !== "pending") throw new Error("ai_content_upload_confirmation_conflict");
        await client.query(
          `update ai_content_attachment_upload_sessions
              set status = 'failed', failed_at = statement_timestamp(),
                  last_error_code = $2, updated_at = statement_timestamp()
            where id = $1`,
          [sessionId, input.errorCode],
        );
        await scheduleCleanup(client, session, "upload_issuance_failed", "token_expires_at");
      });
    },

    async confirmAiContentUploadSession(input, verify) {
      const scope = validateScope(input);
      const sessionId = requireUuid(input.sessionId, "ai_content_upload_session_id_invalid");
      const actor = requireUuid(input.createdByUserId, "ai_content_actor_user_id_invalid");
      const nonce = requireUuid(input.nonce, "ai_content_upload_nonce_invalid");

      return inTransaction(pool, async (client) => {
        const generation = await lockGeneration(client, scope);
        const result = await client.query(
          `select session.*,
                  session.token_expires_at <= statement_timestamp() as is_expired
             from ai_content_attachment_upload_sessions session
            where session.id = $1 and session.generation_id = $2
              and session.workspace_id = $3 and session.brand_id = $4
              and session.created_by_user_id = $5
            for update`,
          [sessionId, scope.generationId, scope.workspaceId, scope.brandId, actor],
        );
        if (!result.rowCount) throw new Error("ai_content_upload_session_not_found");
        const session = result.rows[0] as Record<string, unknown>;
        if (!safeEqual(String(session.nonce), nonce)) {
          throw new Error("ai_content_upload_confirmation_conflict");
        }
        if (session.status === "confirmed") {
          const replay = await client.query(
            `select id, generation_id, role, file_name, mime_type, size_bytes,
                    checksum, storage_url, storage_path, created_at
               from ai_content_generation_attachments
              where id = $1 and generation_id = $2 and workspace_id = $3 and brand_id = $4`,
            [session.confirmed_attachment_id, scope.generationId, scope.workspaceId, scope.brandId],
          );
          if (!replay.rowCount) throw new Error("ai_content_upload_confirmation_conflict");
          return mapAttachment(replay.rows[0] as Record<string, unknown>);
        }
        if (session.status !== "pending") throw new Error("ai_content_upload_session_expired");
        if (session.is_expired === true) {
          await client.query(
            `update ai_content_attachment_upload_sessions
                set status = 'expired', expired_at = statement_timestamp(),
                    updated_at = statement_timestamp()
              where id = $1 and status = 'pending'`,
            [sessionId],
          );
          await scheduleCleanup(client, session, "upload_session_expired", "statement_timestamp()");
          throw new CommitAndThrow(new Error("ai_content_upload_session_expired"));
        }
        assertMutable(generation);

        const verificationSession: AiContentUploadVerificationSession = {
          id: String(session.id),
          generationId: String(session.generation_id),
          workspaceId: String(session.workspace_id),
          brandId: String(session.brand_id),
          role: session.role as AiContentUploadVerificationSession["role"],
          fileName: String(session.file_name),
          mimeType: String(session.expected_mime_type),
          sizeBytes: Number(session.expected_size_bytes),
          checksum: String(session.expected_checksum),
          storagePath: String(session.storage_path),
          tokenExpiresAt: iso(session.token_expires_at),
        };
        const controller = new AbortController();
        let rejectTimeout: ((reason: Error) => void) | undefined;
        const timeout = new Promise<never>((_, reject) => {
          rejectTimeout = reject;
        });
        const timer = setTimeout(() => {
          controller.abort();
          rejectTimeout?.(new Error("ai_content_attachment_verification_timeout"));
        }, CONFIRM_TIMEOUT_MS);
        let verified: VerifiedAiContentUpload;
        try {
          try {
            verified = await Promise.race([verify(verificationSession, controller.signal), timeout]);
          } catch (error) {
            if (error instanceof Error && /^ai_content_[a-z0-9_]+$/.test(error.message)) {
              throw error;
            }
            throw new Error("ai_content_attachment_storage_unavailable");
          }
        } finally {
          clearTimeout(timer);
        }
        if (
          verified.storagePath !== verificationSession.storagePath
          || verified.mimeType.toLowerCase() !== verificationSession.mimeType.toLowerCase()
          || verified.sizeBytes !== verificationSession.sizeBytes
        ) {
          throw new Error("ai_content_upload_confirmation_conflict");
        }
        const attachmentId = randomUUID();
        const inserted = await client.query(
          `insert into ai_content_generation_attachments (
             id, generation_id, workspace_id, brand_id, upload_session_id,
             role, file_name, mime_type, size_bytes, checksum, storage_url, storage_path
           ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
           returning id, generation_id, role, file_name, mime_type, size_bytes,
                     checksum, storage_url, storage_path, created_at`,
          [
            attachmentId,
            scope.generationId,
            scope.workspaceId,
            scope.brandId,
            sessionId,
            session.role,
            session.file_name,
            session.expected_mime_type,
            session.expected_size_bytes,
            session.expected_checksum,
            verified.storageUrl,
            session.storage_path,
          ],
        );
        await client.query(
          `update ai_content_attachment_upload_sessions
              set status = 'confirmed', confirmed_at = statement_timestamp(),
                  confirmed_attachment_id = $2, storage_url = $3,
                  updated_at = statement_timestamp()
            where id = $1 and status = 'pending'`,
          [sessionId, attachmentId, verified.storageUrl],
        );
        return mapAttachment(inserted.rows[0] as Record<string, unknown>);
      });
    },

    async cancelAiContentUploadSession(input) {
      const scope = validateScope(input);
      const sessionId = requireUuid(input.sessionId, "ai_content_upload_session_id_invalid");
      const actor = requireUuid(input.createdByUserId, "ai_content_actor_user_id_invalid");
      const nonce = requireUuid(input.nonce, "ai_content_upload_nonce_invalid");
      return inTransaction(pool, async (client) => {
        await lockGeneration(client, scope);
        const result = await client.query(
          `select *, token_expires_at <= statement_timestamp() as is_expired
             from ai_content_attachment_upload_sessions
            where id = $1 and generation_id = $2 and workspace_id = $3 and brand_id = $4
              and created_by_user_id = $5
            for update`,
          [sessionId, scope.generationId, scope.workspaceId, scope.brandId, actor],
        );
        if (!result.rowCount) throw new Error("ai_content_upload_session_not_found");
        const session = result.rows[0] as Record<string, unknown>;
        if (!safeEqual(String(session.nonce), nonce)) {
          throw new Error("ai_content_upload_confirmation_conflict");
        }
        if (session.status !== "pending") throw new Error("ai_content_upload_session_expired");
        if (session.is_expired === true) {
          await client.query(
            `update ai_content_attachment_upload_sessions
                set status = 'expired', expired_at = statement_timestamp(),
                    updated_at = statement_timestamp()
              where id = $1 and status = 'pending'`,
            [sessionId],
          );
          await scheduleCleanup(client, session, "upload_session_expired", "statement_timestamp()");
          throw new CommitAndThrow(new Error("ai_content_upload_session_expired"));
        }
        await client.query(
          `update ai_content_attachment_upload_sessions
              set status = 'cancelled', cancelled_at = statement_timestamp(),
                  updated_at = statement_timestamp()
            where id = $1 and status = 'pending'`,
          [sessionId],
        );
        await scheduleCleanup(client, session, "upload_session_cancelled", "token_expires_at");
        return { id: sessionId };
      });
    },

    async confirmLegacyAiContentAttachment(input) {
      const scope = validateScope(input);
      return inTransaction(pool, async (client) => {
        assertMutable(await lockGeneration(client, scope));
        const existing = await client.query(
          `select id, generation_id, role, file_name, mime_type, size_bytes,
                  checksum, storage_url, storage_path, created_at, deleted_at
             from ai_content_generation_attachments
            where generation_id = $1 and workspace_id = $2 and brand_id = $3
              and storage_path = $4`,
          [scope.generationId, scope.workspaceId, scope.brandId, input.storagePath],
        );
        if (existing.rowCount) {
          const row = existing.rows[0] as Record<string, unknown>;
          if (
            row.deleted_at
            || row.role !== input.role
            || row.file_name !== input.fileName
            || row.mime_type !== input.mimeType
            || Number(row.size_bytes) !== input.sizeBytes
            || row.checksum !== input.checksum
            || row.storage_url !== input.storageUrl
          ) {
            throw new Error("ai_content_attachment_path_conflict");
          }
          return mapAttachment(row);
        }
        if (await countReservedSlots(client, scope) >= 5) {
          throw new Error("ai_content_attachment_limit_exceeded");
        }
        const attachmentId = randomUUID();
        const sessionId = randomUUID();
        await client.query(
          `insert into ai_content_attachment_upload_sessions (
             id, generation_id, workspace_id, brand_id, created_by_user_id, nonce,
             role, file_name, expected_mime_type, expected_size_bytes, expected_checksum,
             storage_url, storage_path, status, token_expires_at, confirmed_at,
             confirmed_attachment_id, is_legacy_backfill, created_at
           ) values (
             $1, $2, $3, $4, null, $5, $6, $7, $8, $9, $10, $11, $12,
             'confirmed', statement_timestamp() + interval '10 minutes',
             statement_timestamp(), $13, true, statement_timestamp()
           )`,
          [
            sessionId,
            scope.generationId,
            scope.workspaceId,
            scope.brandId,
            randomUUID(),
            input.role,
            input.fileName,
            input.mimeType,
            input.sizeBytes,
            input.checksum,
            input.storageUrl,
            input.storagePath,
            attachmentId,
          ],
        );
        const inserted = await client.query(
          `insert into ai_content_generation_attachments (
             id, generation_id, workspace_id, brand_id, upload_session_id,
             role, file_name, mime_type, size_bytes, checksum, storage_url, storage_path
           ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
           returning id, generation_id, role, file_name, mime_type, size_bytes,
                     checksum, storage_url, storage_path, created_at`,
          [
            attachmentId,
            scope.generationId,
            scope.workspaceId,
            scope.brandId,
            sessionId,
            input.role,
            input.fileName,
            input.mimeType,
            input.sizeBytes,
            input.checksum,
            input.storageUrl,
            input.storagePath,
          ],
        );
        return mapAttachment(inserted.rows[0] as Record<string, unknown>);
      });
    },

    async removeAiContentAttachment(input) {
      const scope = validateScope(input);
      const attachmentId = requireUuid(input.attachmentId, "ai_content_attachment_id_invalid");
      return inTransaction(pool, async (client) => {
        assertMutable(await lockGeneration(client, scope));
        const removed = await client.query(
          `update ai_content_generation_attachments
              set deleted_at = statement_timestamp(), deletion_reason = 'user_removed',
                  physical_delete_status = 'pending'
            where id = $1 and generation_id = $2 and workspace_id = $3 and brand_id = $4
              and deleted_at is null
            returning *`,
          [attachmentId, scope.generationId, scope.workspaceId, scope.brandId],
        );
        if (!removed.rowCount) throw new Error("ai_content_attachment_not_found");
        const attachment = removed.rows[0] as Record<string, unknown>;
        await scheduleCleanup(client, {
          ...attachment,
          confirmed_attachment_id: attachment.id,
          id: attachment.upload_session_id,
          token_expires_at: attachment.created_at,
        }, "user_removed", "statement_timestamp()");
        return { id: String(attachment.id) };
      });
    },
  };
}
