import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createAiContentRepository } from "./aiContentRepository.js";

const WORKSPACE_ID = "10000000-0000-4000-8000-000000000001";
const BRAND_ID = "20000000-0000-4000-8000-000000000001";
const GENERATION_ID = "30000000-0000-4000-8000-000000000001";

async function createSchema(pool: Pool) {
  await pool.query(`
    create table ai_content_generations (
      id uuid primary key,
      workspace_id uuid not null,
      brand_id uuid not null,
      type text not null default 'card_news',
      title text not null default 'Attachment concurrency',
      status text not null default 'analysis_ready',
      current_stage text null,
      draft_json jsonb not null default '{}'::jsonb,
      analysis_json jsonb not null default '{}'::jsonb,
      generation_idempotency_key text null,
      subject_analysis_snapshot jsonb null,
      error_code text null,
      error_message text null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      completed_at timestamptz null,
      unique (id, workspace_id, brand_id)
    );
    create table ai_content_generation_attachments (
      id uuid primary key default gen_random_uuid(),
      generation_id uuid not null,
      workspace_id uuid not null,
      brand_id uuid not null,
      role text not null,
      file_name text not null,
      mime_type text not null,
      size_bytes bigint not null,
      checksum text not null,
      storage_url text not null,
      storage_path text not null,
      created_at timestamptz not null default now(),
      deleted_at timestamptz null,
      unique (generation_id, storage_path),
      foreign key (generation_id, workspace_id, brand_id)
        references ai_content_generations(id, workspace_id, brand_id)
        on delete cascade
    );
  `);
}

function attachment(storagePath: string, overrides: Partial<{
  role: "product" | "person" | "scale" | "visual_reference" | "document";
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  checksum: string;
}> = {}) {
  return {
    workspaceId: WORKSPACE_ID,
    brandId: BRAND_ID,
    generationId: GENERATION_ID,
    role: overrides.role ?? "product",
    fileName: overrides.fileName ?? `${storagePath}.png`,
    mimeType: overrides.mimeType ?? "image/png",
    sizeBytes: overrides.sizeBytes ?? 100,
    checksum: overrides.checksum ?? "a".repeat(64),
    storageUrl: `https://test.public.blob.vercel-storage.com/${storagePath}`,
    storagePath,
  };
}

async function seedAttachment(pool: Pool, input: ReturnType<typeof attachment>, deleted = false) {
  await pool.query(
    `insert into ai_content_generation_attachments
       (generation_id, workspace_id, brand_id, role, file_name, mime_type, size_bytes, checksum, storage_url, storage_path, deleted_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, ${deleted ? "now()" : "null"})`,
    [
      input.generationId,
      input.workspaceId,
      input.brandId,
      input.role,
      input.fileName,
      input.mimeType,
      input.sizeBytes,
      input.checksum,
      input.storageUrl,
      input.storagePath,
    ],
  );
}

describe.skipIf(process.env.RUN_POSTGRES_INTEGRATION !== "true")("AI content attachment PostgreSQL concurrency", () => {
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
      max: 6,
      application_name: "ai-content-attachment-concurrency",
    });
    await createSchema(pool);
  }, 120_000);

  beforeEach(async () => {
    await pool.query("truncate table ai_content_generation_attachments, ai_content_generations");
    await pool.query(
      "insert into ai_content_generations (id, workspace_id, brand_id) values ($1, $2, $3)",
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

  it("allows exactly one of two concurrent distinct confirms when four paths are active", async () => {
    for (let index = 1; index <= 4; index += 1) {
      await seedAttachment(pool, attachment(`active-${index}`));
    }
    const repository = createAiContentRepository(pool);

    const results = await Promise.allSettled([
      repository.confirmAiContentAttachment(attachment("concurrent-a")),
      repository.confirmAiContentAttachment(attachment("concurrent-b")),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
    expect(rejected?.reason).toMatchObject({ message: "ai_content_attachment_limit_exceeded" });
    const count = await pool.query(
      "select count(*)::integer as count from ai_content_generation_attachments where generation_id = $1 and deleted_at is null",
      [GENERATION_ID],
    );
    expect(count.rows[0]?.count).toBe(5);
  });

  it("keeps an active same path idempotent for a legacy generation over the cap", async () => {
    for (let index = 1; index <= 6; index += 1) {
      await seedAttachment(pool, attachment(`active-${index}`));
    }
    const repository = createAiContentRepository(pool);

    await expect(repository.confirmAiContentAttachment(attachment("active-6", {
      role: "person",
      fileName: "updated-person.png",
      checksum: "b".repeat(64),
    }))).resolves.toMatchObject({ role: "person", fileName: "updated-person.png" });

    const count = await pool.query(
      "select count(*)::integer as count from ai_content_generation_attachments where generation_id = $1 and deleted_at is null",
      [GENERATION_ID],
    );
    expect(count.rows[0]?.count).toBe(6);
  });

  it("resurrects a deleted same path into the fifth active slot with current metadata", async () => {
    for (let index = 1; index <= 4; index += 1) {
      await seedAttachment(pool, attachment(`active-${index}`));
    }
    await seedAttachment(pool, attachment("reusable", {
      fileName: "old.png",
      checksum: "c".repeat(64),
    }), true);
    const repository = createAiContentRepository(pool);

    await expect(repository.confirmAiContentAttachment(attachment("reusable", {
      role: "document",
      fileName: "replacement.md",
      mimeType: "text/markdown",
      sizeBytes: 321,
      checksum: "d".repeat(64),
    }))).resolves.toMatchObject({
      role: "document",
      fileName: "replacement.md",
      mimeType: "text/markdown",
      sizeBytes: 321,
      checksum: "d".repeat(64),
    });

    const row = await pool.query(
      `select role, file_name, mime_type, size_bytes::integer, checksum, deleted_at
         from ai_content_generation_attachments
        where generation_id = $1 and storage_path = 'reusable'`,
      [GENERATION_ID],
    );
    expect(row.rows[0]).toEqual({
      role: "document",
      file_name: "replacement.md",
      mime_type: "text/markdown",
      size_bytes: 321,
      checksum: "d".repeat(64),
      deleted_at: null,
    });
  });

  it("soft-deletes the scoped fifth attachment and accepts a replacement path", async () => {
    for (let index = 1; index <= 5; index += 1) {
      await seedAttachment(pool, attachment(`active-${index}`));
    }
    const existing = await pool.query(
      "select id from ai_content_generation_attachments where generation_id = $1 and storage_path = 'active-5'",
      [GENERATION_ID],
    );
    const repository = createAiContentRepository(pool);

    await expect(repository.removeAiContentAttachment({
      workspaceId: WORKSPACE_ID,
      brandId: BRAND_ID,
      generationId: GENERATION_ID,
      attachmentId: existing.rows[0]?.id,
    })).resolves.toEqual({ id: existing.rows[0]?.id });
    await expect(repository.confirmAiContentAttachment(attachment("replacement"))).resolves.toMatchObject({
      storagePath: "replacement",
    });

    const active = await pool.query(
      "select storage_path from ai_content_generation_attachments where generation_id = $1 and deleted_at is null order by storage_path",
      [GENERATION_ID],
    );
    expect(active.rows.map((row) => row.storage_path)).toEqual([
      "active-1",
      "active-2",
      "active-3",
      "active-4",
      "replacement",
    ]);
  });
});
