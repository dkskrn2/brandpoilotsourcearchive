import { PGlite } from "@electric-sql/pglite";
import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createAiContentSubjectRepository,
  SUBJECT_ANALYSIS_CLAIM_SQL,
  SUBJECT_ANALYSIS_INSERT_SQL,
  type SubjectAnalysisClaim,
  type SubjectAnalysisRepository,
} from "./aiContentSubjectRepository.js";
import type {
  SubjectAnalysisResultV1,
  SubjectAnalysisResultV2,
  SubjectAppealResultV2,
} from "./aiContentSubjectContracts.js";

type QueryResult = { rowCount: number; rows: Record<string, unknown>[] };

function pglitePool(database: PGlite): Pool {
  let transactionTail = Promise.resolve();

  async function execute(sql: string, values: unknown[] = []): Promise<QueryResult> {
    const result = await database.query(sql, values as never[]);
    return {
      rowCount: result.rows.length || Number(result.affectedRows ?? 0),
      rows: result.rows as Record<string, unknown>[],
    };
  }

  return {
    query: execute,
    async connect() {
      let releaseTransaction: (() => void) | null = null;
      return {
        async query(sql: string, values: unknown[] = []) {
          const command = sql.trim().toLowerCase();
          if (command === "begin") {
            const previous = transactionTail;
            transactionTail = new Promise<void>((resolve) => { releaseTransaction = resolve; });
            await previous;
          }
          try {
            return await execute(sql, values);
          } finally {
            if ((command === "commit" || command === "rollback") && releaseTransaction) {
              releaseTransaction();
              releaseTransaction = null;
            }
          }
        },
        release() {},
      };
    },
  } as unknown as Pool;
}

async function createSchema(database: PGlite) {
  await database.exec(`
    create table brands (
      id uuid primary key,
      workspace_id uuid not null,
      unique (id, workspace_id)
    );
    create table ai_content_generations (
      id uuid primary key,
      workspace_id uuid not null,
      brand_id uuid not null,
      unique (id, workspace_id, brand_id)
    );
    create table ai_content_subject_analyses (
      id uuid primary key,
      workspace_id uuid not null,
      brand_id uuid not null,
      subject_type text not null,
      source_url text null,
      normalized_url text null,
      generation_id uuid null,
      contract_version text not null default 'subject-analysis.v1',
      attachment_ids_json jsonb not null default '[]'::jsonb,
      analysis_result_json jsonb not null default '{}'::jsonb,
      input_json jsonb not null default '{}'::jsonb,
      status text not null default 'queued',
      facts_json jsonb not null default '[]'::jsonb,
      structured_data_json jsonb not null default '{}'::jsonb,
      research_json jsonb not null default '{}'::jsonb,
      targets_json jsonb not null default '[]'::jsonb,
      appeals_json jsonb not null default '{}'::jsonb,
      selected_image_id uuid null,
      analysis_version integer not null default 1,
      idempotency_key text not null,
      leased_by text null,
      lease_token uuid null,
      lease_expires_at timestamptz null,
      attempt_count integer not null default 0,
      available_at timestamptz not null default now(),
      error_code text null,
      error_message text null,
      superseded_at timestamptz null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      completed_at timestamptz null,
      unique (brand_id, idempotency_key)
    );
    create unique index ai_content_subject_legacy_active_cache_uq
      on ai_content_subject_analyses (brand_id, subject_type, normalized_url)
      where generation_id is null and superseded_at is null;
    create unique index ai_content_subject_legacy_version_uq
      on ai_content_subject_analyses (brand_id, subject_type, normalized_url, analysis_version)
      where generation_id is null;
    create unique index ai_content_subject_generation_active_uq
      on ai_content_subject_analyses (generation_id)
      where generation_id is not null and superseded_at is null;
    create table ai_content_subject_images (
      id uuid primary key,
      analysis_id uuid not null,
      workspace_id uuid not null,
      brand_id uuid not null,
      source_url text not null,
      storage_url text not null,
      storage_path text not null,
      width integer null,
      height integer null,
      mime_type text not null,
      alt_text text null,
      role text not null,
      selection_score numeric not null default 0,
      created_at timestamptz not null default now(),
      deleted_at timestamptz null,
      unique (analysis_id, source_url)
    );
  `);
}

const workspaceId = "10000000-0000-4000-8000-000000000001";
const otherWorkspaceId = "10000000-0000-4000-8000-000000000002";
const brandId = "20000000-0000-4000-8000-000000000001";
const otherBrandId = "20000000-0000-4000-8000-000000000002";
const generationId = "50000000-0000-4000-8000-000000000001";
const otherGenerationId = "50000000-0000-4000-8000-000000000002";
const attachmentId = "60000000-0000-4000-8000-000000000001";

