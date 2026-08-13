import { PGlite } from "@electric-sql/pglite";
import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createBrandIntelligenceRepository } from "./brandIntelligenceRepository.js";
import type { BrandIntelligenceResultV2 } from "./brandIntelligenceContracts.js";
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

function resultV2(target = "중소 브랜드"): BrandIntelligenceResultV2 {
  return {
    contractVersion: "brand-intelligence-result.v2",
    companyNameSuggestion: { name: "테스트 회사", sourceFactIds: ["fact-1"] },
    oneLineDefinition: "브랜드 운영 파트너",
    companyOverview: "브랜드 운영을 돕는 회사입니다.",
    businessDescription: "콘텐츠 제작과 운영을 연결합니다.",
    primaryCategory: { code: "marketing", name: "마케팅" },
    subcategories: [],
    primaryTarget: target,
    secondaryTargets: [],
    customerNeeds: ["반복 운영 절감"],
    valueProposition: "브랜드 운영 시간을 줄입니다.",
    differentiators: ["자사 근거 중심"],
    coreAppeal: "운영 효율",
    supportingAppeals: [],
    offerings: [{
      kind: "service",
      name: "브랜드 운영",
      description: "콘텐츠 운영 서비스",
      target: "중소 브랜드",
      benefit: "운영 시간 절감",
      priceText: null,
      purchaseUrl: "https://example.com/service",
      sourceFactIds: ["fact-1"],
    }],
    faqSuggestions: [{
      question: "가격은 얼마인가요?",
      answer: "상담 후 안내합니다.",
      category: "price",
      sourceFactIds: ["fact-1"],
    }],
    keywords: ["브랜드"],
    observedTone: { summary: "명확함", sourceFactIds: ["fact-1"] },
    competitors: [],
    marketContext: [],
    evidence: [{
      fieldPath: "businessDescription",
      claim: "콘텐츠 제작과 운영을 연결합니다.",
      sourceId: "owned-page-1",
      sourceUrl: "https://example.com/about",
      excerpt: "콘텐츠 제작과 운영",
      sourceKind: "owned",
    }],
    sourceGaps: [],
  };
}

