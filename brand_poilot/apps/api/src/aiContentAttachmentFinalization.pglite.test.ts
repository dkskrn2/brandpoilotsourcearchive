import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { createAiContentAttachmentRepository } from "./aiContentAttachmentRepository.js";

const WORKSPACE_ID = "10000000-0000-4000-8000-000000000001";
const BRAND_ID = "20000000-0000-4000-8000-000000000001";
const GENERATION_ID = "30000000-0000-4000-8000-000000000001";
const FOREIGN_WORKSPACE_ID = "10000000-0000-4000-8000-000000000002";
const FOREIGN_BRAND_ID = "20000000-0000-4000-8000-000000000002";
const FOREIGN_GENERATION_ID = "30000000-0000-4000-8000-000000000002";
const RETAINED_BEFORE_ID = "40000000-0000-4000-8000-000000000001";
const REMOVED_ID = "40000000-0000-4000-8000-000000000002";
const RETAINED_AFTER_ID = "40000000-0000-4000-8000-000000000003";
const SESSION_ID = "50000000-0000-4000-8000-000000000001";

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

function proposalDraft(attachmentIds: string[]) {
  return {
    origin: "proposal-v2",
    proposalBatchId: "60000000-0000-4000-8000-000000000001",
    proposalId: "70000000-0000-4000-8000-000000000001",
    finalization: {
      contractVersion: "content-finalization-draft.v2",
      avatarStyleImageId: null,
      userImageInstruction: "저장된 이미지 지시",
      attachmentIds,
    },
  };
}

describe("proposal V2 attachment finalization removal", () => {
  let database: PGlite;

  beforeEach(async () => {
    database = await PGlite.create();
    await database.exec(`
      create table ai_content_generations (
        id uuid primary key,
        workspace_id uuid not null,
        brand_id uuid not null,
        status text not null,
        draft_json jsonb not null,
        attachments_locked_at timestamptz null,
        updated_at timestamptz not null default statement_timestamp(),
        unique (id, workspace_id, brand_id)
      );
      create table ai_content_attachment_upload_sessions (
        id uuid primary key,
        generation_id uuid not null,
        workspace_id uuid not null,
        brand_id uuid not null,
        storage_path text not null,
        created_at timestamptz not null default statement_timestamp()
      );
      create table ai_content_generation_attachments (
        id uuid primary key,
        generation_id uuid not null,
        workspace_id uuid not null,
        brand_id uuid not null,
        upload_session_id uuid null,
        role text not null,
        file_name text not null,
        mime_type text not null,
        size_bytes bigint not null,
        checksum text not null,
        storage_url text not null,
        storage_path text not null,
        created_at timestamptz not null default statement_timestamp(),
        deleted_at timestamptz null,
        deletion_reason text null,
        physical_delete_status text not null default 'live'
      );
      create table ai_content_attachment_deletion_jobs (
        id uuid primary key,
        workspace_id uuid not null,
        brand_id uuid not null,
        generation_id uuid not null,
        attachment_id uuid null,
        upload_session_id uuid null,
        storage_url text null,
        storage_path text not null,
        reason text not null,
        status text not null,
        next_attempt_at timestamptz not null,
        unique (workspace_id, storage_path)
      );
    `);
  }, 30_000);

  afterEach(async () => database.close());

  it("keeps GET recovery ids aligned after the saved finalization attachment is deleted", async () => {
    await database.query(
      `insert into ai_content_generations(id,workspace_id,brand_id,status,draft_json)
       values($1,$2,$3,'draft',$4::jsonb),($5,$6,$7,'draft',$8::jsonb)`,
      [
        GENERATION_ID,
        WORKSPACE_ID,
        BRAND_ID,
        JSON.stringify(proposalDraft([RETAINED_BEFORE_ID, REMOVED_ID, RETAINED_AFTER_ID])),
        FOREIGN_GENERATION_ID,
        FOREIGN_WORKSPACE_ID,
        FOREIGN_BRAND_ID,
        JSON.stringify(proposalDraft([REMOVED_ID])),
      ],
    );
    await database.query(
      `insert into ai_content_attachment_upload_sessions(id,generation_id,workspace_id,brand_id,storage_path)
       values($1,$2,$3,$4,'removed.png')`,
      [SESSION_ID, GENERATION_ID, WORKSPACE_ID, BRAND_ID],
    );
    await database.query(
      `insert into ai_content_generation_attachments(
         id,generation_id,workspace_id,brand_id,upload_session_id,role,file_name,mime_type,
         size_bytes,checksum,storage_url,storage_path,created_at
       ) values
         ($1,$4,$5,$6,null,'product_image','before.png','image/png',100,$7,'https://blob/before.png','before.png','2026-08-09T00:00:01Z'),
         ($2,$4,$5,$6,$8,'product_image','removed.png','image/png',100,$7,'https://blob/removed.png','removed.png','2026-08-09T00:00:02Z'),
         ($3,$4,$5,$6,null,'supporting_image','after.png','image/png',100,$7,'https://blob/after.png','after.png','2026-08-09T00:00:03Z')`,
      [
        RETAINED_BEFORE_ID,
        REMOVED_ID,
        RETAINED_AFTER_ID,
        GENERATION_ID,
        WORKSPACE_ID,
        BRAND_ID,
        "a".repeat(64),
        SESSION_ID,
      ],
    );

    await createAiContentAttachmentRepository(pglitePool(database)).removeAiContentAttachment({
      workspaceId: WORKSPACE_ID,
      brandId: BRAND_ID,
      generationId: GENERATION_ID,
      attachmentId: REMOVED_ID,
    });

    const recovered = await database.query<{ attachment_ids: string[]; live_ids: string[] }>(
      `select generation.draft_json#>'{finalization,attachmentIds}' as attachment_ids,
              coalesce(jsonb_agg(attachment.id order by attachment.created_at)
                filter(where attachment.deleted_at is null),'[]'::jsonb) as live_ids
         from ai_content_generations generation
         left join ai_content_generation_attachments attachment
           on attachment.generation_id=generation.id
          and attachment.workspace_id=generation.workspace_id
          and attachment.brand_id=generation.brand_id
        where generation.id=$1 and generation.workspace_id=$2 and generation.brand_id=$3
        group by generation.id`,
      [GENERATION_ID, WORKSPACE_ID, BRAND_ID],
    );
    expect(recovered.rows).toEqual([{
      attachment_ids: [RETAINED_BEFORE_ID, RETAINED_AFTER_ID],
      live_ids: [RETAINED_BEFORE_ID, RETAINED_AFTER_ID],
    }]);
    const foreign = await database.query<{ attachment_ids: string[] }>(
      `select draft_json#>'{finalization,attachmentIds}' as attachment_ids
         from ai_content_generations
        where id=$1 and workspace_id=$2 and brand_id=$3`,
      [FOREIGN_GENERATION_ID, FOREIGN_WORKSPACE_ID, FOREIGN_BRAND_ID],
    );
    expect(foreign.rows).toEqual([{ attachment_ids: [REMOVED_ID] }]);
  });
});