function request(overrides: Record<string, unknown> = {}) {
  return {
    workspaceId,
    brandId,
    subjectType: "product" as const,
    sourceUrl: "https://Example.com:443/products/widget/?utm_source=test#details",
    manualInput: { name: "Widget", promotion: "", description: "A useful widget" },
    idempotencyKey: "request-1",
    force: false,
    ...overrides,
  };
}

function pipelineRequest(overrides: Record<string, unknown> = {}) {
  return {
    workspaceId,
    brandId,
    generationId,
    subjectType: "product" as const,
    sourceUrl: "https://example.com/products/widget",
    attachmentIds: [attachmentId],
    manualInput: { name: "Widget", promotionOrTerms: "10% off", description: "A useful widget" },
    idempotencyKey: "pipeline-request-1",
    ...overrides,
  };
}

function extraction(imageSuffix = "one") {
  return {
    facts: [{ key: "name", value: "Widget", sourceUrl: "https://example.com/products/widget" }],
    structuredData: { "@type": "Product", name: "Widget" },
    images: [{
      sourceUrl: `https://example.com/images/${imageSuffix}.png`,
      storageUrl: `https://storage.example/${imageSuffix}.png`,
      storagePath: `subjects/${imageSuffix}.png`,
      width: 1200,
      height: 1200,
      mimeType: "image/png",
      altText: "Widget",
      role: "product" as const,
    }],
  };
}

function result(recommendedImageId: string | null = null, sourceGaps: string[] = []): SubjectAnalysisResultV1 {
  const targets = [1, 2, 3].map((index) => ({
    id: `target-${index}`,
    name: `Target ${index}`,
    traits: ["practical"],
    painPoints: ["slow setup"],
    purchaseMotivations: ["save time"],
    uspEvidence: [{ claim: "Fast", support: "Documented setup", sourceUrl: "https://example.com/evidence" }],
  })) as SubjectAnalysisResultV1["targets"];
  return {
    contractVersion: "subject-analysis-result.v1",
    summary: "Widget research",
    needs: [{ text: "Faster setup", sourceUrl: "https://example.com/research" }],
    alternatives: [{ name: "Alternative", strengths: ["known"], limitations: ["slow"], sourceUrls: ["https://example.com/alternative"] }],
    voc: [{ quoteSummary: "Setup takes too long", context: "Public review", sourceUrl: "https://example.com/review" }],
    usps: [{ claim: "Fast", support: "Documented setup", sourceUrl: "https://example.com/evidence" }],
    targets,
    appealsByTarget: Object.fromEntries(targets.map((target) => [target.id, [{
      id: `appeal-${target.id}`,
      targetId: target.id,
      title: "Save time",
      description: "Reduce setup work",
      evidenceType: "public_research" as const,
      connectionReason: "Matches the target need",
      sources: [{ title: "Research", url: "https://example.com/research" }],
    }]])),
    recommendedImageId,
    sourceGaps,
  };
}

function analysisResultV2(sourceGaps: string[] = []): SubjectAnalysisResultV2 {
  return {
    contractVersion: "subject-analysis-result.v2",
    phase: "analysis",
    subjectType: "product",
    summary: "Widget analysis",
    verifiedFacts: [{
      claim: "Fast setup",
      support: "The product guide documents a five minute setup.",
      sourceUrl: `attachment://${attachmentId}`,
    }],
    voc: [],
    alternatives: [],
    barriers: [{ barrier: "Setup time", evidence: "Buyers compare setup effort.", sourceUrls: [] }],
    productProfile: { category: "Productivity" },
    serviceProfile: null,
    serviceSubtype: null,
    sourceGaps,
  };
}

function appealResultV2(): SubjectAppealResultV2 {
  const targets = [1, 2, 3].map((index) => ({
    id: `pipeline-target-${index}`,
    name: `Pipeline Target ${index}`,
    traits: ["practical"],
    painPoints: ["slow setup"],
    purchaseMotivations: ["save time"],
    uspEvidence: [{ claim: "Fast", support: "Documented setup", sourceUrl: "https://example.com/evidence" }],
  })) as SubjectAppealResultV2["targets"];
  return {
    contractVersion: "subject-appeal-result.v2",
    phase: "appeal",
    targets,
    appealsByTarget: Object.fromEntries(targets.map((target) => [target.id, [1, 2].map((index) => ({
      id: `appeal-${target.id}-${index}`,
      targetId: target.id,
      title: `Save time ${index}`,
      description: "Reduce setup work",
      evidenceType: "product_fact" as const,
      connectionReason: "Matches the target need",
      sources: [{ title: "Guide", url: "https://example.com/guide" }],
    }))])),
  };
}

