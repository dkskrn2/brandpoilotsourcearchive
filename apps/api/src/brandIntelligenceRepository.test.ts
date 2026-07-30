import { PGlite } from "@electric-sql/pglite";
import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBrandIntelligenceRepository } from "./brandIntelligenceRepository.js";
import type { BrandIntelligenceResultV1 } from "./brandIntelligenceContracts.js";
import { hashSourceUrl } from "./sourceUrl.js";

type QueryResult = { rowCount: number; rows: Record<string, unknown>[] };

function pglitePool(database: PGlite): Pool {
  async function execute(sql: string, values: unknown[] = []): Promise<QueryResult> {
    const result = await database.query(sql, values as never[]);
    return { rowCount: result.rows.length || Number(result.affectedRows ?? 0), rows: result.rows as Record<string, unknown>[] };
  }
  return {
    query: execute,
    async connect() { return { query: execute, release() {} }; },
  } as unknown as Pool;
}

const workspaceId = "10000000-0000-4000-8000-000000000001";
const brandId = "20000000-0000-4000-8000-000000000001";

function result(target = "초기 고객"): BrandIntelligenceResultV1 {
  return {
    contractVersion: "brand-intelligence-result.v1",
    companyOverview: "회사 개요",
    businessDescription: "사업 소개",
    primaryCategory: { code: "marketing", name: "마케팅" },
    subcategories: [{ code: null, name: "콘텐츠 자동화" }],
    primaryTarget: target,
    differentiators: "차별점",
    coreAppeal: "소구점",
    competitors: [{ name: "대안", description: "대안 설명", sourceUrls: ["https://example.com/alternative"] }],
    evidence: [{ field: "companyOverview", claim: "회사 개요", sourceId: "owned-url", sourceUrl: "https://example.com" }],
    sourceGaps: [],
  };
}

async function prepareAnalysis(
  repository: ReturnType<typeof createBrandIntelligenceRepository>,
  input: { ownedUrl: string | null; idempotencyKey: string },
) {
  const requested = await repository.requestBrandAnalysis({
    workspaceId,
    brandId,
    ownedUrl: input.ownedUrl,
    uploadIds: [],
    idempotencyKey: input.idempotencyKey,
  });
  const claim = await repository.claimBrandAnalysis({ workerId: "worker-1", leaseSeconds: 60 });
  await repository.completeBrandAnalysis({
    analysisId: requested.id,
    workerId: "worker-1",
    leaseToken: claim!.leaseToken,
    evidence: [],
    result: result(),
  });
  return requested;
}

