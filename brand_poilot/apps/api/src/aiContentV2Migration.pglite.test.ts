import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const VECTOR_MIGRATIONS = new Set([
  "021_dm_wiki_pgvector.sql",
  "027_wiki_search_v2.sql",
  "033_compounding_wiki_pgvector.sql",
]);

const MIGRATION_073 = "073_ai_content_generation_v2_render_pipeline.sql";

const ids = {
  actor: "10000000-0000-4000-8000-000000000072",
  workspace: "20000000-0000-4000-8000-000000000072",
  brand: "30000000-0000-4000-8000-000000000072",
  batch: "40000000-0000-4000-8000-000000000072",
  generation: "50000000-0000-4000-8000-000000000072",
  outputOne: "60000000-0000-4000-8000-000000000071",
  outputTwo: "60000000-0000-4000-8000-000000000072",
  legacyJob: "70000000-0000-4000-8000-000000000072",
  legacyAttachment: "80000000-0000-4000-8000-000000000072",
  legacyUpload: "90000000-0000-4000-8000-000000000072",
  proposalResearch: "a0000000-0000-4000-8000-000000000072",
  generationInput: "b0000000-0000-4000-8000-000000000072",
  outputResearch: "c0000000-0000-4000-8000-000000000072",
  deleteGeneration: "d0000000-0000-4000-8000-000000000072",
  deleteGenerationInput: "d1000000-0000-4000-8000-000000000072",
  cascadeOutput: "d2000000-0000-4000-8000-000000000072",
  attemptOutput: "d3000000-0000-4000-8000-000000000072",
  restrictBatch: "d4000000-0000-4000-8000-000000000072",
  restrictProposalResearch: "d5000000-0000-4000-8000-000000000072",
  restrictOutputGeneration: "d6000000-0000-4000-8000-000000000072",
  restrictOutput: "d7000000-0000-4000-8000-000000000072",
  restrictOutputResearch: "d8000000-0000-4000-8000-000000000072",
  mismatchedWorkspace: "e0000000-0000-4000-8000-000000000072",
  mismatchedBrand: "e1000000-0000-4000-8000-000000000072",
  mismatchedGeneration: "e2000000-0000-4000-8000-000000000072",
  mismatchedOutput: "e3000000-0000-4000-8000-000000000072",
};

async function applyMigrationsThrough072(database: PGlite, directory: string) {
  const migrations = (await readdir(directory))
    .filter((name) => /^\d{3}_.+\.sql$/.test(name) && name < MIGRATION_073)
    .sort();
  for (const migration of migrations) {
    if (VECTOR_MIGRATIONS.has(migration)) continue;
    await database.exec(await readFile(resolve(directory, migration), "utf8"));
  }
}