function lease(claim: SubjectAnalysisClaim) {
  return { analysisId: claim.id, workerId: claim.leasedBy!, leaseToken: claim.leaseToken! };
}

describe("createAiContentSubjectRepository", () => {
  let database: PGlite;
  let repository: SubjectAnalysisRepository;

  beforeEach(async () => {
    database = await PGlite.create();
    await createSchema(database);
    await database.query("insert into brands (id, workspace_id) values ($1, $2)", [brandId, workspaceId]);
    await database.query(
      `insert into ai_content_generations (id, workspace_id, brand_id)
       values ($1, $3, $4), ($2, $3, $4)`,
      [generationId, otherGenerationId, workspaceId, brandId],
    );
    repository = createAiContentSubjectRepository(pglitePool(database));
  }, 30_000);

  afterEach(async () => database.close());

  it("reuses the active cache entry for a normalized URL", async () => {
    const first = await repository.requestSubjectAnalysis(request());
    const cached = await repository.requestSubjectAnalysis(request({
      sourceUrl: "https://example.com/products/widget",
      idempotencyKey: "request-2",
    }));

    expect(cached.id).toBe(first.id);
    const count = await database.query("select count(*)::int as count from ai_content_subject_analyses");
    expect((count.rows[0] as { count: number }).count).toBe(1);
  });

  it("forces a new version and supersedes the active entry", async () => {
    const first = await repository.requestSubjectAnalysis(request());
    const forced = await repository.requestSubjectAnalysis(request({ idempotencyKey: "request-2", force: true }));

    expect(forced.analysisVersion).toBe(first.analysisVersion + 1);
    expect(forced.id).not.toBe(first.id);
    const prior = await database.query("select superseded_at from ai_content_subject_analyses where id = $1", [first.id]);
    expect((prior.rows[0] as { superseded_at: unknown }).superseded_at).not.toBeNull();
  });

  it("is idempotent by brand and key even when force is requested", async () => {
    const first = await repository.requestSubjectAnalysis(request({ force: true }));
    const duplicate = await repository.requestSubjectAnalysis(request({ force: true }));
    expect(duplicate.id).toBe(first.id);
  });

  it("rejects analysis requests when the tenant brand parent is missing", async () => {
    await expect(repository.requestSubjectAnalysis(request({ brandId: otherBrandId }))).rejects.toThrow("brand_not_found");
  });

  it("serializes concurrent force requests sharing an idempotency key", async () => {
    const first = await repository.requestSubjectAnalysis(request());
    const [forced, duplicate] = await Promise.all([
      repository.requestSubjectAnalysis(request({ idempotencyKey: "force-same", force: true })),
      repository.requestSubjectAnalysis(request({ idempotencyKey: "force-same", force: true })),
    ]);

    expect(forced.id).toBe(duplicate.id);
    expect(forced.analysisVersion).toBe(first.analysisVersion + 1);
    const count = await database.query("select count(*)::int as count from ai_content_subject_analyses");
    expect((count.rows[0] as { count: number }).count).toBe(2);
  });

  it("serializes concurrent force requests with different keys into ordered versions", async () => {
    await repository.requestSubjectAnalysis(request());
    const forced = await Promise.all([
      repository.requestSubjectAnalysis(request({ idempotencyKey: "force-1", force: true })),
      repository.requestSubjectAnalysis(request({ idempotencyKey: "force-2", force: true })),
    ]);

    expect(forced.map((analysis) => analysis.analysisVersion).sort()).toEqual([2, 3]);
    const active = await database.query("select id from ai_content_subject_analyses where superseded_at is null");
    expect(active.rows).toHaveLength(1);
  });

  it("serializes PGlite transactions while concurrent same-key requests reuse one row; real PostgreSQL concurrency remains integration coverage", async () => {
    const [first, duplicate] = await Promise.all([
      repository.requestSubjectAnalysis(request()),
      repository.requestSubjectAnalysis(request()),
    ]);
    expect(duplicate.id).toBe(first.id);
    const count = await database.query("select count(*)::int as count from ai_content_subject_analyses");
    expect((count.rows[0] as { count: number }).count).toBe(1);
  });

  it("serializes PGlite transactions while concurrent different-key requests reuse the active cache row; real PostgreSQL concurrency remains integration coverage", async () => {
    const [first, cached] = await Promise.all([
      repository.requestSubjectAnalysis(request({ idempotencyKey: "concurrent-1" })),
      repository.requestSubjectAnalysis(request({ idempotencyKey: "concurrent-2" })),
    ]);
    expect(cached.id).toBe(first.id);
    const count = await database.query("select count(*)::int as count from ai_content_subject_analyses");
    expect((count.rows[0] as { count: number }).count).toBe(1);
  });

  it("uses a conflict-tolerant insert for idempotency and active-cache races", () => {
    expect(SUBJECT_ANALYSIS_INSERT_SQL).toMatch(/on conflict do nothing\s+returning/is);
  });

  it("isolates direct reads by workspace and brand", async () => {
    const analysis = await repository.requestSubjectAnalysis(request());
    await expect(repository.getSubjectAnalysis({ workspaceId, brandId: otherBrandId, analysisId: analysis.id })).resolves.toBeNull();
    await expect(repository.getSubjectAnalysis({ workspaceId: otherWorkspaceId, brandId, analysisId: analysis.id })).resolves.toBeNull();
  });

  it("allows only one concurrent worker to claim a row", async () => {
    await repository.requestSubjectAnalysis(request());
    const claims = await Promise.all([
      repository.claimSubjectAnalysis({ workerId: "worker-1", leaseSeconds: 60 }),
      repository.claimSubjectAnalysis({ workerId: "worker-2", leaseSeconds: 60 }),
    ]);
    expect(claims.filter(Boolean)).toHaveLength(1);
  });

  it("keeps queued, expired extracting, and zero-fact expired researching stages explicit", async () => {
    const analysis = await repository.requestSubjectAnalysis(request({
      subjectType: "service",
      sourceUrl: "https://example.com/services/consulting",
    }));
    const queuedClaim = (await repository.claimSubjectAnalysis({ workerId: "worker-1", leaseSeconds: 60 }))!;
    expect(queuedClaim.status).toBe("extracting");

    await database.query("update ai_content_subject_analyses set lease_expires_at = now() - interval '1 second' where id = $1", [analysis.id]);
    const extractingClaim = (await repository.claimSubjectAnalysis({ workerId: "worker-2", leaseSeconds: 60 }))!;
    expect(extractingClaim.status).toBe("extracting");

    await repository.markSubjectExtractionComplete({
      ...lease(extractingClaim),
      facts: [],
      structuredData: {},
      images: [],
    });
    await database.query("update ai_content_subject_analyses set lease_expires_at = now() - interval '1 second' where id = $1", [analysis.id]);
    const researchingClaim = (await repository.claimSubjectAnalysis({ workerId: "worker-3", leaseSeconds: 60 }))!;
    expect(researchingClaim.status).toBe("researching");
  });

  it("uses PostgreSQL skip-locked row claiming in production SQL", () => {
    expect(SUBJECT_ANALYSIS_CLAIM_SQL).toMatch(/for update skip locked/i);
  });

  it("reclaims expired extracting and researching leases", async () => {
    const analysis = await repository.requestSubjectAnalysis(request());
    const extracting = (await repository.claimSubjectAnalysis({ workerId: "worker-1", leaseSeconds: 60 }))!;
    await database.query("update ai_content_subject_analyses set lease_expires_at = now() - interval '1 second' where id = $1", [analysis.id]);
    const reclaimedExtraction = (await repository.claimSubjectAnalysis({ workerId: "worker-2", leaseSeconds: 60 }))!;
    expect(reclaimedExtraction.id).toBe(analysis.id);
    expect(reclaimedExtraction.status).toBe("extracting");
    expect(reclaimedExtraction.leaseToken).not.toBe(extracting.leaseToken);

    await repository.markSubjectExtractionComplete({ ...lease(reclaimedExtraction), ...extraction() });
    await database.query("update ai_content_subject_analyses set lease_expires_at = now() - interval '1 second' where id = $1", [analysis.id]);
    const reclaimedResearch = (await repository.claimSubjectAnalysis({ workerId: "worker-3", leaseSeconds: 60 }))!;
    expect(reclaimedResearch.status).toBe("researching");
  });

  it("heartbeats only the matching active lease identity", async () => {
    await repository.requestSubjectAnalysis(request());
    const claim = (await repository.claimSubjectAnalysis({ workerId: "worker-1", leaseSeconds: 60 }))!;
    await expect(repository.heartbeatSubjectAnalysis({ ...lease(claim), leaseSeconds: 120 })).resolves.toBe(true);
    await expect(repository.heartbeatSubjectAnalysis({ ...lease(claim), workerId: "worker-2", leaseSeconds: 120 })).resolves.toBe(false);
    await expect(repository.heartbeatSubjectAnalysis({ ...lease(claim), leaseToken: "30000000-0000-4000-8000-000000000003", leaseSeconds: 120 })).resolves.toBe(false);
  });

  it("rejects extraction completion after the lease has entered research", async () => {
    await repository.requestSubjectAnalysis(request());
    const claim = (await repository.claimSubjectAnalysis({ workerId: "worker-1", leaseSeconds: 60 }))!;
    await repository.markSubjectExtractionComplete({ ...lease(claim), ...extraction() });
    await expect(repository.markSubjectExtractionComplete({ ...lease(claim), ...extraction("again") }))
      .rejects.toThrow("subject_analysis_lease_invalid");
  });

  it("rejects research completion while the lease is still extracting", async () => {
    await repository.requestSubjectAnalysis(request());
    const claim = (await repository.claimSubjectAnalysis({ workerId: "worker-1", leaseSeconds: 60 }))!;
    await expect(repository.completeSubjectAnalysis({ ...lease(claim), ...result() }))
      .rejects.toThrow("subject_analysis_lease_invalid");
  });

  it("selects only a live image from the same tenant and analysis", async () => {
    const first = await repository.requestSubjectAnalysis(request());
    const firstClaim = (await repository.claimSubjectAnalysis({ workerId: "worker-1", leaseSeconds: 60 }))!;
    const firstExtracted = await repository.markSubjectExtractionComplete({ ...lease(firstClaim), ...extraction("first") });
    const firstImage = firstExtracted.images[0];

    const second = await repository.requestSubjectAnalysis(request({ sourceUrl: "https://example.com/other", idempotencyKey: "request-2" }));
    const secondClaim = (await repository.claimSubjectAnalysis({ workerId: "worker-2", leaseSeconds: 60 }))!;
    const secondExtracted = await repository.markSubjectExtractionComplete({ ...lease(secondClaim), ...extraction("second") });

    await expect(repository.selectSubjectImage({ workspaceId, brandId, analysisId: first.id, imageId: secondExtracted.images[0].id }))
      .rejects.toThrow("subject_analysis_image_not_found");
    await database.query("update ai_content_subject_images set deleted_at = now() where id = $1", [firstImage.id]);
    await expect(repository.selectSubjectImage({ workspaceId, brandId, analysisId: first.id, imageId: firstImage.id }))
      .rejects.toThrow("subject_analysis_image_not_found");
    await database.query("update ai_content_subject_images set deleted_at = null where id = $1", [firstImage.id]);
    const selected = await repository.selectSubjectImage({ workspaceId, brandId, analysisId: first.id, imageId: firstImage.id });
    expect(selected.selectedImageId).toBe(firstImage.id);
    const selectedRow = await database.query("select selected_image_id from ai_content_subject_analyses where id = $1", [first.id]);
    expect((selectedRow.rows[0] as { selected_image_id: string }).selected_image_id).toBe(firstImage.id);
    expect(second.id).not.toBe(first.id);
  });

  it("requires exactly three targets at completion", async () => {
    await repository.requestSubjectAnalysis(request());
    const claim = (await repository.claimSubjectAnalysis({ workerId: "worker-1", leaseSeconds: 60 }))!;
    await repository.markSubjectExtractionComplete({ ...lease(claim), ...extraction() });
    const invalid = { ...result(), targets: result().targets.slice(0, 2) };
    await expect(repository.completeSubjectAnalysis({ ...lease(claim), ...invalid } as never))
      .rejects.toThrow("subject_analysis_targets_invalid");
  });

  it("accepts a recommended image only from the claimed analysis", async () => {
    await repository.requestSubjectAnalysis(request());
    const claim = (await repository.claimSubjectAnalysis({ workerId: "worker-1", leaseSeconds: 60 }))!;
    const extracted = await repository.markSubjectExtractionComplete({ ...lease(claim), ...extraction() });
    await expect(repository.completeSubjectAnalysis({ ...lease(claim), ...result("40000000-0000-4000-8000-000000000004") }))
      .rejects.toThrow("subject_analysis_recommended_image_not_found");

    const completed = await repository.completeSubjectAnalysis({ ...lease(claim), ...result(extracted.images[0].id) });
    expect(completed.status).toBe("ready");
    expect(completed.targets).toHaveLength(3);
    expect(completed.selectedImageId).toBe(extracted.images[0].id);
  });

  it("backs off retryable failures and terminates at three attempts", async () => {
    const analysis = await repository.requestSubjectAnalysis(request());
    const delays: number[] = [];
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const claim = (await repository.claimSubjectAnalysis({ workerId: `worker-${attempt}`, leaseSeconds: 60 }))!;
      const before = Date.now();
      const failed = await repository.failSubjectAnalysis({ ...lease(claim), errorCode: "network", errorMessage: "temporary", retryable: true });
      if (attempt < 3) {
        expect(failed.status).toBe("queued");
        delays.push(new Date(failed.availableAt).getTime() - before);
        await database.query("update ai_content_subject_analyses set available_at = now() where id = $1", [analysis.id]);
      } else {
        expect(failed.status).toBe("failed");
      }
    }
    expect(delays[0]).toBeGreaterThanOrEqual(59_000);
    expect(delays[1]).toBeGreaterThanOrEqual(119_000);
  });

  it("retries research after extraction facts have been stored", async () => {
    await repository.requestSubjectAnalysis(request());
    const claim = (await repository.claimSubjectAnalysis({ workerId: "worker-1", leaseSeconds: 60 }))!;
    await repository.markSubjectExtractionComplete({ ...lease(claim), ...extraction() });
    const failed = await repository.failSubjectAnalysis({ ...lease(claim), errorCode: "network", errorMessage: "temporary", retryable: true });
    expect(failed.status).toBe("researching");
    expect(failed.leaseToken).toBeNull();
  });

  it("retries zero-fact service research without reverting to extraction", async () => {
    await repository.requestSubjectAnalysis(request({
      subjectType: "service",
      sourceUrl: "https://example.com/services/consulting",
    }));
    const claim = (await repository.claimSubjectAnalysis({ workerId: "worker-1", leaseSeconds: 60 }))!;
    await repository.markSubjectExtractionComplete({ ...lease(claim), facts: [], structuredData: {}, images: [] });
    const failed = await repository.failSubjectAnalysis({ ...lease(claim), errorCode: "network", errorMessage: "temporary", retryable: true });
    expect(failed.status).toBe("researching");

    await database.query("update ai_content_subject_analyses set available_at = now() where id = $1", [claim.id]);
    const retried = await repository.claimSubjectAnalysis({ workerId: "worker-2", leaseSeconds: 60 });
    expect(retried?.status).toBe("researching");
  });

  it("terminalizes an expired third attempt and claims the next eligible row", async () => {
    const exhausted = await repository.requestSubjectAnalysis(request());
    const eligible = await repository.requestSubjectAnalysis(request({
      sourceUrl: "https://example.com/products/next",
      idempotencyKey: "next-row",
    }));

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const claim = await repository.claimSubjectAnalysis({ workerId: `worker-${attempt}`, leaseSeconds: 60 });
      expect(claim?.id).toBe(exhausted.id);
      await database.query("update ai_content_subject_analyses set lease_expires_at = now() - interval '1 second' where id = $1", [exhausted.id]);
    }

    const next = await repository.claimSubjectAnalysis({ workerId: "worker-next", leaseSeconds: 60 });
    expect(next?.id).toBe(eligible.id);
    const terminal = await repository.getSubjectAnalysis({ workspaceId, brandId, analysisId: exhausted.id });
    expect(terminal?.status).toBe("failed");
    expect(terminal?.attemptCount).toBe(3);
  });

  it("restores a prior ready version when an expired forced version exhausts three attempts", async () => {
    const prior = await repository.requestSubjectAnalysis(request());
    const priorClaim = (await repository.claimSubjectAnalysis({ workerId: "ready-worker", leaseSeconds: 60 }))!;
    await repository.markSubjectExtractionComplete({ ...lease(priorClaim), ...extraction() });
    await repository.completeSubjectAnalysis({ ...lease(priorClaim), ...result() });

    const forced = await repository.requestSubjectAnalysis(request({ idempotencyKey: "forced-exhausted", force: true }));
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const claim = await repository.claimSubjectAnalysis({ workerId: `forced-worker-${attempt}`, leaseSeconds: 60 });
      expect(claim?.id).toBe(forced.id);
      await database.query("update ai_content_subject_analyses set lease_expires_at = now() - interval '1 second' where id = $1", [forced.id]);
    }

    await expect(repository.claimSubjectAnalysis({ workerId: "sweeper", leaseSeconds: 60 })).resolves.toBeNull();
    const cached = await repository.getCachedSubjectAnalysis({
      workspaceId,
      brandId,
      subjectType: "product",
      sourceUrl: "https://example.com/products/widget",
    });
    expect(cached?.id).toBe(prior.id);
    const failed = await repository.getSubjectAnalysis({ workspaceId, brandId, analysisId: forced.id });
    expect(failed?.status).toBe("failed");
    expect(failed?.supersededAt).not.toBeNull();
  });

  it("restores the latest prior good version after a forced version terminally fails", async () => {
    const first = await repository.requestSubjectAnalysis(request());
    const firstClaim = (await repository.claimSubjectAnalysis({ workerId: "worker-1", leaseSeconds: 60 }))!;
    await repository.markSubjectExtractionComplete({ ...lease(firstClaim), ...extraction("first") });
    await repository.completeSubjectAnalysis({ ...lease(firstClaim), ...result() });

    const forced = await repository.requestSubjectAnalysis(request({ idempotencyKey: "request-2", force: true }));
    const forcedClaim = (await repository.claimSubjectAnalysis({ workerId: "worker-2", leaseSeconds: 60 }))!;
    await repository.failSubjectAnalysis({ ...lease(forcedClaim), errorCode: "invalid", errorMessage: "terminal", retryable: false });

    const cached = await repository.getCachedSubjectAnalysis({ workspaceId, brandId, subjectType: "product", sourceUrl: "https://example.com/products/widget" });
    expect(cached?.id).toBe(first.id);
    const rows = await database.query("select id, superseded_at from ai_content_subject_analyses where id = any($1::uuid[])", [[first.id, forced.id]]);
    const versions = rows.rows as Array<{ id: string; superseded_at: unknown }>;
    expect(versions.find((row) => row.id === first.id)?.superseded_at).toBeNull();
    expect(versions.find((row) => row.id === forced.id)?.superseded_at).not.toBeNull();
  });

  it("runs a v2 analysis through extraction, analysis, and appeal phases", async () => {
    const queued = await repository.requestSubjectAnalysis(pipelineRequest());
    expect(queued).toMatchObject({
      generationId,
      contractVersion: "subject-analysis.v2",
      attachmentIds: [attachmentId],
      status: "queued",
      analysisResult: null,
    });

    const extractionClaim = (await repository.claimSubjectAnalysis({ workerId: "analysis-worker", leaseSeconds: 60 }))!;
    expect(extractionClaim).toMatchObject({ id: queued.id, status: "extracting", phase: "analysis" });

    const analyzing = await repository.markSubjectExtractionComplete({
      ...lease(extractionClaim),
      facts: [],
      structuredData: {},
      images: [],
    });
    expect(analyzing).toMatchObject({ status: "analyzing", phase: "analysis" });

    const appealQueued = await repository.completeSubjectAnalysis({
      ...lease(extractionClaim),
      ...analysisResultV2(),
    });
    expect(appealQueued).toMatchObject({
      status: "generating_appeals",
      analysisResult: analysisResultV2(),
      attemptCount: 0,
      leasedBy: null,
      leaseToken: null,
      leaseExpiresAt: null,
    });

    const appealClaim = (await repository.claimSubjectAnalysis({ workerId: "appeal-worker", leaseSeconds: 60 }))!;
    expect(appealClaim).toMatchObject({ id: queued.id, status: "generating_appeals", phase: "appeal" });

    const completed = await repository.completeSubjectAppeals({ ...lease(appealClaim), ...appealResultV2() });
    expect(completed).toMatchObject({
      status: "ready",
      targets: appealResultV2().targets,
      appealsByTarget: appealResultV2().appealsByTarget,
      analysisResult: analysisResultV2(),
    });
  });

  it("returns the same v2 row for the same generation and idempotency key", async () => {
    const first = await repository.requestSubjectAnalysis(pipelineRequest());
    const duplicate = await repository.requestSubjectAnalysis(pipelineRequest());

    expect(duplicate.id).toBe(first.id);
    const count = await database.query(
      "select count(*)::int as count from ai_content_subject_analyses where generation_id = $1",
      [generationId],
    );
    expect((count.rows[0] as { count: number }).count).toBe(1);
  });

  it("creates separate v2 rows for the same URL in different generations", async () => {
    const first = await repository.requestSubjectAnalysis(pipelineRequest());
    const second = await repository.requestSubjectAnalysis(pipelineRequest({
      generationId: otherGenerationId,
      idempotencyKey: "pipeline-request-2",
    }));

    expect(second.id).not.toBe(first.id);
    expect(second.generationId).toBe(otherGenerationId);
  });

  it("supersedes the active v2 row when the subject type or input changes", async () => {
    const first = await repository.requestSubjectAnalysis(pipelineRequest());
    const changed = await repository.requestSubjectAnalysis(pipelineRequest({
      subjectType: "service",
      sourceUrl: null,
      attachmentIds: [],
      manualInput: { name: "Widget setup", promotionOrTerms: "Monthly", description: "Managed onboarding" },
      idempotencyKey: "pipeline-request-changed",
    }));

    expect(changed).toMatchObject({ generationId, subjectType: "service", analysisVersion: 2 });
    expect(changed.id).not.toBe(first.id);
    const prior = await repository.getSubjectAnalysis({ workspaceId, brandId, analysisId: first.id });
    expect(prior?.supersededAt).not.toBeNull();
  });

  it("preserves the analysis result when a retryable appeal failure is requeued", async () => {
    await repository.requestSubjectAnalysis(pipelineRequest());
    const analysisClaim = (await repository.claimSubjectAnalysis({ workerId: "analysis-worker", leaseSeconds: 60 }))!;
    await repository.markSubjectExtractionComplete({ ...lease(analysisClaim), facts: [], structuredData: {}, images: [] });
    await repository.completeSubjectAnalysis({ ...lease(analysisClaim), ...analysisResultV2() });
    const appealClaim = (await repository.claimSubjectAnalysis({ workerId: "appeal-worker", leaseSeconds: 60 }))!;

    const failed = await repository.failSubjectAnalysis({
      ...lease(appealClaim),
      errorCode: "codex_timeout",
      errorMessage: "temporary",
      retryable: true,
    });

    expect(failed).toMatchObject({
      status: "generating_appeals",
      analysisResult: analysisResultV2(),
      leasedBy: null,
      leaseToken: null,
    });
  });

  it.each([
    { expectedStatus: "ready" as const, sourceGaps: [] },
    { expectedStatus: "partial" as const, sourceGaps: ["pricing not verified"] },
  ])("completes v2 appeals as $expectedStatus", async ({ expectedStatus, sourceGaps }) => {
    await repository.requestSubjectAnalysis(pipelineRequest());
    const analysisClaim = (await repository.claimSubjectAnalysis({ workerId: "analysis-worker", leaseSeconds: 60 }))!;
    await repository.markSubjectExtractionComplete({ ...lease(analysisClaim), facts: [], structuredData: {}, images: [] });
    await repository.completeSubjectAnalysis({ ...lease(analysisClaim), ...analysisResultV2(sourceGaps) });
    const appealClaim = (await repository.claimSubjectAnalysis({ workerId: "appeal-worker", leaseSeconds: 60 }))!;

    const completed = await repository.completeSubjectAppeals({ ...lease(appealClaim), ...appealResultV2() });
    expect(completed.status).toBe(expectedStatus);
  });

  it.each(["ready", "partial"] as const)(
    "regenerates appeals from %s once per idempotency key while preserving analysis",
    async (terminalStatus) => {
      await repository.requestSubjectAnalysis(pipelineRequest());
      const analysisClaim = (await repository.claimSubjectAnalysis({ workerId: "analysis-worker", leaseSeconds: 60 }))!;
      await repository.markSubjectExtractionComplete({ ...lease(analysisClaim), facts: [], structuredData: {}, images: [] });
      const savedAnalysis = analysisResultV2(terminalStatus === "partial" ? ["pricing not verified"] : []);
      await repository.completeSubjectAnalysis({ ...lease(analysisClaim), ...savedAnalysis });
      const appealClaim = (await repository.claimSubjectAnalysis({ workerId: "appeal-worker", leaseSeconds: 60 }))!;
      const completed = await repository.completeSubjectAppeals({ ...lease(appealClaim), ...appealResultV2() });
      expect(completed.status).toBe(terminalStatus);

      const regenerated = await repository.regenerateSubjectAppeals({
        workspaceId,
        brandId,
        analysisId: completed.id,
        idempotencyKey: "appeal-regeneration-1",
      });
      const duplicate = await repository.regenerateSubjectAppeals({
        workspaceId,
        brandId,
        analysisId: completed.id,
        idempotencyKey: "appeal-regeneration-1",
      });

      expect(regenerated).toMatchObject({
        status: "generating_appeals",
        analysisResult: savedAnalysis,
        attemptCount: 0,
        leasedBy: null,
      });
      expect(duplicate.id).toBe(regenerated.id);
      expect(duplicate.updatedAt).toBe(regenerated.updatedAt);
    },
  );
});
