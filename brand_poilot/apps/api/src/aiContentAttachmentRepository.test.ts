import { describe, expect, it, vi } from "vitest";
import { createAiContentAttachmentRepository } from "./aiContentAttachmentRepository.js";

const SCOPE = {
  workspaceId: "10000000-0000-4000-8000-000000000001",
  brandId: "20000000-0000-4000-8000-000000000001",
  generationId: "30000000-0000-4000-8000-000000000001",
};
const USER_ID = "40000000-0000-4000-8000-000000000001";

function attachment(fileName = "product.png") {
  return {
    role: "product" as const,
    fileName,
    mimeType: "image/png",
    sizeBytes: 100,
    checksum: "a".repeat(64),
  };
}

function scriptedPool(rows: Array<{ rows: Record<string, unknown>[]; rowCount: number }>) {
  const sql: string[] = [];
  const commands: string[] = [];
  const events: string[] = [];
  const releaseCalls: Array<Error | undefined> = [];
  const client = {
    async query(query: string) {
      commands.push(query);
      events.push(query);
      if (query === "BEGIN" || query === "COMMIT" || query === "ROLLBACK") {
        return { rows: [], rowCount: 0 };
      }
      sql.push(query);
      return rows.shift() ?? { rows: [], rowCount: 0 };
    },
    release(error?: Error) {
      releaseCalls.push(error);
      events.push("RELEASE");
    },
  };
  return {
    connect: async () => client,
    query: client.query,
    sql,
    commands,
    events,
    releaseCalls,
  };
}

function transactionFailurePool(options: {
  beginError?: Error;
  operationError?: Error;
  commitError?: Error;
  rollbackError?: Error;
  rows?: Array<{ rows: Record<string, unknown>[]; rowCount: number }>;
}) {
  const commands: string[] = [];
  const releaseCalls: Array<Error | undefined> = [];
  const rows = [...(options.rows ?? [])];
  const label = (query: string) => {
    if (query === "BEGIN" || query === "COMMIT" || query === "ROLLBACK") return query;
    if (query.includes("from ai_content_generations")) return "LOCK_GENERATION";
    if (query.includes("from ai_content_attachment_upload_sessions")) return "LOCK_SESSION";
    if (query.includes("set status = 'expired'")) return "EXPIRE_SESSION";
    if (query.includes("insert into ai_content_attachment_deletion_jobs")) return "SCHEDULE_CLEANUP";
    return "OPERATION";
  };
  const client = {
    async query(query: string) {
      commands.push(label(query));
      if (query === "BEGIN" && options.beginError) throw options.beginError;
      if (query === "COMMIT" && options.commitError) throw options.commitError;
      if (query === "ROLLBACK" && options.rollbackError) throw options.rollbackError;
      if (!["BEGIN", "COMMIT", "ROLLBACK"].includes(query) && options.operationError) {
        throw options.operationError;
      }
      if (query === "BEGIN" || query === "COMMIT" || query === "ROLLBACK") {
        return { rows: [], rowCount: 0 };
      }
      return rows.shift() ?? { rows: [], rowCount: 0 };
    },
    release(error?: Error) {
      releaseCalls.push(error);
    },
  };
  return {
    connect: async () => client,
    query: client.query,
    commands,
    releaseCalls,
  };
}