describe("brand intelligence repository", () => {
  let database: PGlite;
  beforeEach(async () => {
    database = new PGlite();
    await database.exec(`
      create table brands (
        id uuid primary key, workspace_id uuid not null, name text not null,
        company_name_state text not null default 'provisional',
        company_name_confirmed_at timestamptz,
        unique (id, workspace_id)
      );
      create table content_categories (id uuid primary key, code text unique, name text not null);
      create table content_subcategories (id uuid primary key, code text unique, name text not null);
      create table brand_profiles (
        id uuid primary key default gen_random_uuid(), workspace_id uuid not null, brand_id uuid not null unique,
        primary_customer text, description text, primary_category_id uuid, active_brand_analysis_id uuid
      );
      create table brand_analysis_runs (
        id uuid primary key default gen_random_uuid(), workspace_id uuid not null, brand_id uuid not null,
        status text not null default 'queued', input_json jsonb not null default '{}'::jsonb,
        pipeline_version int not null default 1,
        evidence_json jsonb not null default '[]'::jsonb, result_json jsonb, edited_result_json jsonb,
        idempotency_key text not null, is_active boolean not null default false, leased_by text, lease_token uuid,
        lease_expires_at timestamptz, attempt_count int not null default 0, available_at timestamptz not null default now(),
        error_code text, error_message text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
        completed_at timestamptz, confirmed_at timestamptz, cancel_requested_at timestamptz,
        purged_at timestamptz, tombstone_expires_at timestamptz,
        active_started_at timestamptz, deadline_at timestamptz,
        unique (brand_id, idempotency_key)
      );
      create table brand_analysis_uploads (
        id uuid primary key default gen_random_uuid(), workspace_id uuid not null, brand_id uuid not null,
        analysis_id uuid, file_name text not null, mime_type text not null, byte_size bigint not null,
        checksum text not null, storage_path text, storage_url text, upload_status text not null default 'intent',
        upload_attempt_count integer not null default 0, upload_expires_at timestamptz,
        cleanup_status text not null default 'none', upload_completed_at timestamptz,
        created_at timestamptz not null default now(), deleted_at timestamptz,
        unique (storage_path)
      );
      create unique index one_active on brand_analysis_runs(brand_id) where is_active;
      create table source_urls (
        id uuid primary key default gen_random_uuid(), workspace_id uuid not null, brand_id uuid not null,
        source_type text not null, url text not null, url_hash text not null, domain text,
        title text, meta_description text, status text not null default 'active', enabled boolean not null default true,
        last_crawled_at timestamptz, last_error text, disabled_at timestamptz,
        created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz
      );
      create unique index one_owned_source on source_urls(brand_id) where source_type = 'owned' and deleted_at is null;
      create table brand_profile_subcategories (
        id uuid primary key default gen_random_uuid(), workspace_id uuid not null, brand_id uuid not null,
        brand_profile_id uuid not null, subcategory_id uuid, custom_name text, custom_key text,
        unique (brand_profile_id, subcategory_id), unique (brand_profile_id, custom_key)
      );
      create table knowledge_imports (
        id uuid primary key default gen_random_uuid(), workspace_id uuid not null, brand_id uuid not null,
        file_name text not null, source_rows jsonb not null, result_json jsonb not null,
        status text not null, created_at timestamptz not null default now()
      );
      create table knowledge_entries (
        id uuid primary key default gen_random_uuid(), workspace_id uuid not null, brand_id uuid not null,
        normalized_question text not null, entry_type text not null, title text, content text,
        aliases text[] not null default '{}', keywords text[] not null default '{}', structured_data jsonb not null default '{}'::jsonb,
        direct_reply_enabled boolean not null default false, enabled boolean not null default true,
        last_import_id uuid not null, updated_at timestamptz not null default now(),
        unique (brand_id, normalized_question)
      );
      create table wiki_build_requests (
        id uuid primary key default gen_random_uuid(), workspace_id uuid not null, brand_id uuid not null,
        requested_revision bigint not null default 1, status text not null default 'pending', rebuild_requested boolean not null default false,
        quiet_until timestamptz not null default now(), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
      );
      create unique index wiki_active on wiki_build_requests(workspace_id, brand_id) where status in ('pending', 'building');
    `);
    await database.query("insert into brands (id, workspace_id, name) values ($1, $2, '모종애드')", [brandId, workspaceId]);
    await database.query("insert into content_categories (id, code, name) values (gen_random_uuid(), 'marketing', '마케팅')");
  }, 30_000);
  afterEach(async () => database.close());

  it("runs an idempotent analysis through review and confirmation", async () => {
    const repository = createBrandIntelligenceRepository(pglitePool(database));
    const requested = await repository.requestBrandAnalysis({
      workspaceId, brandId, ownedUrl: "https://example.com", uploadIds: [], idempotencyKey: "analysis-1",
    });
    const duplicate = await repository.requestBrandAnalysis({
      workspaceId, brandId, ownedUrl: "https://example.com", uploadIds: [], idempotencyKey: "analysis-1",
    });
    expect(duplicate.id).toBe(requested.id);

    const claim = await repository.claimBrandAnalysis({ workerId: "worker-1", leaseSeconds: 60 });
    expect(claim?.id).toBe(requested.id);
    await repository.completeBrandAnalysis({
      analysisId: requested.id,
      workerId: "worker-1",
      leaseToken: claim!.leaseToken,
      evidence: [],
      result: result(),
    });
    const edited = await repository.updateBrandAnalysisDraft({
      workspaceId, brandId, analysisId: requested.id, editedResult: result("수정한 고객"),
    });
    expect(edited.effectiveResult?.primaryTarget).toBe("수정한 고객");

    const confirmed = await repository.confirmBrandAnalysis({ workspaceId, brandId, analysisId: requested.id });
    expect(confirmed.status).toBe("confirmed");
    expect(confirmed.isActive).toBe(true);

    const profile = await database.query("select primary_customer, description, active_brand_analysis_id from brand_profiles where brand_id = $1", [brandId]);
    expect(profile.rows[0]).toMatchObject({ primary_customer: "수정한 고객", description: "사업 소개", active_brand_analysis_id: requested.id });
    const builds = await database.query("select count(*)::int as count from wiki_build_requests where brand_id = $1", [brandId]);
    expect((builds.rows[0] as { count: number } | undefined)?.count).toBe(1);
    const knowledge = await database.query("select content, direct_reply_enabled from knowledge_entries where brand_id = $1", [brandId]);
    expect(knowledge.rows[0]).toMatchObject({ direct_reply_enabled: false });
    expect(String((knowledge.rows[0] as { content: string }).content)).toContain("수정한 고객");
  });

  it("rejects edits before analysis and isolates brand reads", async () => {
    const repository = createBrandIntelligenceRepository(pglitePool(database));
    const requested = await repository.requestBrandAnalysis({
      workspaceId, brandId, ownedUrl: "https://example.com", uploadIds: [], idempotencyKey: "analysis-1",
    });
    await expect(repository.updateBrandAnalysisDraft({
      workspaceId, brandId, analysisId: requested.id, editedResult: result(),
    })).rejects.toThrow("brand_analysis_not_review_ready");
    await expect(repository.getBrandAnalysis({ workspaceId, brandId: "20000000-0000-4000-8000-000000000002", analysisId: requested.id }))
      .resolves.toBeNull();
  });

  it("cancels idempotently, clears provisional inputs, and revokes the lease", async () => {
    const repository = createBrandIntelligenceRepository(pglitePool(database));
    const requested = await repository.requestBrandAnalysis({
      workspaceId,
      brandId,
      companyName: "모종애드",
      ownedUrl: "https://example.com",
      uploadIds: [],
      idempotencyKey: "cancel-analysis",
    });
    await repository.claimBrandAnalysis({ workerId: "worker-1", leaseSeconds: 60 });

    const cancelled = await repository.cancelBrandAnalysis({
      workspaceId,
      brandId,
      analysisId: requested.id,
    });
    expect(cancelled).toMatchObject({
      status: "cancelled",
      input: { companyName: null, ownedUrl: null, uploadIds: [] },
      leasedBy: null,
      leaseToken: null,
    });
    await expect(repository.cancelBrandAnalysis({
      workspaceId,
      brandId,
      analysisId: requested.id,
    })).resolves.toMatchObject({ status: "cancelled" });
  });

  it("purges attached blob uploads before completing cancellation", async () => {
    const deleteBlobs = vi.fn(async () => undefined);
    const repository = createBrandIntelligenceRepository(pglitePool(database), { deleteBlobs });
    const requested = await repository.requestBrandAnalysis({
      workspaceId,
      brandId,
      companyName: "모종애드",
      ownedUrl: "https://example.com",
      uploadIds: [],
      idempotencyKey: "cancel-with-upload",
    });
    await database.query(
      `insert into brand_analysis_uploads (
         workspace_id, brand_id, analysis_id, file_name, mime_type, byte_size,
         checksum, storage_path, storage_url
       ) values ($1, $2, $3, 'brief.pdf', 'application/pdf', 10, $4, $5, $6)`,
      [
        workspaceId,
        brandId,
        requested.id,
        "a".repeat(64),
        `brands/${brandId}/brand-analysis/${requested.id}/uploads/a-brief.pdf`,
        "https://test.public.blob.vercel-storage.com/brief.pdf",
      ],
    );

    const cancelled = await repository.cancelBrandAnalysis({
      workspaceId,
      brandId,
      analysisId: requested.id,
    });

    expect(deleteBlobs).toHaveBeenCalledWith([
      "https://test.public.blob.vercel-storage.com/brief.pdf",
    ]);
    expect(cancelled.status).toBe("cancelled");
    const upload = await database.query(
      "select count(*)::int as count from brand_analysis_uploads where analysis_id = $1",
      [requested.id],
    );
    expect(Number((upload.rows[0] as { count?: unknown } | undefined)?.count)).toBe(0);
  });

  it("claims only pipeline versions supported by the worker", async () => {
    const repository = createBrandIntelligenceRepository(pglitePool(database));
    const legacy = await repository.requestBrandAnalysis({
      workspaceId,
      brandId,
      ownedUrl: "https://legacy.example.com",
      uploadIds: [],
      idempotencyKey: "pipeline-v1",
    });
    await database.query(
      "update brand_analysis_runs set status = 'failed', completed_at = now() where id = $1",
      [legacy.id],
    );
    const current = await repository.requestBrandAnalysis({
      workspaceId,
      brandId,
      companyName: "모종애드",
      ownedUrl: "https://current.example.com",
      uploadIds: [],
      idempotencyKey: "pipeline-v2",
    });
    await database.query(
      "update brand_analysis_runs set status = 'queued', completed_at = null where id = $1",
      [legacy.id],
    );

    const claim = await repository.claimBrandAnalysis({
      workerId: "worker-v2",
      leaseSeconds: 60,
      supportedPipelineVersions: [2],
    });

    expect(claim?.id).toBe(current.id);
  });

  it("creates upload intents owned by the run before accepting blob bytes", async () => {
    const repository = createBrandIntelligenceRepository(pglitePool(database));
    const created = await repository.requestBrandAnalysis({
      workspaceId,
      brandId,
      companyName: "모종애드",
      ownedUrl: null,
      uploadIds: [],
      uploads: [{
        fileName: "brief.pdf",
        mimeType: "application/pdf",
        byteSize: 10,
        checksum: "b".repeat(64),
      }],
      idempotencyKey: "owned-upload-intent",
    });
    expect(created.status).toBe("accepting_uploads");
    expect(created.input.uploadIds).toHaveLength(1);
    const uploadId = created.input.uploadIds[0]!;
    await repository.beginBrandAnalysisUpload({
      workspaceId,
      brandId,
      analysisId: created.id,
      uploadId,
      storagePath: `brands/${brandId}/brand-analysis/${uploadId}/uploads/brief.pdf`,
    });
    await repository.completeBrandAnalysisUpload({
      workspaceId,
      brandId,
      analysisId: created.id,
      uploadId,
      storagePath: `brands/${brandId}/brand-analysis/${uploadId}/uploads/brief.pdf`,
      storageUrl: "https://test.public.blob.vercel-storage.com/brief.pdf",
    });
    await expect(repository.startBrandAnalysis({
      workspaceId,
      brandId,
      analysisId: created.id,
    })).resolves.toMatchObject({ status: "queued" });
  });

  it("enforces the persisted 20-minute deadline on heartbeat and completion", async () => {
    const repository = createBrandIntelligenceRepository(pglitePool(database));
    const created = await repository.requestBrandAnalysis({
      workspaceId,
      brandId,
      companyName: "모종애드",
      ownedUrl: "https://example.com",
      uploadIds: [],
      idempotencyKey: "hard-deadline",
    });
    const claim = await repository.claimBrandAnalysis({
      workerId: "worker-deadline",
      leaseSeconds: 60,
      supportedPipelineVersions: [2],
    });
    await database.query(
      "update brand_analysis_runs set deadline_at = now() - interval '1 second' where id = $1",
      [created.id],
    );
    await expect(repository.heartbeatBrandAnalysis({
      analysisId: created.id,
      workerId: "worker-deadline",
      leaseToken: claim!.leaseToken,
      leaseSeconds: 60,
    })).resolves.toBe(false);
    await expect(repository.completeBrandAnalysis({
      analysisId: created.id,
      workerId: "worker-deadline",
      leaseToken: claim!.leaseToken,
      result: result(),
    })).rejects.toThrow("brand_analysis_lease_invalid");
  });

  it("atomically confirms the onboarding company name with the analysis", async () => {
    const repository = createBrandIntelligenceRepository(pglitePool(database));
    const requested = await repository.requestBrandAnalysis({
      workspaceId,
      brandId,
      companyName: " 새 회사 ",
      ownedUrl: "https://example.com",
      uploadIds: [],
      idempotencyKey: "confirm-company",
    });
    const claim = await repository.claimBrandAnalysis({ workerId: "worker-1", leaseSeconds: 60 });
    await repository.completeBrandAnalysis({
      analysisId: requested.id,
      workerId: "worker-1",
      leaseToken: claim!.leaseToken,
      result: result(),
    });
    await repository.confirmBrandAnalysis({
      workspaceId,
      brandId,
      analysisId: requested.id,
      companyName: "새 회사",
    });
    const brand = await database.query(
      "select name, company_name_state, company_name_confirmed_at from brands where id = $1",
      [brandId],
    );
    expect(brand.rows[0]).toMatchObject({
      name: "새 회사",
      company_name_state: "confirmed",
    });
    expect((brand.rows[0] as { company_name_confirmed_at: unknown } | undefined)
      ?.company_name_confirmed_at).not.toBeNull();
  });

  it("creates one enabled active owned source when confirming a URL", async () => {
    const repository = createBrandIntelligenceRepository(pglitePool(database));
    const requested = await prepareAnalysis(repository, {
      ownedUrl: "  https://Example.com/products  ",
      idempotencyKey: "create-owned-source",
    });

    await repository.confirmBrandAnalysis({ workspaceId, brandId, analysisId: requested.id });

    const sources = await database.query(
      "select source_type, url, url_hash, domain, status, enabled from source_urls where brand_id = $1 and deleted_at is null",
      [brandId],
    );
    expect(sources.rows).toEqual([expect.objectContaining({
      source_type: "owned",
      url: "https://Example.com/products",
      url_hash: hashSourceUrl("https://Example.com/products"),
      domain: "example.com",
      status: "active",
      enabled: true,
    })]);
    const snapshot = await database.query("select input_json from brand_analysis_runs where id = $1", [requested.id]);
    expect((snapshot.rows[0] as { input_json: { ownedUrl: string } }).input_json.ownedUrl)
      .toBe("  https://Example.com/products  ");
  });

  it("updates an existing owned source in place and clears stale crawl metadata", async () => {
    const existingId = "30000000-0000-4000-8000-000000000001";
    await database.query(
      `insert into source_urls (
         id, workspace_id, brand_id, source_type, url, url_hash, domain, title, meta_description,
         status, enabled, last_crawled_at, last_error, disabled_at
       ) values ($1, $2, $3, 'owned', $4, $5, $6, '이전 제목', '이전 설명',
         'disabled', false, now(), '이전 오류', now())`,
      [existingId, workspaceId, brandId, "https://old.example.com", hashSourceUrl("https://old.example.com"), "old.example.com"],
    );
    const repository = createBrandIntelligenceRepository(pglitePool(database));
    const requested = await prepareAnalysis(repository, {
      ownedUrl: "https://new.example.com/about",
      idempotencyKey: "update-owned-source",
    });

    await repository.confirmBrandAnalysis({ workspaceId, brandId, analysisId: requested.id });

    const source = await database.query("select * from source_urls where brand_id = $1", [brandId]);
    expect(source.rows).toHaveLength(1);
    expect(source.rows[0]).toMatchObject({
      id: existingId,
      url: "https://new.example.com/about",
      url_hash: hashSourceUrl("https://new.example.com/about"),
      domain: "new.example.com",
      status: "active",
      enabled: true,
      title: null,
      meta_description: null,
      last_crawled_at: null,
      last_error: null,
      disabled_at: null,
    });
  });

  it("does not reset metadata or create a duplicate for the same normalized URL", async () => {
    const existingId = "30000000-0000-4000-8000-000000000002";
    await database.query(
      `insert into source_urls (
         id, workspace_id, brand_id, source_type, url, url_hash, domain, title, meta_description,
         status, enabled, last_crawled_at
       ) values ($1, $2, $3, 'owned', $4, $5, $6, '보존할 제목', '보존할 설명', 'crawled', true, '2026-07-01T00:00:00Z')`,
      [existingId, workspaceId, brandId, "https://example.com", hashSourceUrl("https://example.com"), "example.com"],
    );
    const repository = createBrandIntelligenceRepository(pglitePool(database));
    const requested = await prepareAnalysis(repository, {
      ownedUrl: "  https://example.com  ",
      idempotencyKey: "same-owned-source",
    });

    await repository.confirmBrandAnalysis({ workspaceId, brandId, analysisId: requested.id });

    const source = await database.query(
      "select id, title, meta_description, status, enabled, last_crawled_at from source_urls where brand_id = $1",
      [brandId],
    );
    expect(source.rows).toHaveLength(1);
    expect(source.rows[0]).toMatchObject({
      id: existingId,
      title: "보존할 제목",
      meta_description: "보존할 설명",
      status: "crawled",
      enabled: true,
    });
    expect(new Date(String((source.rows[0] as { last_crawled_at: unknown }).last_crawled_at)).toISOString())
      .toBe("2026-07-01T00:00:00.000Z");
  });

  it("preserves the current owned source when confirming without an owned URL", async () => {
    const existingId = "30000000-0000-4000-8000-000000000003";
    await database.query(
      `insert into source_urls (
         id, workspace_id, brand_id, source_type, url, url_hash, domain, title, status, enabled
       ) values ($1, $2, $3, 'owned', $4, $5, $6, '기존 제목', 'crawled', true)`,
      [existingId, workspaceId, brandId, "https://existing.example.com", hashSourceUrl("https://existing.example.com"), "existing.example.com"],
    );
    const repository = createBrandIntelligenceRepository(pglitePool(database));
    const requested = await prepareAnalysis(repository, {
      ownedUrl: null,
      idempotencyKey: "preserve-owned-source",
    });

    await repository.confirmBrandAnalysis({ workspaceId, brandId, analysisId: requested.id });

    const source = await database.query("select id, url, title, status from source_urls where brand_id = $1", [brandId]);
    expect(source.rows).toEqual([expect.objectContaining({
      id: existingId,
      url: "https://existing.example.com",
      title: "기존 제목",
      status: "crawled",
    })]);
  });
});
