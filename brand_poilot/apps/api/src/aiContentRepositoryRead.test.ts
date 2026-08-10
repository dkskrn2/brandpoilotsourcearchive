import type { Pool } from "pg";
import { describe, expect, it } from "vitest";
import { createAiContentRepository } from "./aiContentRepository.js";

const scope = {
  workspaceId: "10000000-0000-4000-8000-000000000001",
  brandId: "20000000-0000-4000-8000-000000000002",
  generationId: "30000000-0000-4000-8000-000000000003",
};

describe("getAiContentGeneration attachment recovery", () => {
  it("returns only the live attachments selected by generation and tenant scope", async () => {
    const statements: Array<{ sql: string; values: unknown[] }> = [];
    let released = false;
    const client = {
      async query(sql: string, values: unknown[] = []) {
        statements.push({ sql, values });
        if (/^(begin|commit|rollback)/i.test(sql)) return { rows: [], rowCount: 0 };
        if (sql.includes("from ai_content_generations\n")) {
          return {
            rows: [{
              id: scope.generationId,
              workspace_id: scope.workspaceId,
              brand_id: scope.brandId,
              output_format: "blog",
              purpose: "informational",
              title: "Resume draft",
              status: "draft",
              current_stage: null,
              draft_json: {},
              analysis_json: {},
              generation_input_snapshot: {},
              orchestration_snapshot: {},
              avatar_snapshot: {},
              attachments_locked_at: null,
              terminal_at: null,
              retryable_until: null,
              error_code: null,
              error_message: null,
              created_at: "2026-08-09T00:00:00.000Z",
              updated_at: "2026-08-09T00:00:00.000Z",
              completed_at: null,
            }],
            rowCount: 1,
          };
        }
        if (sql.includes("from ai_content_generation_attachments")) {
          return {
            rows: [{
              id: "40000000-0000-4000-8000-000000000004",
              generation_id: scope.generationId,
              role: "product_image",
              file_name: "live.png",
              mime_type: "image/png",
              size_bytes: 10,
              checksum: "a".repeat(64),
              storage_url: "https://blob.example/live.png",
              storage_path: "live.png",
              created_at: "2026-08-09T00:01:00.000Z",
            }],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      },
      release() {
        released = true;
      },
    };
    const pool = {
      async connect() {
        return client;
      },
      async query() {
        throw new Error("generation_read_outside_consistent_snapshot");
      },
    } as unknown as Pool;

    const result = await createAiContentRepository(pool).getAiContentGeneration(scope);

    expect(result?.attachments).toEqual([
      expect.objectContaining({
        id: "40000000-0000-4000-8000-000000000004",
        generationId: scope.generationId,
        fileName: "live.png",
      }),
    ]);
    const attachmentRead = statements.find(({ sql }) => sql.includes("from ai_content_generation_attachments"));
    expect(attachmentRead?.values).toEqual([scope.generationId, scope.workspaceId, scope.brandId]);
    expect(attachmentRead?.sql).toMatch(/generation_id\s*=\s*\$1[\s\S]*workspace_id\s*=\s*\$2[\s\S]*brand_id\s*=\s*\$3[\s\S]*deleted_at is null/);
    expect(statements[0]?.sql).toMatch(/begin transaction isolation level repeatable read read only/i);
    expect(statements.at(-1)?.sql).toBe("COMMIT");
    expect(released).toBe(true);
  });
});