describe("AiContentAttachmentLifecycleRepository", () => {
  it("does not rollback when BEGIN fails and destroys the questionable connection", async () => {
    const beginError = new Error("begin_failed");
    const pool = transactionFailurePool({ beginError });
    const repository = createAiContentAttachmentRepository(pool as never);

    await expect(repository.assertAiContentAttachmentUploadMutable(SCOPE))
      .rejects.toBe(beginError);
    expect(pool.commands).toEqual(["BEGIN"]);
    expect(pool.releaseCalls).toEqual([beginError]);
  });

  it("rolls back an operation failure and releases the usable connection once", async () => {
    const operationError = new Error("operation_failed");
    const pool = transactionFailurePool({ operationError });
    const repository = createAiContentAttachmentRepository(pool as never);

    await expect(repository.assertAiContentAttachmentUploadMutable(SCOPE))
      .rejects.toBe(operationError);
    expect(pool.commands).toEqual(["BEGIN", "LOCK_GENERATION", "ROLLBACK"]);
    expect(pool.releaseCalls).toEqual([undefined]);
  });

  it("preserves the operation error when rollback fails and destroys the connection", async () => {
    const operationError = new Error("operation_failed");
    const rollbackError = new Error("rollback_failed");
    const pool = transactionFailurePool({ operationError, rollbackError });
    const repository = createAiContentAttachmentRepository(pool as never);

    await expect(repository.assertAiContentAttachmentUploadMutable(SCOPE))
      .rejects.toBe(operationError);
    expect(pool.commands).toEqual(["BEGIN", "LOCK_GENERATION", "ROLLBACK"]);
    expect(pool.releaseCalls).toEqual([rollbackError]);
  });

  it("best-effort rolls back a failed COMMIT and destroys the connection with the commit error", async () => {
    const commitError = new Error("commit_failed");
    const pool = transactionFailurePool({
      commitError,
      rows: [{ rows: [{ id: SCOPE.generationId, attachments_locked_at: null }], rowCount: 1 }],
    });
    const repository = createAiContentAttachmentRepository(pool as never);

    await expect(repository.assertAiContentAttachmentUploadMutable(SCOPE))
      .rejects.toBe(commitError);
    expect(pool.commands).toEqual(["BEGIN", "LOCK_GENERATION", "COMMIT", "ROLLBACK"]);
    expect(pool.releaseCalls).toEqual([commitError]);
  });

  it("keeps COMMIT as primary when its rollback also fails and releases with the rollback error", async () => {
    const commitError = new Error("commit_failed");
    const rollbackError = new Error("rollback_failed");
    const pool = transactionFailurePool({
      commitError,
      rollbackError,
      rows: [{ rows: [{ id: SCOPE.generationId, attachments_locked_at: null }], rowCount: 1 }],
    });
    const repository = createAiContentAttachmentRepository(pool as never);

    await expect(repository.assertAiContentAttachmentUploadMutable(SCOPE))
      .rejects.toBe(commitError);
    expect(pool.commands).toEqual(["BEGIN", "LOCK_GENERATION", "COMMIT", "ROLLBACK"]);
    expect(pool.releaseCalls).toEqual([rollbackError]);
  });

  it("does not report a committed domain transition when CommitAndThrow COMMIT fails", async () => {
    const commitError = new Error("commit_failed");
    const pool = transactionFailurePool({
      commitError,
      rows: [
        { rows: [{ id: SCOPE.generationId, attachments_locked_at: null }], rowCount: 1 },
        {
          rows: [{
            id: "50000000-0000-4000-8000-000000000001",
            generation_id: SCOPE.generationId,
            workspace_id: SCOPE.workspaceId,
            brand_id: SCOPE.brandId,
            created_by_user_id: USER_ID,
            nonce: "60000000-0000-4000-8000-000000000001",
            storage_path: "expired/path",
            status: "pending",
            is_expired: true,
            token_expires_at: "2026-07-27T12:00:00.000Z",
          }],
          rowCount: 1,
        },
        { rows: [], rowCount: 1 },
        { rows: [], rowCount: 1 },
      ],
    });
    const repository = createAiContentAttachmentRepository(pool as never);

    await expect(repository.confirmAiContentUploadSession({
      ...SCOPE,
      sessionId: "50000000-0000-4000-8000-000000000001",
      nonce: "60000000-0000-4000-8000-000000000001",
      createdByUserId: USER_ID,
    }, async () => {
      throw new Error("verifier_must_not_run");
    })).rejects.toBe(commitError);
    expect(pool.commands).toEqual([
      "BEGIN",
      "LOCK_GENERATION",
      "LOCK_SESSION",
      "EXPIRE_SESSION",
      "SCHEDULE_CLEANUP",
      "COMMIT",
      "ROLLBACK",
    ]);
    expect(pool.releaseCalls).toEqual([commitError]);
  });

  it("locks the generation before reserving a pending upload session", async () => {
    const pool = scriptedPool([
      { rows: [{ id: SCOPE.generationId, attachments_locked_at: null }], rowCount: 1 },
      { rows: [{ attachment_count: 4 }], rowCount: 1 },
      {
        rows: [{
          id: "50000000-0000-4000-8000-000000000001",
          generation_id: SCOPE.generationId,
          workspace_id: SCOPE.workspaceId,
          brand_id: SCOPE.brandId,
          created_by_user_id: USER_ID,
          nonce: "60000000-0000-4000-8000-000000000001",
          role: "product",
          file_name: "product.png",
          expected_mime_type: "image/png",
          expected_size_bytes: 100,
          expected_checksum: "a".repeat(64),
          storage_path: "reserved/path",
          status: "pending",
          token_expires_at: "2026-07-27T12:10:00.000Z",
          created_at: "2026-07-27T12:00:00.000Z",
        }],
        rowCount: 1,
      },
    ]);
    const repository = createAiContentAttachmentRepository(pool as never, {
      createId: (() => {
        const ids = [
          "50000000-0000-4000-8000-000000000001",
          "70000000-0000-4000-8000-000000000001",
          "60000000-0000-4000-8000-000000000001",
        ];
        return () => ids.shift()!;
      })(),
    });

    await expect(repository.createAiContentUploadSession({
      ...SCOPE,
      createdByUserId: USER_ID,
      attachment: attachment(),
    })).resolves.toMatchObject({ status: "pending", storagePath: "reserved/path" });

    expect(pool.sql[0]).toContain("for update");
    expect(pool.sql[1]).toContain("token_expires_at > statement_timestamp()");
    expect(pool.sql[2]).toContain("insert into ai_content_attachment_upload_sessions");
    expect(pool.commands.at(-1)).toBe("COMMIT");
  });

  it("rolls back a transient verifier failure and clears the timeout", async () => {
    const session = {
      id: "50000000-0000-4000-8000-000000000001",
      generation_id: SCOPE.generationId,
      workspace_id: SCOPE.workspaceId,
      brand_id: SCOPE.brandId,
      created_by_user_id: USER_ID,
      nonce: "60000000-0000-4000-8000-000000000001",
      role: "product",
      file_name: "product.png",
      expected_mime_type: "image/png",
      expected_size_bytes: 100,
      expected_checksum: "a".repeat(64),
      storage_path: "reserved/path",
      storage_url: null,
      status: "pending",
      token_expires_at: "2099-07-27T12:10:00.000Z",
      confirmed_attachment_id: null,
      created_at: "2099-07-27T12:00:00.000Z",
    };
    const pool = scriptedPool([
      { rows: [{ id: SCOPE.generationId, attachments_locked_at: null }], rowCount: 1 },
      { rows: [session], rowCount: 1 },
    ]);
    const repository = createAiContentAttachmentRepository(pool as never);

    await expect(repository.confirmAiContentUploadSession({
      ...SCOPE,
      sessionId: String(session.id),
      nonce: String(session.nonce),
      createdByUserId: USER_ID,
    }, async () => {
      throw new Error("provider secret: account=customer@example.com");
    })).rejects.toThrow("ai_content_attachment_storage_unavailable");

    expect(pool.commands).toContain("ROLLBACK");
    expect(pool.commands).not.toContain("COMMIT");
    expect(pool.sql.join("\n")).not.toContain("customer@example.com");
  });

  it("returns a matching confirmed replay before rejecting a generation lock", async () => {
    const attachmentRow = {
      id: "80000000-0000-4000-8000-000000000001",
      generation_id: SCOPE.generationId,
      role: "product",
      file_name: "product.png",
      mime_type: "image/png",
      size_bytes: 100,
      checksum: "a".repeat(64),
      storage_url: "https://test.public.blob.vercel-storage.com/reserved/path",
      storage_path: "reserved/path",
      created_at: "2026-07-27T12:01:00.000Z",
    };
    const pool = scriptedPool([
      { rows: [{ id: SCOPE.generationId, attachments_locked_at: "2026-07-27T12:02:00.000Z" }], rowCount: 1 },
      {
        rows: [{
          id: "50000000-0000-4000-8000-000000000001",
          created_by_user_id: USER_ID,
          nonce: "60000000-0000-4000-8000-000000000001",
          status: "confirmed",
          confirmed_attachment_id: attachmentRow.id,
        }],
        rowCount: 1,
      },
      { rows: [attachmentRow], rowCount: 1 },
    ]);
    const repository = createAiContentAttachmentRepository(pool as never);

    await expect(repository.confirmAiContentUploadSession({
      ...SCOPE,
      sessionId: "50000000-0000-4000-8000-000000000001",
      nonce: "60000000-0000-4000-8000-000000000001",
      createdByUserId: USER_ID,
    }, async () => {
      throw new Error("verifier_must_not_run");
    })).resolves.toMatchObject({ id: attachmentRow.id });
  });

  it("aborts a hung verifier after 15 seconds and releases the transaction for retry", async () => {
    vi.useFakeTimers();
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    try {
      const session = {
        id: "50000000-0000-4000-8000-000000000001",
        generation_id: SCOPE.generationId,
        workspace_id: SCOPE.workspaceId,
        brand_id: SCOPE.brandId,
        created_by_user_id: USER_ID,
        nonce: "60000000-0000-4000-8000-000000000001",
        role: "product",
        file_name: "product.png",
        expected_mime_type: "image/png",
        expected_size_bytes: 100,
        expected_checksum: "a".repeat(64),
        storage_path: "reserved/path",
        status: "pending",
        token_expires_at: "2099-07-27T12:10:00.000Z",
        is_expired: false,
      };
      const pool = scriptedPool([
        { rows: [{ id: SCOPE.generationId, attachments_locked_at: null }], rowCount: 1 },
        { rows: [session], rowCount: 1 },
      ]);
      const repository = createAiContentAttachmentRepository(pool as never);
      let signal: AbortSignal | undefined;
      const confirming = repository.confirmAiContentUploadSession({
        ...SCOPE,
        sessionId: String(session.id),
        nonce: String(session.nonce),
        createdByUserId: USER_ID,
      }, async (_stored, abortSignal) => {
        signal = abortSignal;
        return new Promise((_resolve, reject) => {
          setTimeout(() => reject(new Error("late_provider_rejection")), 20_000);
        });
      });
      const rejected = expect(confirming).rejects.toThrow(
        "ai_content_attachment_verification_timeout",
      );
      await vi.advanceTimersByTimeAsync(15_000);

      await rejected;
      expect(signal?.aborted).toBe(true);
      expect(pool.commands).toContain("ROLLBACK");
      expect(pool.commands.at(-1)).toBe("ROLLBACK");
      expect(pool.sql.join("\n")).not.toContain("update ai_content_attachment_upload_sessions");
      expect(pool.releaseCalls).toEqual([undefined]);
      expect(pool.events.slice(-2)).toEqual(["ROLLBACK", "RELEASE"]);
      await vi.advanceTimersByTimeAsync(5_000);
      await Promise.resolve();
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off("unhandledRejection", unhandled);
      vi.useRealTimers();
    }
  });

  it("rejects invalid generation, attachment, and session ids before any SQL", async () => {
    const pool = scriptedPool([]);
    const repository = createAiContentAttachmentRepository(pool as never);

    await expect(repository.createAiContentUploadSession({
      ...SCOPE,
      generationId: "not-a-generation",
      createdByUserId: USER_ID,
      attachment: attachment(),
    })).rejects.toThrow("ai_content_generation_id_invalid");
    await expect(repository.removeAiContentAttachment({
      ...SCOPE,
      attachmentId: "not-an-attachment",
    })).rejects.toThrow("ai_content_attachment_id_invalid");
    await expect(repository.cancelAiContentUploadSession({
      ...SCOPE,
      createdByUserId: USER_ID,
      sessionId: "not-a-session",
      nonce: "60000000-0000-4000-8000-000000000001",
    })).rejects.toThrow("ai_content_upload_session_id_invalid");

    expect(pool.commands).toEqual([]);
    expect(pool.sql).toEqual([]);
  });
});