function evidenceV2() {
  return [{
    sourceId: "owned-page-1",
    sourceType: "owned_url" as const,
    title: "회사 소개",
    sourceUrl: "https://example.com/about",
    textBlocks: [{ heading: null, text: "콘텐츠 제작과 운영을 연결합니다." }],
    tables: [],
    contentHash: "a".repeat(64),
  }];
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
    evidence: evidenceV2(),
    result: resultV2("초기 고객"),
    registry: { ownedFactIds: ["fact-1"], externalSources: [] },
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
        company_name_state text not null default 'legacy_unknown',
        company_name_confirmed_at timestamptz,
        deleted_at timestamptz,
        unique (id, workspace_id)
      );
      create table content_categories (
        id uuid primary key, code text unique, name text not null,
        active boolean not null default true, sort_order integer not null default 0
      );
      create table content_subcategories (
        id uuid primary key, category_id uuid not null, code text unique, name text not null,
        active boolean not null default true, sort_order integer not null default 0
      );
      create table brand_profiles (
        id uuid primary key default gen_random_uuid(), workspace_id uuid not null, brand_id uuid not null unique,
        primary_customer text, description text, primary_category_id uuid, active_brand_analysis_id uuid,
        active_brand_core_id uuid, active_brand_rule_set_id uuid,
        forbidden_terms jsonb not null default '[]'::jsonb, default_cta text,
        auto_approval_enabled boolean not null default false
      );
      create table brand_analysis_runs (
        id uuid primary key default gen_random_uuid(), workspace_id uuid not null, brand_id uuid not null,
        status text not null default 'queued', input_json jsonb not null default '{}'::jsonb,
        evidence_json jsonb not null default '[]'::jsonb, result_json jsonb, edited_result_json jsonb,
        idempotency_key text not null, is_active boolean not null default false, leased_by text, lease_token uuid,
        lease_expires_at timestamptz, attempt_count int not null default 0, available_at timestamptz not null default now(),
        error_code text, error_message text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
        completed_at timestamptz, confirmed_at timestamptz,
        active_started_at timestamptz, deadline_at timestamptz,
        pipeline_version integer not null default 1,
        contract_version text not null default 'brand-intelligence-result.v1',
        current_stage text,
        selected_page_count integer not null default 0,
        successful_page_count integer not null default 0,
        failed_page_count integer not null default 0,
        required_page_count integer not null default 0,
        external_page_count integer not null default 0,
        offering_count integer not null default 0,
        completed_cli_stage_count integer not null default 0,
        total_cli_stage_count integer not null default 8,
        retention_expires_at timestamptz, cancel_requested_at timestamptz,
        purged_at timestamptz, tombstone_expires_at timestamptz,
        state_version integer not null default 0,
        logical_call_count integer not null default 0,
        physical_cli_count integer not null default 0,
        retry_call_count integer not null default 0,
        unique (id, workspace_id, brand_id),
        unique (brand_id, idempotency_key)
      );
      create unique index one_active on brand_analysis_runs(brand_id) where is_active;
      create unique index one_open on brand_analysis_runs(brand_id)
        where status in (
          'queued', 'extracting', 'analyzing', 'accepting_uploads',
          'waiting_for_resource', 'running', 'finalizing', 'review_ready',
          'cancel_requested', 'purging'
        );
      create table brand_analysis_uploads (
        id uuid primary key default gen_random_uuid(), workspace_id uuid not null, brand_id uuid not null,
        analysis_id uuid, file_name text not null, mime_type text not null, byte_size bigint not null,
        checksum text not null, storage_path text unique, storage_url text,
        upload_status text not null default 'intent', upload_attempt_count integer not null default 0,
        upload_expires_at timestamptz, upload_completed_at timestamptz,
        cleanup_status text not null default 'none', deleted_at timestamptz,
        created_at timestamptz not null default now()
      );
      create table brand_analysis_upload_attempts (
        id uuid primary key default gen_random_uuid(), upload_id uuid not null,
        analysis_id uuid not null, attempt_number integer not null,
        storage_path text not null, storage_url text, status text not null,
        lease_expires_at timestamptz, completed_at timestamptz, deleted_at timestamptz,
        error_code text, created_at timestamptz not null default now(),
        unique (upload_id, attempt_number)
      );
      create unique index one_upload_stream
        on brand_analysis_upload_attempts(analysis_id) where status = 'uploading';
      create table brand_analysis_stage_runs (
        id uuid primary key default gen_random_uuid(), analysis_id uuid not null,
        stage_code text not null, stage_instance_key text not null, attempt integer not null default 1,
        status text not null, started_at timestamptz not null default now(),
        finished_at timestamptz, duration_ms integer, input_count integer not null default 0,
        success_count integer not null default 0, failed_count integer not null default 0,
        error_code text,
        unique (analysis_id, stage_instance_key)
      );
      create table brand_analysis_cli_calls (
        id uuid primary key default gen_random_uuid(), analysis_id uuid not null,
        stage_run_id uuid not null, logical_call_key text not null, logical_index integer not null,
        status text not null, finished_at timestamptz,
        unique (analysis_id, logical_call_key), unique (analysis_id, logical_index)
      );
      create table brand_analysis_cli_attempts (
        id uuid primary key default gen_random_uuid(), call_id uuid not null,
        physical_attempt integer not null, status text not null,
        started_at timestamptz not null default now(), finished_at timestamptz,
        duration_ms integer, error_code text, unique (call_id, physical_attempt)
      );
      create table brand_offerings (
        id uuid primary key default gen_random_uuid(), workspace_id uuid not null,
        brand_id uuid not null, source_analysis_id uuid not null,
        offering_type text not null, name text not null, description text,
        target_customer text, benefit text, price_text text, purchase_url text,
        sort_order integer not null
      );
      create table product_services (
        id uuid primary key default gen_random_uuid(), workspace_id uuid not null, brand_id uuid not null,
        kind text not null, display_name text not null, status text not null default 'active',
        active_version_id uuid, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
      );
      create table product_service_versions (
        id uuid primary key default gen_random_uuid(), workspace_id uuid not null, brand_id uuid not null,
        product_service_id uuid not null, version integer not null, status text not null,
        profile_json jsonb not null, evidence_json jsonb not null default '[]'::jsonb,
        created_by_user_id uuid, approved_by_user_id uuid, approved_at timestamptz,
        created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
        unique (workspace_id, brand_id, product_service_id, version)
      );
      create table brand_core_versions (
        id uuid primary key default gen_random_uuid(), workspace_id uuid not null, brand_id uuid not null,
        source_analysis_id uuid, version integer not null, status text not null,
        core_json jsonb not null, evidence_json jsonb not null default '[]'::jsonb,
        review_state_json jsonb not null default '{}'::jsonb, created_by text not null,
        created_by_user_id uuid, approved_by_user_id uuid, approved_at timestamptz,
        created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
        unique (workspace_id, brand_id, version)
      );
      create unique index one_approved_brand_core
        on brand_core_versions(workspace_id, brand_id) where status = 'approved';
      create table brand_rule_sets (
        id uuid primary key default gen_random_uuid(), workspace_id uuid not null, brand_id uuid not null,
        version integer not null, status text not null, rules_json jsonb not null,
        created_by text not null, created_by_user_id uuid, approved_by_user_id uuid,
        approved_at timestamptz, created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(), unique (workspace_id, brand_id, version)
      );
      create unique index one_approved_brand_rules
        on brand_rule_sets(workspace_id, brand_id) where status = 'approved';
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
        normalized_question text not null, entry_type text not null, question text, answer text,
        title text, content text, category text,
        aliases text[] not null default '{}', keywords text[] not null default '{}', structured_data jsonb not null default '{}'::jsonb,
        direct_reply_enabled boolean not null default false, enabled boolean not null default true,
        last_import_id uuid, origin text not null default 'import',
        provenance_json jsonb not null default '{}'::jsonb, status text not null default 'active',
        created_by_user_id uuid, approved_by_user_id uuid, approved_at timestamptz,
        updated_at timestamptz not null default now(),
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
    await database.query(
      `insert into content_categories (id, code, name, sort_order, active) values
        ('30000000-0000-4000-8000-000000000001', 'marketing', '마케팅', 1, true),
        ('30000000-0000-4000-8000-000000000002', 'software', '소프트웨어', 2, true),
        ('30000000-0000-4000-8000-000000000003', 'sales', '영업', 3, true),
        ('30000000-0000-4000-8000-000000000004', 'inactive', '비활성 분야', 4, false)`,
    );
    await database.query(
      `insert into content_subcategories (id, category_id, code, name, sort_order, active) values
        ('40000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'content', '콘텐츠 마케팅', 1, true),
        ('40000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000002', 'saas', 'SaaS', 1, true),
        ('40000000-0000-4000-8000-000000000003', '30000000-0000-4000-8000-000000000003', 'lead-generation', '리드 발굴', 1, true),
        ('40000000-0000-4000-8000-000000000004', '30000000-0000-4000-8000-000000000001', 'inactive-content', '비활성 콘텐츠', 2, false)`,
    );
  }, 30_000);
  afterEach(async () => database.close());

  it("runs a v2 onboarding analysis and atomically confirms company and offerings", async () => {
    const repository = createBrandIntelligenceRepository(pglitePool(database));
    const requested = await repository.requestBrandAnalysis({
      workspaceId,
      brandId,
      companyName: "테스트 회사",
      ownedUrl: "https://example.com",
      uploadIds: [],
      idempotencyKey: "v2-analysis",
    });
    expect(requested).toMatchObject({
      status: "waiting_for_resource",
      pipelineVersion: 2,
      contractVersion: "brand-intelligence-result.v2",
    });
    const claim = await repository.claimBrandAnalysis({
      workerId: "worker-v2",
      leaseSeconds: 60,
      supportedPipelineVersions: [2],
    });
    expect(claim).toMatchObject({
      id: requested.id,
      status: "running",
      categoryRegistry: [{
        code: "marketing",
        name: "마케팅",
        subcategories: [{ code: "content", name: "콘텐츠 마케팅" }],
      }, {
        code: "software",
        name: "소프트웨어",
        subcategories: [{ code: "saas", name: "SaaS" }],
      }, {
        code: "sales",
        name: "영업",
        subcategories: [{ code: "lead-generation", name: "리드 발굴" }],
      }],
      executionContract: {
        ownedPageLimit: 20,
        externalPageLimit: 10,
        offeringLimit: 5,
      },
    });
    await repository.completeBrandAnalysis({
      analysisId: requested.id,
      workerId: "worker-v2",
      leaseToken: claim!.leaseToken,
      evidence: [{
        sourceId: "owned-page-1",
        sourceType: "owned_url",
        title: "회사 소개",
        sourceUrl: "https://example.com/about",
        textBlocks: [{ heading: null, text: "콘텐츠 제작과 운영을 연결합니다." }],
        tables: [],
        contentHash: "a".repeat(64),
      }],
      result: resultV2(),
      registry: { ownedFactIds: ["fact-1"], externalSources: [] },
    });
    await repository.confirmBrandAnalysis({
      workspaceId,
      brandId,
      analysisId: requested.id,
      companyName: "테스트 회사",
    });

    const company = await database.query(
      "select name, company_name_state, company_name_confirmed_at from brands where id = $1",
      [brandId],
    );
    expect(company.rows[0]).toMatchObject({
      name: "테스트 회사",
      company_name_state: "confirmed",
    });
    expect((company.rows[0] as { company_name_confirmed_at: unknown } | undefined)
      ?.company_name_confirmed_at).not.toBeNull();
    const offerings = await database.query(
      "select offering_type, name, sort_order from brand_offerings where brand_id = $1",
      [brandId],
    );
    expect(offerings.rows).toEqual([{
      offering_type: "service",
      name: "브랜드 운영",
      sort_order: 0,
    }]);
    const products = await database.query(
      `select item.kind, item.display_name, version.status
         from product_services item
         join product_service_versions version on version.id = item.active_version_id
        where item.brand_id = $1`,
      [brandId],
    );
    expect(products.rows).toEqual([{
      kind: "service",
      display_name: "브랜드 운영",
      status: "approved",
    }]);
    const activeRules = await database.query(
      `select rules.status, rules.version, rules.rules_json
         from brand_profiles profile
         join brand_rule_sets rules on rules.id = profile.active_brand_rule_set_id
        where profile.workspace_id = $1 and profile.brand_id = $2`,
      [workspaceId, brandId],
    );
    expect(activeRules.rows).toMatchObject([{
      status: "approved",
      version: 1,
      rules_json: {
        contractVersion: "brand-rules.v1",
        ctaRules: { defaultCta: "", allowed: [] },
        designRules: { referenceImages: [] },
      },
    }]);
    const faq = await database.query(
      `select question, answer, category, status, enabled
         from knowledge_entries
        where brand_id = $1 and entry_type = 'faq'`,
      [brandId],
    );
    expect(faq.rows).toEqual([{
      question: "가격은 얼마인가요?",
      answer: "상담 후 안내합니다.",
      category: "price",
      status: "draft",
      enabled: false,
    }]);
  });

  it.each([
    ["unknown primary code", { primaryCategory: { code: "unknown", name: "미등록" } }],
    ["mismatched primary name", { primaryCategory: { code: "marketing", name: "다른 이름" } }],
    ["subcategory from another primary", {
      primaryCategory: { code: "marketing", name: "마케팅" },
      subcategories: [{ code: "saas", name: "SaaS" }],
    }],
    ["worker-created custom subcategory", {
      primaryCategory: { code: "marketing", name: "마케팅" },
      subcategories: [{ code: null, name: "직접 생성" }],
    }],
  ])("rejects %s in a worker result", async (_label, categoryPatch) => {
    const repository = createBrandIntelligenceRepository(pglitePool(database));
    const requested = await repository.requestBrandAnalysis({
      workspaceId,
      brandId,
      ownedUrl: "https://example.com",
      uploadIds: [],
      idempotencyKey: `invalid-category-${_label}`,
    });
    const claim = await repository.claimBrandAnalysis({
      workerId: "worker-category",
      leaseSeconds: 60,
      supportedPipelineVersions: [2],
    });

    await expect(repository.completeBrandAnalysis({
      analysisId: requested.id,
      workerId: "worker-category",
      leaseToken: claim!.leaseToken,
      evidence: evidenceV2(),
      result: { ...resultV2(), ...categoryPatch },
      registry: { ownedFactIds: ["fact-1"], externalSources: [] },
    })).rejects.toThrow(/brand_intelligence_(primary_category|subcategory)_not_registered/);
  });

  it("rejects categories and subcategories that are not active members of the catalog", async () => {
    const repository = createBrandIntelligenceRepository(pglitePool(database));
    const requested = await prepareAnalysis(repository, {
      ownedUrl: "https://example.com",
      idempotencyKey: "catalog-validation",
    });
    const base = resultV2();
    const invalidInputs: Array<{ result: BrandIntelligenceResultV2; error: string }> = [
      { result: { ...base, primaryCategory: { code: null, name: "마케팅" } }, error: "brand_analysis_category_invalid" },
      { result: { ...base, primaryCategory: { code: "arbitrary", name: "임의 분야" } }, error: "brand_analysis_category_invalid" },
      { result: { ...base, primaryCategory: { code: "inactive", name: "비활성 분야" } }, error: "brand_analysis_category_invalid" },
      { result: { ...base, subcategories: [{ code: null, name: "자유 입력" }] }, error: "brand_analysis_subcategory_invalid" },
      { result: { ...base, subcategories: [{ code: "unknown", name: "임의 세부 분야" }] }, error: "brand_analysis_subcategory_invalid" },
      { result: { ...base, subcategories: [{ code: "lead-generation", name: "리드 발굴" }] }, error: "brand_analysis_subcategory_invalid" },
      { result: { ...base, subcategories: [{ code: "inactive-content", name: "비활성 콘텐츠" }] }, error: "brand_analysis_subcategory_invalid" },
      {
        result: {
          ...base,
          subcategories: [
            { code: "content", name: "콘텐츠 마케팅" },
            { code: "content", name: "콘텐츠 마케팅" },
          ],
        },
        error: "brand_analysis_subcategory_invalid",
      },
    ];

    for (const invalid of invalidInputs) {
      await expect(repository.confirmBrandAnalysis({
        workspaceId,
        brandId,
        analysisId: requested.id,
        editedResult: invalid.result,
      })).rejects.toThrow(invalid.error);
    }

    const persisted = await database.query(
      "select status, is_active from brand_analysis_runs where id = $1",
      [requested.id],
    );
    expect(persisted.rows[0]).toEqual({ status: "review_ready", is_active: false });
    expect((await database.query("select id from brand_profiles")).rows).toHaveLength(0);

    const confirmed = await repository.confirmBrandAnalysis({
      workspaceId,
      brandId,
      analysisId: requested.id,
      editedResult: {
        ...base,
        primaryCategory: { code: "marketing", name: "사용자 임의 이름" },
        subcategories: [{ code: "content", name: "사용자 임의 세부 이름" }],
      },
    });
    expect(confirmed.effectiveResult).toMatchObject({
      primaryCategory: { code: "marketing", name: "마케팅" },
      subcategories: [{ code: "content", name: "콘텐츠 마케팅" }],
    });
    const catalogLinks = await database.query(
      `select category.code category_code, subcategory.code subcategory_code, selected.custom_name
         from brand_profiles profile
         join content_categories category on category.id = profile.primary_category_id
         left join brand_profile_subcategories selected on selected.brand_profile_id = profile.id
         left join content_subcategories subcategory on subcategory.id = selected.subcategory_id
        where profile.brand_id = $1`,
      [brandId],
    );
    expect(catalogLinks.rows).toEqual([{
      category_code: "marketing",
      subcategory_code: "content",
      custom_name: null,
    }]);
  });

  it("preserves user-edited product and FAQ rows when the same suggestions are confirmed again", async () => {
    await database.query(
      `insert into product_services (id, workspace_id, brand_id, kind, display_name)
       values ('30000000-0000-4000-8000-000000000001', $1, $2, 'service', '브랜드 운영')`,
      [workspaceId, brandId],
    );
    await database.query(
      `insert into product_service_versions (
         id, workspace_id, brand_id, product_service_id, version, status, profile_json, approved_at
       ) values (
         '40000000-0000-4000-8000-000000000001', $1, $2,
         '30000000-0000-4000-8000-000000000001', 1, 'approved',
         '{"contractVersion":"product-service.v1","name":"브랜드 운영","kind":"service","description":"사용자가 수정한 설명","features":[],"benefits":[],"cautions":[],"audiences":[],"appealsByTarget":{},"evergreenPurchaseInfo":"","sourceUrls":[]}'::jsonb,
         now()
       )`,
      [workspaceId, brandId],
    );
    await database.query(
      `update product_services
          set active_version_id = '40000000-0000-4000-8000-000000000001'
        where id = '30000000-0000-4000-8000-000000000001'`,
    );
    await database.query(
      `insert into knowledge_entries (
         workspace_id, brand_id, normalized_question, entry_type, question, answer,
         title, content, category, status, enabled, origin
       ) values ($1, $2, '가격은 얼마인가요?', 'faq', '가격은 얼마인가요?',
         '사용자가 수정한 답변', '가격은 얼마인가요?', '사용자가 수정한 답변',
         'price', 'active', true, 'manual')`,
      [workspaceId, brandId],
    );

    const repository = createBrandIntelligenceRepository(pglitePool(database));
    const requested = await repository.requestBrandAnalysis({
      workspaceId,
      brandId,
      ownedUrl: "https://example.com",
      uploadIds: [],
      idempotencyKey: "preserve-user-edits",
    });
    const claim = await repository.claimBrandAnalysis({
      workerId: "worker-preserve",
      leaseSeconds: 60,
      supportedPipelineVersions: [2],
    });
    await repository.completeBrandAnalysis({
      analysisId: requested.id,
      workerId: "worker-preserve",
      leaseToken: claim!.leaseToken,
      evidence: [{
        sourceId: "owned-page-1",
        sourceType: "owned_url",
        title: "회사 소개",
        sourceUrl: "https://example.com/about",
        textBlocks: [{ heading: null, text: "콘텐츠 제작과 운영을 연결합니다." }],
        tables: [],
        contentHash: "a".repeat(64),
      }],
      result: resultV2(),
      registry: { ownedFactIds: ["fact-1"], externalSources: [] },
    });
    await repository.confirmBrandAnalysis({
      workspaceId,
      brandId,
      analysisId: requested.id,
      companyName: "테스트 회사",
    });

    const products = await database.query(
      "select display_name from product_services where brand_id = $1",
      [brandId],
    );
    expect(products.rows).toHaveLength(1);
    const productVersion = await database.query(
      `select profile_json->>'description' description
         from product_service_versions
        where product_service_id = '30000000-0000-4000-8000-000000000001'`,
    );
    expect(productVersion.rows[0]).toEqual({ description: "사용자가 수정한 설명" });
    const faq = await database.query(
      "select answer, status, enabled from knowledge_entries where entry_type = 'faq'",
    );
    expect(faq.rows).toEqual([{
      answer: "사용자가 수정한 답변",
      status: "active",
      enabled: true,
    }]);
  });

  it("rejects a workspace company-name duplicate after Unicode normalization", async () => {
    const repository = createBrandIntelligenceRepository(pglitePool(database));
    const duplicateName = "카페".normalize("NFD");
    await database.query(
      `insert into brands (id, workspace_id, name, company_name_state, company_name_confirmed_at)
       values (gen_random_uuid(), $1, $2, 'confirmed', now())`,
      [workspaceId, duplicateName],
    );
    const requested = await repository.requestBrandAnalysis({
      workspaceId,
      brandId,
      companyName: "카페",
      ownedUrl: "https://example.com",
      uploadIds: [],
      idempotencyKey: "unicode-company-conflict",
    });
    const claimed = await repository.claimBrandAnalysis({
      workerId: "worker-unicode-conflict",
      leaseSeconds: 60,
      supportedPipelineVersions: [2],
    });
    await repository.completeBrandAnalysis({
      analysisId: requested.id,
      workerId: "worker-unicode-conflict",
      leaseToken: claimed!.leaseToken,
      evidence: [{
        sourceId: "owned-page-1",
        sourceType: "owned_url",
        title: "회사 소개",
        sourceUrl: "https://example.com/about",
        textBlocks: [{ heading: null, text: "콘텐츠 제작과 운영을 연결합니다." }],
        tables: [],
        contentHash: "a".repeat(64),
      }],
      result: resultV2(),
      registry: { ownedFactIds: ["fact-1"], externalSources: [] },
    });

    await expect(repository.confirmBrandAnalysis({
      workspaceId,
      brandId,
      analysisId: requested.id,
      companyName: "카페",
    })).rejects.toThrow("brand_analysis_company_name_conflict");
  });

  it("stores only a safe error code when a worker reports failure details", async () => {
    const repository = createBrandIntelligenceRepository(pglitePool(database));
    const requested = await repository.requestBrandAnalysis({
      workspaceId,
      brandId,
      companyName: "오류 저장 검증 회사",
      ownedUrl: "https://example.com",
      uploadIds: [],
      idempotencyKey: "safe-worker-error",
    });
    const claimed = await repository.claimBrandAnalysis({
      workerId: "worker-safe-error",
      leaseSeconds: 60,
      supportedPipelineVersions: [2],
    });

    await repository.failBrandAnalysis({
      analysisId: requested.id,
      workerId: "worker-safe-error",
      leaseToken: claimed!.leaseToken,
      errorCode: "brand_analysis_cli_failed",
      errorMessage: "secret prompt and source https://private.example/path",
      retryable: false,
    });

    const failed = await database.query(
      "select error_code, error_message from brand_analysis_runs where id = $1",
      [requested.id],
    );
    expect(failed.rows[0]).toEqual({
      error_code: "brand_analysis_cli_failed",
      error_message: "brand_analysis_cli_failed",
    });
  });

  it("rejects a model evidence excerpt that is not present in the registered source", async () => {
    const repository = createBrandIntelligenceRepository(pglitePool(database));
    const requested = await repository.requestBrandAnalysis({
      workspaceId,
      brandId,
      companyName: "근거 검증 회사",
      ownedUrl: "https://example.com",
      uploadIds: [],
      idempotencyKey: "evidence-quote-mismatch",
    });
    const claimed = await repository.claimBrandAnalysis({
      workerId: "worker-evidence-mismatch",
      leaseSeconds: 60,
      supportedPipelineVersions: [2],
    });
    const invalidResult = resultV2();
    invalidResult.evidence[0]!.excerpt = "원문에 없는 조작된 인용";

    await expect(repository.completeBrandAnalysis({
      analysisId: requested.id,
      workerId: "worker-evidence-mismatch",
      leaseToken: claimed!.leaseToken,
      evidence: [{
        sourceId: "owned-page-1",
        sourceType: "owned_url",
        title: "회사 소개",
        sourceUrl: "https://example.com/about",
        textBlocks: [{ heading: null, text: "콘텐츠 제작과 운영을 연결합니다." }],
        tables: [],
        contentHash: "a".repeat(64),
      }],
      result: invalidResult,
      registry: { ownedFactIds: ["fact-1"], externalSources: [] },
    })).rejects.toThrow("brand_intelligence_evidence_quote_mismatch");
  });

  it("cancels an upload-intent run without requiring a nonexistent blob", async () => {
    const repository = createBrandIntelligenceRepository(pglitePool(database));
    const requested = await repository.requestBrandAnalysis({
      workspaceId,
      brandId,
      companyName: "취소 회사",
      ownedUrl: null,
      uploadIds: [],
      uploads: [{
        fileName: "brief.txt",
        mimeType: "text/plain",
        byteSize: 5,
        checksum: "a".repeat(64),
      }],
      idempotencyKey: "cancel-intent",
    });
    const cancelled = await repository.cancelBrandAnalysis({
      workspaceId,
      brandId,
      analysisId: requested.id,
    });
    expect(cancelled).toMatchObject({
      status: "cancelled",
      input: { companyName: null, ownedUrl: null, uploadIds: [] },
    });
    const uploads = await database.query(
      "select id from brand_analysis_uploads where analysis_id = $1",
      [requested.id],
    );
    expect(uploads.rows).toEqual([]);
  });

  it("resets the whole-run lease budget and stage metrics for an explicit retry", async () => {
    const repository = createBrandIntelligenceRepository(pglitePool(database));
    const requested = await repository.requestBrandAnalysis({
      workspaceId,
      brandId,
      companyName: "재시도 회사",
      ownedUrl: "https://example.com",
      uploadIds: [],
      idempotencyKey: "manual-retry",
    });
    await database.query(
      `update brand_analysis_runs
          set status = 'failed', attempt_count = 3,
              logical_call_count = 8, retry_call_count = 2, physical_cli_count = 10,
              external_page_count = 10, offering_count = 5,
              evidence_json = '[{"sourceId":"stale"}]'::jsonb,
              result_json = $2::jsonb, edited_result_json = $2::jsonb,
              retention_expires_at = now() + interval '24 hours'
        where id = $1`,
      [requested.id, JSON.stringify(resultV2())],
    );
    await database.query(
      `insert into brand_analysis_stage_runs
         (analysis_id, stage_code, stage_instance_key, status)
       values ($1, 'owned_facts_1', 'owned_facts_1:1', 'failed')`,
      [requested.id],
    );

    const retried = await repository.retryBrandAnalysis({
      workspaceId,
      brandId,
      analysisId: requested.id,
    });

    expect(retried).toMatchObject({
      status: "waiting_for_resource",
      attemptCount: 0,
      evidence: [],
      result: null,
      editedResult: null,
    });
    const metrics = await database.query(
      `select logical_call_count, retry_call_count, physical_cli_count,
              external_page_count, offering_count, retention_expires_at
         from brand_analysis_runs where id = $1`,
      [requested.id],
    );
    expect(metrics.rows[0]).toMatchObject({
      logical_call_count: 0,
      retry_call_count: 0,
      physical_cli_count: 0,
      external_page_count: 0,
      offering_count: 0,
      retention_expires_at: null,
    });
    const stages = await database.query(
      "select id from brand_analysis_stage_runs where analysis_id = $1",
      [requested.id],
    );
    expect(stages.rows).toEqual([]);
    await expect(repository.claimBrandAnalysis({
      workerId: "worker-after-manual-retry",
      leaseSeconds: 60,
      supportedPipelineVersions: [2],
    })).resolves.toMatchObject({ id: requested.id, attemptCount: 1 });
  });

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
      evidence: evidenceV2(),
      result: resultV2("초기 고객"),
      registry: { ownedFactIds: ["fact-1"], externalSources: [] },
    });
    const edited = await repository.updateBrandAnalysisDraft({
      workspaceId, brandId, analysisId: requested.id, editedResult: resultV2("수정한 고객"),
    });
    expect(edited.effectiveResult?.primaryTarget).toBe("수정한 고객");

    const confirmed = await repository.confirmBrandAnalysis({ workspaceId, brandId, analysisId: requested.id });
    expect(confirmed.status).toBe("confirmed");
    expect(confirmed.isActive).toBe(true);

    const profile = await database.query("select primary_customer, description, active_brand_analysis_id from brand_profiles where brand_id = $1", [brandId]);
    expect(profile.rows[0]).toMatchObject({
      primary_customer: "수정한 고객",
      description: "콘텐츠 제작과 운영을 연결합니다.",
      active_brand_analysis_id: requested.id,
    });
    const core = await database.query(
      "select status, core_json from brand_core_versions where brand_id = $1",
      [brandId],
    );
    expect(core.rows[0]).toMatchObject({
      status: "approved",
      core_json: {
        contractVersion: "brand-core.v1",
        audiences: [{ name: "수정한 고객", problem: "", desiredOutcome: "" }],
      },
    });
    const builds = await database.query("select count(*)::int as count from wiki_build_requests where brand_id = $1", [brandId]);
    expect((builds.rows[0] as { count: number } | undefined)?.count).toBe(1);
    const knowledge = await database.query("select content, direct_reply_enabled from knowledge_entries where brand_id = $1", [brandId]);
    expect(knowledge.rows[0]).toMatchObject({ direct_reply_enabled: false });
    expect(String((knowledge.rows[0] as { content: string }).content)).toContain("수정한 고객");
  });

  it("reuses one open analysis for concurrent requests with different idempotency keys", async () => {
    const repository = createBrandIntelligenceRepository(pglitePool(database));

    const [first, second] = await Promise.all([
      repository.requestBrandAnalysis({
        workspaceId,
        brandId,
        ownedUrl: "https://example.com",
        uploadIds: [],
        idempotencyKey: "concurrent-open-1",
      }),
      repository.requestBrandAnalysis({
        workspaceId,
        brandId,
        ownedUrl: "https://example.com",
        uploadIds: [],
        idempotencyKey: "concurrent-open-2",
      }),
    ]);

    expect(second.id).toBe(first.id);
    const open = await database.query(
      `select id from brand_analysis_runs
        where brand_id = $1
          and status in (
            'queued', 'extracting', 'analyzing', 'accepting_uploads',
            'waiting_for_resource', 'running', 'finalizing', 'review_ready',
            'cancel_requested', 'purging'
          )`,
      [brandId],
    );
    expect(open.rows).toEqual([{ id: first.id }]);
    await expect(repository.getOpenBrandAnalysis({ workspaceId, brandId }))
      .resolves.toMatchObject({ id: first.id, status: "waiting_for_resource" });
  });

  it("keeps the confirmed edited result active when a later analysis completes", async () => {
    const repository = createBrandIntelligenceRepository(pglitePool(database));
    const first = await prepareAnalysis(repository, {
      ownedUrl: "https://example.com",
      idempotencyKey: "confirmed-analysis",
    });
    await repository.updateBrandAnalysisDraft({
      workspaceId,
      brandId,
      analysisId: first.id,
      editedResult: resultV2("사용자 확정 고객"),
    });
    await repository.confirmBrandAnalysis({ workspaceId, brandId, analysisId: first.id });

    const second = await repository.requestBrandAnalysis({
      workspaceId,
      brandId,
      ownedUrl: "https://example.com/new",
      uploadIds: [],
      idempotencyKey: "later-analysis",
    });
    const claim = await repository.claimBrandAnalysis({ workerId: "worker-2", leaseSeconds: 60 });
    await repository.completeBrandAnalysis({
      analysisId: second.id,
      workerId: "worker-2",
      leaseToken: claim!.leaseToken,
      evidence: evidenceV2(),
      result: resultV2("재분석 제안 고객"),
      registry: { ownedFactIds: ["fact-1"], externalSources: [] },
    });

    const current = await repository.getCurrentBrandIntelligence({ workspaceId, brandId });
    expect(current).toMatchObject({
      id: first.id,
      status: "confirmed",
      isActive: true,
      effectiveResult: { primaryTarget: "사용자 확정 고객" },
    });
    await expect(repository.getOpenBrandAnalysis({ workspaceId, brandId })).resolves.toMatchObject({
      id: second.id,
      status: "review_ready",
      isActive: false,
    });
    const rows = await database.query(
      `select id, result_json, edited_result_json, is_active
         from brand_analysis_runs
        where brand_id = $1
        order by created_at`,
      [brandId],
    );
    expect(rows.rows).toEqual([
      expect.objectContaining({
        id: first.id,
        result_json: expect.objectContaining({ primaryTarget: "초기 고객" }),
        edited_result_json: expect.objectContaining({ primaryTarget: "사용자 확정 고객" }),
        is_active: true,
      }),
      expect.objectContaining({
        id: second.id,
        result_json: expect.objectContaining({ primaryTarget: "재분석 제안 고객" }),
        edited_result_json: null,
        is_active: false,
      }),
    ]);
    const profile = await database.query(
      "select primary_customer, active_brand_analysis_id from brand_profiles where brand_id = $1",
      [brandId],
    );
    expect(profile.rows[0]).toMatchObject({
      primary_customer: "사용자 확정 고객",
      active_brand_analysis_id: first.id,
    });
    const builds = await database.query(
      "select count(*)::int as count from wiki_build_requests where brand_id = $1",
      [brandId],
    );
    expect((builds.rows[0] as { count: number }).count).toBe(1);
  });

  it("rejects edits before analysis and isolates brand reads", async () => {
    const repository = createBrandIntelligenceRepository(pglitePool(database));
    const requested = await repository.requestBrandAnalysis({
      workspaceId, brandId, ownedUrl: "https://example.com", uploadIds: [], idempotencyKey: "analysis-1",
    });
    await expect(repository.updateBrandAnalysisDraft({
      workspaceId, brandId, analysisId: requested.id, editedResult: resultV2(),
    })).rejects.toThrow("brand_analysis_not_review_ready");
    await expect(repository.getBrandAnalysis({ workspaceId, brandId: "20000000-0000-4000-8000-000000000002", analysisId: requested.id }))
      .resolves.toBeNull();
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

  it("records an upload attempt and closes its lease after confirmation", async () => {
    const repository = createBrandIntelligenceRepository(pglitePool(database));
    const requested = await repository.requestBrandAnalysis({
      workspaceId,
      brandId,
      companyName: "업로드 회사",
      ownedUrl: null,
      uploadIds: [],
      uploads: [{
        fileName: "brief.txt",
        mimeType: "text/plain",
        byteSize: 5,
        checksum: "b".repeat(64),
      }],
      idempotencyKey: "upload-attempt",
    });
    const upload = await database.query(
      "select id from brand_analysis_uploads where analysis_id = $1",
      [requested.id],
    );
    const uploadId = String((upload.rows[0] as { id: unknown }).id);
    const storagePath = `brands/${brandId}/brand-analysis/${requested.id}/uploads/brief.txt`;
    await repository.beginBrandAnalysisUpload({
      workspaceId,
      brandId,
      analysisId: requested.id,
      uploadId,
      storagePath,
      fileName: "brief.txt",
      mimeType: "text/plain",
      byteSize: 5,
      checksum: "b".repeat(64),
    });
    await repository.completeBrandAnalysisUpload({
      workspaceId,
      brandId,
      analysisId: requested.id,
      uploadId,
      storagePath,
      storageUrl: `https://blob.vercel-storage.com/${storagePath}`,
    });

    const attempts = await database.query(
      `select attempt_number, status, lease_expires_at, storage_url
         from brand_analysis_upload_attempts where upload_id = $1`,
      [uploadId],
    );
    expect(attempts.rows).toEqual([{
      attempt_number: 1,
      status: "succeeded",
      lease_expires_at: null,
      storage_url: `https://blob.vercel-storage.com/${storagePath}`,
    }]);
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