async function applyMigration073WhenPresent(database: PGlite, directory: string) {
  try {
    await database.exec(await readFile(resolve(directory, MIGRATION_073), "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

describe("migration 073 immutable V2 snapshots and render jobs", () => {
  let database: PGlite;

  beforeAll(async () => {
    database = await PGlite.create({ extensions: { pgcrypto } });
    const migrationDirectory = resolve(process.cwd(), "../../db/migrations");
    await applyMigrationsThrough072(database, migrationDirectory);

    await database.query(
      "insert into app_users(id,email) values($1,'migration-072@example.com')",
      [ids.actor],
    );
    await database.query(
      "insert into workspaces(id,name,slug) values($1,'Migration 072','migration-072')",
      [ids.workspace],
    );
    await database.query(
      `insert into workspace_members(workspace_id,user_id,role,status)
       values($1,$2,'owner','active')`,
      [ids.workspace, ids.actor],
    );
    await database.query(
      "insert into brands(id,workspace_id,name) values($1,$2,'Migration 072')",
      [ids.brand, ids.workspace],
    );
    await database.query(
      `insert into ai_content_proposal_batches(
         id,workspace_id,brand_id,origin,content_family,request_json,
         source_snapshot_json,status,idempotency_key,created_by_user_id
       ) values(
         $1,$2,$3,'manual','informational','{"legacyRequest":true}',
         '[{"sourceId":"legacy-source","url":"https://example.com/source","crawledAt":"2026-07-31T00:00:00Z","contentHash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","summary":"legacy evidence"}]',
         'ready','migration-072-legacy-batch',$4
       )`,
      [ids.batch, ids.workspace, ids.brand, ids.actor],
    );
    await database.query(
      `insert into ai_content_generations(
         id,workspace_id,brand_id,type,title,status,analysis_idempotency_key,
         content_family,output_format,generation_input_snapshot,draft_json,analysis_json
       ) values(
         $1,$2,$3,'card_news','Legacy generation','queued','migration-072-legacy-generation',
         'informational','single_image','{"legacyInput":true}',
         '{"legacyDraft":true}','{"legacyAnalysis":true}'
       )`,
      [ids.generation, ids.workspace, ids.brand],
    );
    await database.query(
      `insert into ai_content_generation_outputs(
         id,generation_id,workspace_id,brand_id,output_index,status,
         content_json,artifact_manifest_json
       ) values
         ($1,$3,$4,$5,1,'queued','{"legacyContent":true}','{"legacyManifest":true}'),
         ($2,$3,$4,$5,2,'queued','{}','{}')`,
      [ids.outputOne, ids.outputTwo, ids.generation, ids.workspace, ids.brand],
    );
    await database.query(
      `insert into ai_content_generation_jobs(
         id,generation_id,output_id,workspace_id,brand_id,job_type,content_type,status,payload_json
       ) values($1,$2,$3,$4,$5,'generate','card_news','queued','{"legacyJob":true}')`,
      [ids.legacyJob, ids.generation, ids.outputOne, ids.workspace, ids.brand],
    );
    await database.query(
      `insert into ai_content_generation_attachments(
         id,generation_id,workspace_id,brand_id,role,file_name,mime_type,size_bytes,
         checksum,storage_url,storage_path
       ) values(
         $1,$2,$3,$4,'visual_reference','legacy.png','image/png',128,$5,
         'https://example.com/legacy.png','migration-072/legacy.png'
       )`,
      [ids.legacyAttachment, ids.generation, ids.workspace, ids.brand, "b".repeat(64)],
    );
    await database.query(
      `insert into ai_content_attachment_upload_sessions(
         id,generation_id,workspace_id,brand_id,created_by_user_id,role,file_name,
         expected_mime_type,expected_size_bytes,expected_checksum,storage_path
       ) values(
         $1,$2,$3,$4,$5,'visual_reference','legacy-upload.png','image/png',128,$6,
         'migration-072/legacy-upload.png'
       )`,
      [ids.legacyUpload, ids.generation, ids.workspace, ids.brand, ids.actor, "c".repeat(64)],
    );

    await applyMigration073WhenPresent(database, migrationDirectory);
  }, 120_000);

  afterAll(async () => {
    await database.close();
  });

  it("creates the V2 snapshot and render-job schema with composite ownership constraints", async () => {
    const tables = await database.query<{ table_name: string }>(
      `select table_name
         from information_schema.tables
        where table_schema='public'
          and table_name in (
            'ai_content_proposal_research_snapshots',
            'ai_content_generation_input_snapshots',
            'ai_content_output_research_snapshots',
            'ai_content_generation_render_jobs'
          )
        order by table_name`,
    );
    expect(tables.rows.map((row) => row.table_name)).toEqual([
      "ai_content_generation_input_snapshots",
      "ai_content_generation_render_jobs",
      "ai_content_output_research_snapshots",
      "ai_content_proposal_research_snapshots",
    ]);

    const addedColumns = await database.query<{
      table_name: string;
      column_name: string;
      data_type: string;
      is_nullable: string;
    }>(
      `select table_name,column_name,data_type,is_nullable
         from information_schema.columns
        where (table_name='ai_content_proposal_batches' and column_name='input_snapshot_json')
           or (table_name='ai_content_generation_outputs' and column_name='plan_json')
        order by table_name,column_name`,
    );
    expect(addedColumns.rows).toEqual([
      {
        table_name: "ai_content_generation_outputs",
        column_name: "plan_json",
        data_type: "jsonb",
        is_nullable: "YES",
      },
      {
        table_name: "ai_content_proposal_batches",
        column_name: "input_snapshot_json",
        data_type: "jsonb",
        is_nullable: "YES",
      },
    ]);

    const snapshotColumns = await database.query<{
      table_name: string;
      column_name: string;
    }>(
      `select table_name,column_name
         from information_schema.columns
        where table_schema='public'
          and table_name in (
            'ai_content_proposal_research_snapshots',
            'ai_content_generation_input_snapshots',
            'ai_content_output_research_snapshots'
          )
        order by table_name,ordinal_position`,
    );
    expect(snapshotColumns.rows).toEqual([
      { table_name: "ai_content_generation_input_snapshots", column_name: "id" },
      { table_name: "ai_content_generation_input_snapshots", column_name: "workspace_id" },
      { table_name: "ai_content_generation_input_snapshots", column_name: "brand_id" },
      { table_name: "ai_content_generation_input_snapshots", column_name: "generation_id" },
      { table_name: "ai_content_generation_input_snapshots", column_name: "input_json" },
      { table_name: "ai_content_generation_input_snapshots", column_name: "content_hash" },
      { table_name: "ai_content_generation_input_snapshots", column_name: "created_at" },
      { table_name: "ai_content_output_research_snapshots", column_name: "id" },
      { table_name: "ai_content_output_research_snapshots", column_name: "workspace_id" },
      { table_name: "ai_content_output_research_snapshots", column_name: "brand_id" },
      { table_name: "ai_content_output_research_snapshots", column_name: "generation_id" },
      { table_name: "ai_content_output_research_snapshots", column_name: "output_id" },
      { table_name: "ai_content_output_research_snapshots", column_name: "evidence_json" },
      { table_name: "ai_content_output_research_snapshots", column_name: "created_at" },
      { table_name: "ai_content_proposal_research_snapshots", column_name: "id" },
      { table_name: "ai_content_proposal_research_snapshots", column_name: "workspace_id" },
      { table_name: "ai_content_proposal_research_snapshots", column_name: "brand_id" },
      { table_name: "ai_content_proposal_research_snapshots", column_name: "batch_id" },
      { table_name: "ai_content_proposal_research_snapshots", column_name: "evidence_json" },
      { table_name: "ai_content_proposal_research_snapshots", column_name: "created_at" },
    ]);

    const renderColumns = await database.query<{ column_name: string }>(
      `select column_name
         from information_schema.columns
        where table_schema='public' and table_name='ai_content_generation_render_jobs'
        order by ordinal_position`,
    );
    expect(renderColumns.rows.map((row) => row.column_name)).toEqual([
      "id",
      "generation_id",
      "output_id",
      "workspace_id",
      "brand_id",
      "job_kind",
      "asset_index",
      "status",
      "payload_json",
      "result_json",
      "attempt_count",
      "max_attempts",
      "available_at",
      "worker_id",
      "lease_token",
      "lease_expires_at",
      "error_code",
      "error_message",
      "created_at",
      "updated_at",
      "completed_at",
    ]);

    const constraints = await database.query<{ conname: string; definition: string }>(
      `select constraint_row.conname,pg_get_constraintdef(constraint_row.oid) as definition
         from pg_constraint constraint_row
         join pg_class relation on relation.oid=constraint_row.conrelid
        where relation.relname in (
          'ai_content_proposal_research_snapshots',
          'ai_content_generation_input_snapshots',
          'ai_content_output_research_snapshots',
          'ai_content_generation_render_jobs'
        ) and constraint_row.contype in ('c','f')`,
    );
    const definitions = constraints.rows.map((row) => `${row.conname}: ${row.definition}`).join("\n");
    expect(definitions).toContain("ai_content_proposal_research_snapshots_batch_fk");
    expect(definitions).toContain("REFERENCES ai_content_proposal_batches(id, workspace_id, brand_id) ON DELETE RESTRICT");
    expect(definitions).toContain("ai_content_generation_input_snapshots_generation_fk");
    expect(definitions).toContain("REFERENCES ai_content_generations(id, workspace_id, brand_id) ON DELETE RESTRICT");
    expect(definitions).toContain("ai_content_output_research_snapshots_output_fk");
    expect(definitions).toContain("REFERENCES ai_content_generation_outputs(id, generation_id, workspace_id, brand_id) ON DELETE RESTRICT");
    expect(definitions).toContain("ai_content_generation_render_jobs_output_fk");
    expect(definitions).toContain("REFERENCES ai_content_generation_outputs(id, generation_id, workspace_id, brand_id) ON DELETE CASCADE");

    const indexes = await database.query<{ indexdef: string }>(
      `select indexdef
         from pg_indexes
        where schemaname='public'
          and tablename='ai_content_generation_render_jobs'
          and indexdef like 'CREATE UNIQUE INDEX%'`,
    );
    const indexDefinitions = indexes.rows.map((row) => row.indexdef).join("\n");
    expect(indexDefinitions).toContain("(output_id, asset_index)");
    expect(indexDefinitions).toContain("job_kind = 'image_asset'");
    expect(indexDefinitions).toContain("(output_id)");
    expect(indexDefinitions).toContain("job_kind = 'package_finalize'");
  });

  it("keeps representative through-071 generation rows and legacy JSON readable", async () => {
    const generation = await database.query(
      `select output_format,draft_json,analysis_json,generation_input_snapshot
         from ai_content_generations where id=$1`,
      [ids.generation],
    );
    expect(generation.rows).toEqual([{
      output_format: "single_image",
      draft_json: { legacyDraft: true },
      analysis_json: { legacyAnalysis: true },
      generation_input_snapshot: { legacyInput: true },
    }]);

    const output = await database.query(
      `select content_json,artifact_manifest_json,plan_json
         from ai_content_generation_outputs where id=$1`,
      [ids.outputOne],
    );
    expect(output.rows).toEqual([{
      content_json: { legacyContent: true },
      artifact_manifest_json: { legacyManifest: true },
      plan_json: null,
    }]);

    const legacyRows = await database.query(
      `select job.job_type,job.content_type,job.payload_json,
              attachment.role as attachment_role,session.role as upload_role
         from ai_content_generation_jobs job
         join ai_content_generation_attachments attachment
           on attachment.id=$2
         join ai_content_attachment_upload_sessions session
           on session.id=$3
        where job.id=$1`,
      [ids.legacyJob, ids.legacyAttachment, ids.legacyUpload],
    );
    expect(legacyRows.rows).toEqual([{
      job_type: "generate",
      content_type: "card_news",
      payload_json: { legacyJob: true },
      attachment_role: "visual_reference",
      upload_role: "visual_reference",
    }]);
  });

  it("preserves all legacy formats and roles while accepting the V2 additions", async () => {
    const formats = [
      "card_news",
      "blog",
      "single_image",
      "channel_text",
      "reel",
      "marketing_content",
    ];
    for (const [index, format] of formats.entries()) {
      await database.query(
        `insert into ai_content_generations(
           id,workspace_id,brand_id,type,title,analysis_idempotency_key,output_format
         ) values($1,$2,$3,'marketing',$4,$5,$6)`,
        [
          `51000000-0000-4000-8000-00000000000${index}`,
          ids.workspace,
          ids.brand,
          `Format ${format}`,
          `migration-072-format-${format}`,
          format,
        ],
      );
    }
    await expect(database.query(
      `insert into ai_content_generations(
         id,workspace_id,brand_id,type,title,analysis_idempotency_key,output_format
       ) values('51000000-0000-4000-8000-000000000009',$1,$2,'marketing',
         'Unknown format','migration-072-format-unknown','unknown')`,
      [ids.workspace, ids.brand],
    )).rejects.toThrow();

    const roles = [
      "product",
      "person",
      "scale",
      "visual_reference",
      "document",
      "product_image",
      "supporting_image",
    ];
    for (const [index, role] of roles.entries()) {
      await database.query(
        `insert into ai_content_generation_attachments(
           generation_id,workspace_id,brand_id,role,file_name,mime_type,size_bytes,
           checksum,storage_url,storage_path
         ) values($1,$2,$3,$4,$5,'image/png',128,$6,$7,$8)`,
        [
          ids.generation,
          ids.workspace,
          ids.brand,
          role,
          `${role}.png`,
          "d".repeat(64),
          `https://example.com/${role}.png`,
          `migration-072/role-${index}.png`,
        ],
      );
      await database.query(
        `insert into ai_content_attachment_upload_sessions(
           generation_id,workspace_id,brand_id,created_by_user_id,role,file_name,
           expected_mime_type,expected_size_bytes,expected_checksum,storage_path
         ) values($1,$2,$3,$4,$5,$6,'image/png',128,$7,$8)`,
        [
          ids.generation,
          ids.workspace,
          ids.brand,
          ids.actor,
          role,
          `${role}-upload.png`,
          "e".repeat(64),
          `migration-072/role-upload-${index}.png`,
        ],
      );
    }

    await expect(database.query(
      `insert into ai_content_generation_attachments(
         generation_id,workspace_id,brand_id,role,file_name,mime_type,size_bytes,
         checksum,storage_url,storage_path
       ) values($1,$2,$3,'unknown','unknown.png','image/png',128,$4,
         'https://example.com/unknown.png','migration-072/unknown.png')`,
      [ids.generation, ids.workspace, ids.brand, "f".repeat(64)],
    )).rejects.toThrow();
    await expect(database.query(
      `insert into ai_content_attachment_upload_sessions(
         generation_id,workspace_id,brand_id,created_by_user_id,role,file_name,
         expected_mime_type,expected_size_bytes,expected_checksum,storage_path
       ) values($1,$2,$3,$4,'unknown','unknown-upload.png','image/png',128,$5,
         'migration-072/unknown-upload.png')`,
      [ids.generation, ids.workspace, ids.brand, ids.actor, "f".repeat(64)],
    )).rejects.toThrow();
  });

  it("enforces object-shaped immutable proposal, generation, and output research snapshots", async () => {
    await expect(database.query(
      `insert into ai_content_proposal_research_snapshots(
         workspace_id,brand_id,batch_id,evidence_json
       ) values($1,$2,$3,'[]')`,
      [ids.workspace, ids.brand, ids.batch],
    )).rejects.toThrow();
    await expect(database.query(
      `insert into ai_content_generation_input_snapshots(
         workspace_id,brand_id,generation_id,input_json,content_hash
       ) values($1,$2,$3,'[]',$4)`,
      [ids.workspace, ids.brand, ids.generation, "a".repeat(64)],
    )).rejects.toThrow();
    await expect(database.query(
      `insert into ai_content_generation_input_snapshots(
         workspace_id,brand_id,generation_id,input_json,content_hash
       ) values($1,$2,$3,'{}','not-a-sha256')`,
      [ids.workspace, ids.brand, ids.generation],
    )).rejects.toThrow();
    await expect(database.query(
      `insert into ai_content_generation_input_snapshots(
         workspace_id,brand_id,generation_id,input_json,content_hash
       ) values($1,$2,$3,'{}',$4)`,
      [ids.workspace, ids.brand, ids.generation, "A".repeat(64)],
    )).rejects.toThrow();
    await expect(database.query(
      `insert into ai_content_output_research_snapshots(
         workspace_id,brand_id,generation_id,output_id,evidence_json
       ) values($1,$2,$3,$4,'[]')`,
      [ids.workspace, ids.brand, ids.generation, ids.outputOne],
    )).rejects.toThrow();

    for (const [workspaceId, brandId] of [
      [ids.mismatchedWorkspace, ids.brand],
      [ids.workspace, ids.mismatchedBrand],
    ]) {
      await expect(database.query(
        `insert into ai_content_proposal_research_snapshots(
           workspace_id,brand_id,batch_id,evidence_json
         ) values($1,$2,$3,'{}')`,
        [workspaceId, brandId, ids.batch],
      )).rejects.toThrow();
      await expect(database.query(
        `insert into ai_content_generation_input_snapshots(
           workspace_id,brand_id,generation_id,input_json,content_hash
         ) values($1,$2,$3,'{}',$4)`,
        [workspaceId, brandId, ids.generation, "a".repeat(64)],
      )).rejects.toThrow();
    }
    for (const tuple of [
      [ids.outputOne, ids.mismatchedGeneration, ids.workspace, ids.brand],
      [ids.outputOne, ids.generation, ids.mismatchedWorkspace, ids.brand],
      [ids.outputOne, ids.generation, ids.workspace, ids.mismatchedBrand],
      [ids.mismatchedOutput, ids.generation, ids.workspace, ids.brand],
    ]) {
      await expect(database.query(
        `insert into ai_content_output_research_snapshots(
           output_id,generation_id,workspace_id,brand_id,evidence_json
         ) values($1,$2,$3,$4,'{}')`,
        tuple,
      )).rejects.toThrow();
    }

    await database.query(
      `insert into ai_content_proposal_research_snapshots(
         id,workspace_id,brand_id,batch_id,evidence_json
       ) values($1,$2,$3,$4,'{"sources":[]}')`,
      [ids.proposalResearch, ids.workspace, ids.brand, ids.batch],
    );
    await database.query(
      `insert into ai_content_generation_input_snapshots(
         id,workspace_id,brand_id,generation_id,input_json,content_hash
       ) values($1,$2,$3,$4,'{"contractVersion":"content-generation-input.v2"}',$5)`,
      [ids.generationInput, ids.workspace, ids.brand, ids.generation, "a".repeat(64)],
    );
    await database.query(
      `insert into ai_content_output_research_snapshots(
         id,workspace_id,brand_id,generation_id,output_id,evidence_json
       ) values($1,$2,$3,$4,$5,'{"sources":[]}')`,
      [ids.outputResearch, ids.workspace, ids.brand, ids.generation, ids.outputOne],
    );

    await expect(database.query(
      `insert into ai_content_proposal_research_snapshots(
         workspace_id,brand_id,batch_id,evidence_json
       ) values($1,$2,$3,'{}')`,
      [ids.workspace, ids.brand, ids.batch],
    )).rejects.toThrow();
    await expect(database.query(
      `insert into ai_content_generation_input_snapshots(
         workspace_id,brand_id,generation_id,input_json,content_hash
       ) values($1,$2,$3,'{}',$4)`,
      [ids.workspace, ids.brand, ids.generation, "b".repeat(64)],
    )).rejects.toThrow();
    await expect(database.query(
      `insert into ai_content_output_research_snapshots(
         workspace_id,brand_id,generation_id,output_id,evidence_json
       ) values($1,$2,$3,$4,'{}')`,
      [ids.workspace, ids.brand, ids.generation, ids.outputOne],
    )).rejects.toThrow();

    const immutableRows = [
      ["ai_content_proposal_research_snapshots", "evidence_json", ids.proposalResearch],
      ["ai_content_generation_input_snapshots", "input_json", ids.generationInput],
      ["ai_content_output_research_snapshots", "evidence_json", ids.outputResearch],
    ] as const;
    for (const [table, column, id] of immutableRows) {
      await expect(database.query(
        `update ${table} set ${column}='{"changed":true}' where id=$1`,
        [id],
      )).rejects.toThrow(/ai_content_v2_snapshot_immutable/);
      await expect(database.query(`delete from ${table} where id=$1`, [id]))
        .rejects.toThrow(/ai_content_v2_snapshot_immutable/);
      await expect(database.query(
        `update ${table} set created_at=created_at + interval '1 second' where id=$1`,
        [id],
      )).rejects.toThrow(/ai_content_v2_snapshot_immutable/);
    }
  });

  it("enforces snapshot restrict deletes and render-job cascade deletes", async () => {
    await database.query(
      `insert into ai_content_proposal_batches(
         id,workspace_id,brand_id,origin,content_family,request_json,
         source_snapshot_json,status,idempotency_key,created_by_user_id
       ) values(
         $1,$2,$3,'manual','informational','{}',
         '[{"sourceId":"restrict-source","url":"https://example.com/restrict","crawledAt":"2026-07-31T00:00:00Z","contentHash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","summary":"restrict evidence"}]',
         'ready','migration-072-restrict-delete-batch',$4
       )`,
      [ids.restrictBatch, ids.workspace, ids.brand, ids.actor],
    );
    await database.query(
      `insert into ai_content_proposal_research_snapshots(
         id,workspace_id,brand_id,batch_id,evidence_json
       ) values($1,$2,$3,$4,'{}')`,
      [ids.restrictProposalResearch, ids.workspace, ids.brand, ids.restrictBatch],
    );
    await database.query(
      `insert into ai_content_generations(
         id,workspace_id,brand_id,type,title,analysis_idempotency_key
       ) values($1,$2,$3,'marketing','Restrict delete generation',$4)`,
      [
        ids.deleteGeneration,
        ids.workspace,
        ids.brand,
        "migration-072-restrict-delete-generation",
      ],
    );
    await database.query(
      `insert into ai_content_generation_input_snapshots(
         id,workspace_id,brand_id,generation_id,input_json,content_hash
       ) values($1,$2,$3,$4,'{}',$5)`,
      [
        ids.deleteGenerationInput,
        ids.workspace,
        ids.brand,
        ids.deleteGeneration,
        "c".repeat(64),
      ],
    );
    await database.query(
      `insert into ai_content_generations(
         id,workspace_id,brand_id,type,title,analysis_idempotency_key
       ) values($1,$2,$3,'marketing','Restrict delete output generation',$4)`,
      [
        ids.restrictOutputGeneration,
        ids.workspace,
        ids.brand,
        "migration-072-restrict-delete-output-generation",
      ],
    );
    await database.query(
      `insert into ai_content_generation_outputs(
         id,generation_id,workspace_id,brand_id,output_index,status
       ) values($1,$2,$3,$4,1,'queued')`,
      [
        ids.restrictOutput,
        ids.restrictOutputGeneration,
        ids.workspace,
        ids.brand,
      ],
    );
    await database.query(
      `insert into ai_content_output_research_snapshots(
         id,workspace_id,brand_id,generation_id,output_id,evidence_json
       ) values($1,$2,$3,$4,$5,'{}')`,
      [
        ids.restrictOutputResearch,
        ids.workspace,
        ids.brand,
        ids.restrictOutputGeneration,
        ids.restrictOutput,
      ],
    );

    await expect(database.query(
      "delete from ai_content_proposal_batches where id=$1",
      [ids.restrictBatch],
    )).rejects.toThrow();
    await expect(database.query(
      "delete from ai_content_generations where id=$1",
      [ids.deleteGeneration],
    )).rejects.toThrow();
    await expect(database.query(
      "delete from ai_content_generation_outputs where id=$1",
      [ids.restrictOutput],
    )).rejects.toThrow();

    await database.query(
      `insert into ai_content_generation_outputs(
         id,generation_id,workspace_id,brand_id,output_index,status
       ) values($1,$2,$3,$4,3,'queued')`,
      [ids.cascadeOutput, ids.generation, ids.workspace, ids.brand],
    );
    await database.query(
      `insert into ai_content_generation_render_jobs(
         generation_id,output_id,workspace_id,brand_id,job_kind,asset_index,payload_json
       ) values($1,$2,$3,$4,'image_asset',1,'{}')`,
      [ids.generation, ids.cascadeOutput, ids.workspace, ids.brand],
    );
    await database.query(
      "delete from ai_content_generation_outputs where id=$1",
      [ids.cascadeOutput],
    );
    const remaining = await database.query(
      "select count(*)::integer as count from ai_content_generation_render_jobs where output_id=$1",
      [ids.cascadeOutput],
    );
    expect(remaining.rows).toEqual([{ count: 0 }]);
  });

  it("freezes the batch input snapshot after one null-to-object transition", async () => {
    await expect(database.query(
      "update ai_content_proposal_batches set input_snapshot_json='[]' where id=$1",
      [ids.batch],
    )).rejects.toThrow();
    await database.query(
      `update ai_content_proposal_batches
          set input_snapshot_json='{"contractVersion":"proposal-input.v2"}'
        where id=$1`,
      [ids.batch],
    );
    await expect(database.query(
      `update ai_content_proposal_batches
          set input_snapshot_json=input_snapshot_json
        where id=$1`,
      [ids.batch],
    )).resolves.toBeDefined();
    await database.query(
      "update ai_content_proposal_batches set status='building' where id=$1",
      [ids.batch],
    );
    await expect(database.query(
      `update ai_content_proposal_batches
          set input_snapshot_json='{"contractVersion":"proposal-input.v3"}'
        where id=$1`,
      [ids.batch],
    )).rejects.toThrow(/ai_content_v2_batch_input_snapshot_immutable/);
    await expect(database.query(
      "update ai_content_proposal_batches set input_snapshot_json=null where id=$1",
      [ids.batch],
    )).rejects.toThrow(/ai_content_v2_batch_input_snapshot_immutable/);

    const state = await database.query(
      "select status,input_snapshot_json from ai_content_proposal_batches where id=$1",
      [ids.batch],
    );
    expect(state.rows).toEqual([{
      status: "building",
      input_snapshot_json: { contractVersion: "proposal-input.v2" },
    }]);
  });

  it("freezes an output plan after one null-to-object transition", async () => {
    await expect(database.query(
      "update ai_content_generation_outputs set plan_json='[]' where id=$1",
      [ids.outputOne],
    )).rejects.toThrow();
    await database.query(
      `update ai_content_generation_outputs
          set plan_json='{"scenes":[]}'
        where id=$1`,
      [ids.outputOne],
    );
    await expect(database.query(
      `update ai_content_generation_outputs
          set plan_json=plan_json
        where id=$1`,
      [ids.outputOne],
    )).resolves.toBeDefined();
    await database.query(
      "update ai_content_generation_outputs set status='planning' where id=$1",
      [ids.outputOne],
    );
    await expect(database.query(
      `update ai_content_generation_outputs
          set plan_json='{"scenes":[{}]}'
        where id=$1`,
      [ids.outputOne],
    )).rejects.toThrow(/ai_content_v2_output_plan_immutable/);
    await expect(database.query(
      "update ai_content_generation_outputs set plan_json=null where id=$1",
      [ids.outputOne],
    )).rejects.toThrow(/ai_content_v2_output_plan_immutable/);

    const state = await database.query(
      "select status,plan_json from ai_content_generation_outputs where id=$1",
      [ids.outputOne],
    );
    expect(state.rows).toEqual([{ status: "planning", plan_json: { scenes: [] } }]);
  });

  it("enforces per-scene image jobs and one package finalizer per output", async () => {
    const insertJob = (
      outputId: string,
      jobKind: string,
      assetIndex: number | null,
      payload = "{}",
      result: string | null = null,
      status = "queued",
    ) => database.query(
      `insert into ai_content_generation_render_jobs(
         generation_id,output_id,workspace_id,brand_id,job_kind,asset_index,
         status,payload_json,result_json
       ) values($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb)
       returning id,status,attempt_count,max_attempts,worker_id,lease_token,
                 lease_expires_at,completed_at`,
      [
        ids.generation,
        outputId,
        ids.workspace,
        ids.brand,
        jobKind,
        assetIndex,
        status,
        payload,
        result,
      ],
    );

    for (const tuple of [
      [ids.mismatchedGeneration, ids.outputOne, ids.workspace, ids.brand],
      [ids.generation, ids.mismatchedOutput, ids.workspace, ids.brand],
      [ids.generation, ids.outputOne, ids.mismatchedWorkspace, ids.brand],
      [ids.generation, ids.outputOne, ids.workspace, ids.mismatchedBrand],
    ]) {
      await expect(database.query(
        `insert into ai_content_generation_render_jobs(
           generation_id,output_id,workspace_id,brand_id,job_kind,asset_index,payload_json
         ) values($1,$2,$3,$4,'image_asset',2,'{}')`,
        tuple,
      )).rejects.toThrow();
    }

    const first = await insertJob(ids.outputOne, "image_asset", 1);
    expect(first.rows[0]).toMatchObject({
      status: "queued",
      attempt_count: 0,
      max_attempts: 3,
      worker_id: null,
      lease_token: null,
      lease_expires_at: null,
      completed_at: null,
    });
    await expect(insertJob(ids.outputOne, "image_asset", 5)).resolves.toBeDefined();
    await expect(insertJob(ids.outputTwo, "image_asset", 1)).resolves.toBeDefined();
    await expect(insertJob(ids.outputOne, "image_asset", 1)).rejects.toThrow();
    await expect(insertJob(ids.outputTwo, "image_asset", 0)).rejects.toThrow();
    await expect(insertJob(ids.outputTwo, "image_asset", 6)).rejects.toThrow();
    await expect(insertJob(ids.outputTwo, "image_asset", null)).rejects.toThrow();

    await expect(insertJob(ids.outputOne, "package_finalize", null)).resolves.toBeDefined();
    await expect(insertJob(ids.outputOne, "package_finalize", null)).rejects.toThrow();
    await expect(insertJob(ids.outputTwo, "package_finalize", 2)).rejects.toThrow();

    await expect(insertJob(ids.outputTwo, "image_asset", 2, "[]")).rejects.toThrow();
    await expect(insertJob(ids.outputTwo, "image_asset", 3, "{}", "[]"))
      .rejects.toThrow();
    await expect(insertJob(ids.outputTwo, "image_asset", 4, "{}", null, "unknown"))
      .rejects.toThrow();
    await expect(insertJob(ids.outputTwo, "unknown", null)).rejects.toThrow();
  });

  it("enforces render-job attempt bounds", async () => {
    await database.query(
      `insert into ai_content_generation_outputs(
         id,generation_id,workspace_id,brand_id,output_index,status
       ) values($1,$2,$3,$4,4,'queued')`,
      [ids.attemptOutput, ids.generation, ids.workspace, ids.brand],
    );
    const insertAttempt = (
      assetIndex: number,
      attemptCount: number,
      maxAttempts: number,
    ) => database.query(
      `insert into ai_content_generation_render_jobs(
         generation_id,output_id,workspace_id,brand_id,job_kind,asset_index,
         payload_json,attempt_count,max_attempts
       ) values($1,$2,$3,$4,'image_asset',$5,'{}',$6,$7)
       returning attempt_count,max_attempts`,
      [
        ids.generation,
        ids.attemptOutput,
        ids.workspace,
        ids.brand,
        assetIndex,
        attemptCount,
        maxAttempts,
      ],
    );

    await expect(insertAttempt(1, -1, 3)).rejects.toThrow();
    await expect(insertAttempt(2, 0, 0)).rejects.toThrow();
    await expect(insertAttempt(3, 4, 3)).rejects.toThrow();
    await expect(insertAttempt(4, 0, 1)).resolves.toMatchObject({
      rows: [{ attempt_count: 0, max_attempts: 1 }],
    });
    await expect(insertAttempt(5, 3, 3)).resolves.toMatchObject({
      rows: [{ attempt_count: 3, max_attempts: 3 }],
    });
  });
});
