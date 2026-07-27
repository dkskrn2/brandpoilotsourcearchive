import { createHash, randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadSubjectEvidence } from "./aiContentSubjectEvidence.js";
import { createAiContentRepository } from "./aiContentRepository.js";
import { createAiContentSubjectRepository } from "./aiContentSubjectRepository.js";

const VECTOR_MIGRATIONS = new Set([
  "021_dm_wiki_pgvector.sql",
  "027_wiki_search_v2.sql",
  "033_compounding_wiki_pgvector.sql",
]);

function pglitePool(database: PGlite): Pool {
  const query = async (sql: string, values: unknown[] = []) => {
    const result = await database.query(sql, values as never[]);
    return {
      ...result,
      rowCount: result.rows.length || Number(result.affectedRows ?? 0),
    };
  };
  return {
    query,
    async connect() {
      return {
        query,
        release() {},
      };
    },
  } as unknown as Pool;
}

describe("migration 065 subject attachment snapshot backfill", () => {
  let database: PGlite;
  const workspaceId = randomUUID();
  const brandId = randomUUID();
  const generationId = randomUUID();
  const attachmentId = randomUUID();
  const analysisId = randomUUID();
  const outputId = randomUUID();
  const bytes = Buffer.from("legacy attachment");
  const checksum = createHash("sha256").update(bytes).digest("hex");
  const legacyQualityBrief = { hook: "migration-finalized-hook", sourceGaps: [] };
  const generationSnapshot = {
    contractVersion: "content-generation-input.v2",
    contentType: "card_news",
    brandContext: {},
    subject: {
      analysisId,
      analysisVersion: 1,
      analysisContractVersion: "subject-analysis.v2",
      analysisResult: {},
      type: "product",
      sourceUrl: "",
      facts: [],
      research: {},
      selectedImages: [],
    },
    message: {
      target: { id: "target-1" },
      appeal: { id: "appeal-1", targetId: "target-1" },
      qualityBrief: { hook: "pre-analysis-hook" },
    },
    creativeDirection: {
      prompts: ["prompt"],
      brandColor: "#000000",
      selectedColor: "#000000",
      aspectRatio: "1:1",
      outputCount: 1,
    },
    references: [],
    attachments: [],
  };

  beforeAll(async () => {
    database = await PGlite.create({ extensions: { pgcrypto } });
    const migrationDirectory = resolve(process.cwd(), "../../db/migrations");
    const migrationFiles = (await readdir(migrationDirectory))
      .filter((name) => /^\d{3}_.+\.sql$/.test(name))
      .sort();
    for (const name of migrationFiles) {
      if (name >= "065_ai_content_attachment_upload_sessions.sql" || VECTOR_MIGRATIONS.has(name)) continue;
      await database.exec(await readFile(resolve(migrationDirectory, name), "utf8"));
    }

    await database.query(
      "insert into workspaces(id,name,slug) values($1,'Backfill contract',$2)",
      [workspaceId, `backfill-contract-${workspaceId}`],
    );
    await database.query(
      "insert into brands(id,workspace_id,name) values($1,$2,'Backfill contract')",
      [brandId, workspaceId],
    );
    await database.query(
      `insert into ai_content_generations(
         id,workspace_id,brand_id,type,title,status,analysis_idempotency_key
       ) values($1,$2,$3,'blog','Backfill contract','analysis_ready',$4)`,
      [generationId, workspaceId, brandId, `generation-${generationId}`],
    );
    await database.query(
      `insert into ai_content_generation_attachments(
         id,generation_id,workspace_id,brand_id,role,file_name,mime_type,size_bytes,
         checksum,storage_url,storage_path,created_at
       ) values($1,$2,$3,$4,'document','legacy.txt','text/plain',$5,$6,
         'https://blob.example/legacy.txt','generation/legacy.txt',
         '2026-07-27T00:00:00.000Z')`,
      [attachmentId, generationId, workspaceId, brandId, bytes.length, checksum],
    );
    await database.query(
      `insert into ai_content_subject_analyses(
         id,workspace_id,brand_id,generation_id,contract_version,subject_type,input_json,
         attachment_ids_json,status,analysis_version,idempotency_key
       ) values($1,$2,$3,$4,'subject-analysis.v2','product',
         '{"manualInput":{"name":"Legacy","promotionOrTerms":"","description":""},"brandContext":{}}',
         $5::jsonb,'queued',1,$6)`,
      [analysisId, workspaceId, brandId, generationId, JSON.stringify([attachmentId]), `analysis-${analysisId}`],
    );
    await database.query(
      `update ai_content_generations
          set subject_analysis_snapshot=$2::jsonb,
              analysis_json=jsonb_build_object('qualityBrief',$3::jsonb)
        where id=$1`,
      [generationId, JSON.stringify(generationSnapshot), JSON.stringify(legacyQualityBrief)],
    );
    await database.query(
      `insert into ai_content_generation_outputs(
         id,generation_id,workspace_id,brand_id,output_index,status
       ) values($1,$2,$3,$4,1,'queued')`,
      [outputId, generationId, workspaceId, brandId],
    );
    await database.query(
      `insert into ai_content_generation_jobs(
         generation_id,output_id,workspace_id,brand_id,job_type,content_type,status,payload_json
       ) values($1,$2,$3,$4,'generate','card_news','queued',
         '{"generationId":"legacy","outputId":"legacy"}')`,
      [generationId, outputId, workspaceId, brandId],
    );

    await database.exec(
      await readFile(
        resolve(migrationDirectory, "065_ai_content_attachment_upload_sessions.sql"),
        "utf8",
      ),
    );
  }, 120_000);

  afterAll(async () => {
    await database.close();
  });

  it("claims and prepares the exact attachment snapshot produced by the migration backfill", async () => {
    const repository = createAiContentSubjectRepository(pglitePool(database));
    const claim = await repository.claimSubjectAnalysis({
      analysisId,
      workerId: "migration-backfill-worker",
      leaseSeconds: 60,
    });

    expect(claim?.input.attachmentSnapshot).toEqual([{
      id: attachmentId,
      generationId,
      role: "document",
      fileName: "legacy.txt",
      mimeType: "text/plain",
      sizeBytes: bytes.length,
      checksum,
      storageUrl: "https://blob.example/legacy.txt",
      storagePath: "generation/legacy.txt",
      createdAt: "2026-07-27T00:00:00.000Z",
    }]);

    await expect(loadSubjectEvidence({
      workspaceId,
      brandId,
      generationId,
      attachmentIds: [attachmentId],
      attachmentSnapshot: claim?.input.attachmentSnapshot,
      attachmentSnapshotMissingIds: claim?.input.attachmentSnapshotMissingIds,
    }, {
      headBlob: async () => ({ size: bytes.length, contentType: "text/plain" }),
      fetchBlob: async () => ({ bytes, contentLength: bytes.length, contentType: "text/plain" }),
      extractDocument: async () => ({ sourceId: attachmentId }) as never,
    })).resolves.toMatchObject({ sourceGaps: [] });
  });

  it("claims a pre-065 queued generate job with a finalized payload accepted by the worker parser", async () => {
    const repository = createAiContentRepository(pglitePool(database));
    const claim = await repository.claimAiContentJob({
      contentType: "card_news",
      workerId: "migration-generate-worker",
      leaseSeconds: 60,
    });
    expect(claim?.payload.contentGenerationInput).toMatchObject({
      contractVersion: "content-generation-input.v2",
      message: { qualityBrief: legacyQualityBrief },
    });

    const { parseContentGenerationInput } = await import(
      "../../../workers/brand-pilot-card-news-worker/src/contracts.js"
    );
    expect(() => parseContentGenerationInput(claim?.payload.contentGenerationInput)).not.toThrow();
  });
});
