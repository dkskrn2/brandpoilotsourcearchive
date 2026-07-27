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
  const client = {
    async query(query: string) {
      commands.push(query);
      if (query === "BEGIN" || query === "COMMIT" || query === "ROLLBACK") {
        return { rows: [], rowCount: 0 };
      }
      sql.push(query);
      return rows.shift() ?? { rows: [], rowCount: 0 };
    },
    release() {},
  };
  return {
    connect: async () => client,
    query: client.query,
    sql,
    commands,
  };
}

describe("AiContentAttachmentLifecycleRepository", () => {
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
        return new Promise(() => undefined);
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
    } finally {
      vi.useRealTimers();
    }
  });
});
