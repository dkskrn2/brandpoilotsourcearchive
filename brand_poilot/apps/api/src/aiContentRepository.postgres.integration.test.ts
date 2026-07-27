import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createAiContentAttachmentRepository } from "./aiContentAttachmentRepository.js";

const WORKSPACE_ID = "10000000-0000-4000-8000-000000000001";
const BRAND_ID = "20000000-0000-4000-8000-000000000001";
const GENERATION_ID = "30000000-0000-4000-8000-000000000001";
const USER_ID = "40000000-0000-4000-8000-000000000001";

async function applyRealMigrations(pool: Pool) {
  const directory = resolve(process.cwd(), "../../db/migrations");
  const skippedVectorMigrations = new Set([
    "021_dm_wiki_pgvector.sql",
    "027_wiki_search_v2.sql",
    "033_compounding_wiki_pgvector.sql",
  ]);
  for (const file of (await readdir(directory)).filter((name) => name.endsWith(".sql")).sort()) {
    if (skippedVectorMigrations.has(file)) continue;
    await pool.query(await readFile(resolve(directory, file), "utf8"));
  }
}

function upload(fileName: string) {
  return {
    workspaceId: WORKSPACE_ID,
    brandId: BRAND_ID,
    generationId: GENERATION_ID,
    createdByUserId: USER_ID,
    attachment: {
      role: "product" as const,
      fileName,
      mimeType: "image/png",
      sizeBytes: 100,
      checksum: "a".repeat(64),
    },
  };
}

describe.skipIf(process.env.RUN_POSTGRES_INTEGRATION !== "true")(
  "AI content attachment lifecycle on PostgreSQL 16 real migrations",
  () => {
    let container: StartedPostgreSqlContainer | null = null;
    let pool: Pool;

    beforeAll(async () => {
      container = await new PostgreSqlContainer("postgres:16-alpine")
        .withDatabase("brand_pilot_ai_content")
        .withUsername("brand_pilot")
        .withPassword("brand_pilot")
        .start();
      pool = new Pool({
        connectionString: container.getConnectionUri(),
        max: 8,
        application_name: "ai-content-attachment-lifecycle",
      });
      await applyRealMigrations(pool);
      await pool.query(
        "insert into app_users (id, email) values ($1, 'attachment-member@example.com')",
        [USER_ID],
      );
      await pool.query(
        `insert into workspaces (id, name, slug, created_by_user_id)
         values ($1, 'Attachment Workspace', 'attachment-workspace', $2)`,
        [WORKSPACE_ID, USER_ID],
      );
      await pool.query(
        `insert into workspace_members (workspace_id, user_id, role, status)
         values ($1, $2, 'owner', 'active')`,
        [WORKSPACE_ID, USER_ID],
      );
      await pool.query(
        `insert into brands (id, workspace_id, name, created_by_user_id)
         values ($1, $2, 'Attachment Brand', $3)`,
        [BRAND_ID, WORKSPACE_ID, USER_ID],
      );
    }, 120_000);

    beforeEach(async () => {
      await pool.query(
        `truncate table ai_content_attachment_deletion_jobs,
                        ai_content_generation_attachments,
                        ai_content_attachment_upload_sessions,
                        ai_content_attachment_storage_path_guards,
                        ai_content_generations cascade`,
      );
      await pool.query(
        `insert into ai_content_generations (
           id, workspace_id, brand_id, type, title, status, analysis_idempotency_key
         ) values ($1, $2, $3, 'card_news', 'Attachment concurrency',
                   'analysis_ready', 'attachment-concurrency')`,
        [GENERATION_ID, WORKSPACE_ID, BRAND_ID],
      );
    });

    afterAll(async () => {
      try {
        await pool?.end();
      } finally {
        await container?.stop();
      }
    }, 120_000);

    it("allows exactly one of two concurrent reservations when four slots are occupied", async () => {
      const repository = createAiContentAttachmentRepository(pool);
      for (let index = 1; index <= 4; index += 1) {
        await repository.createAiContentUploadSession(upload(`occupied-${index}.png`));
      }

      const results = await Promise.allSettled([
        repository.createAiContentUploadSession(upload("concurrent-a.png")),
        repository.createAiContentUploadSession(upload("concurrent-b.png")),
      ]);

      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      const rejected = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
      expect(rejected?.reason).toMatchObject({ message: "ai_content_attachment_limit_exceeded" });
      const count = await pool.query(
        `select count(*)::integer as count
           from ai_content_attachment_upload_sessions
          where generation_id = $1 and status = 'pending'
            and token_expires_at > statement_timestamp()`,
        [GENERATION_ID],
      );
      expect(count.rows[0]?.count).toBe(5);
    });

    it("serializes concurrent confirms into one transition and one replay", async () => {
      const repository = createAiContentAttachmentRepository(pool);
      const session = await repository.createAiContentUploadSession(upload("confirm-once.png"));
      const verify = vi.fn(async (stored: { storagePath: string }) => ({
        storagePath: stored.storagePath,
        storageUrl: `https://test.public.blob.vercel-storage.com/${stored.storagePath}`,
        mimeType: "image/png",
        sizeBytes: 100,
      }));
      const confirmation = {
        workspaceId: WORKSPACE_ID,
        brandId: BRAND_ID,
        generationId: GENERATION_ID,
        createdByUserId: USER_ID,
        sessionId: session.id,
        nonce: session.nonce,
      };

      const [first, replay] = await Promise.all([
        repository.confirmAiContentUploadSession(confirmation, verify),
        repository.confirmAiContentUploadSession(confirmation, verify),
      ]);

      expect(replay).toEqual(first);
      expect(verify).toHaveBeenCalledOnce();
      const transitions = await pool.query(
        `select count(*)::integer as count
           from ai_content_generation_attachments
          where upload_session_id = $1`,
        [session.id],
      );
      expect(transitions.rows[0]?.count).toBe(1);
    });
  },
);
