import { createHash, randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import {
  parseContentGenerationInputV3,
  promptBindingFor,
  type ContentOrchestrationV2,
  type VerifiedGeneratedContentCatalog,
} from "@brand-pilot/content-contracts";
import { Pool, type PoolClient } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  createAiContentProposalV2Service,
  proposalSha256,
} from "./aiContentProposalV2Service.js";
import { createAiContentProposalV2Repository, createAiContentRepository } from "./aiContentRepository.js";
import {
  createContentProposalJobsRepository,
  type ContentProposalModelClaim,
  type ContentProposalResearchClaim,
} from "./contentProposalJobs.js";
import { parseProposalInputSnapshotV2 } from "./aiContentGenerationInputV3.js";
import { createBrandIntelligenceProvider } from "./brandIntelligenceProvider.js";
import { createBrandIntelligenceRepository } from "./brandIntelligenceRepository.js";

type FixtureIds = {
  actor: string;
  workspace: string;
  brand: string;
  core: string;
  rules: string;
  evidence: string;
};

type DraftFixture = FixtureIds & {
  batchId: string;
  proposalId: string;
  generationId: string;
  selectIdempotencyKey: string;
};

type StartedFixture = DraftFixture & {
  operationId: string;
  outputIds: string[];
  jobIds: string[];
};

type RoleBootstrapPlan = {
  roleNames: {
    schemaOwnerRoleName: string;
    applicationRoleName: string;
    operatorRoleName: string;
    migrationRoleName: string;
    cleanupRoleName: string;
  };
  relations: string[];
  exclusiveOwnedRelations: string[];
  sharedOwnerTransfers: Array<{
    relationName: string;
    preservedOwnerRoleName: string;
    preservedPrivileges: string[];
  }>;
  sharedRelationAclBefore: {
    relationAclRows: Array<Record<string, unknown>>;
    columnAclRows: Array<Record<string, unknown>>;
  };
  applicationOwnedFunctions: string[];
};

const applicationPassword = "content-application-test-password";
const operatorPassword = "content-operator-test-password";
const migrationPassword = "content-migration-test-password";
const cleanupPassword = "content-cleanup-test-password";
const legacyMainPassword = "legacy-main-test-password";
const brandIntelligenceApplicationPassword = "brand-intelligence-application-test-password";

function connectionStringForRole(connectionString: string, roleName: string, password: string) {
  const value = new URL(connectionString);
  value.username = roleName;
  value.password = password;
  return value.toString();
}

async function applyMigrationsThrough075(pool: Pool): Promise<RoleBootstrapPlan> {
  const directory = resolve(process.cwd(), "../../db/migrations");
  const databaseRoles = await import(pathToFileURL(
    resolve(process.cwd(), "../../scripts/ai-content-database-roles.mjs"),
  ).href) as {
    sharedOwnerTransferSecurityCatalog: Array<{ relationName: string }>;
    exclusiveBootstrapOwnedRelations: string[];
    applicationRuntimeFunctionOwnershipCatalog: string[];
    readSharedRelationAclCatalog(client: PoolClient): Promise<RoleBootstrapPlan["sharedRelationAclBefore"]>;
    createRoleBootstrapPlan(input: {
      databaseName: string;
      preservedRelationOwners: Record<string, string>;
      sharedRelationAclBefore: RoleBootstrapPlan["sharedRelationAclBefore"];
      migrationHistoryOwnerRoleName: string;
    }): RoleBootstrapPlan;
    applyRoleBootstrap(client: PoolClient, plan: RoleBootstrapPlan, passwords: Record<string, string>): Promise<void>;
    restoreSharedRelationOwners(client: PoolClient, plan: RoleBootstrapPlan): Promise<{
      contractVersion: string;
      restoredRelationCount: number;
    }>;
    retireCleanupRole(client: PoolClient, plan: RoleBootstrapPlan, cutoverId: string): Promise<{
      contractVersion: string;
      cutoverId: string;
      cleanupRoleName: string;
      retiredAt: string;
      evidenceSha256: string;
    }>;
  };
  const migrationRunner = await import(pathToFileURL(
    resolve(process.cwd(), "../../scripts/migrationRunner.mjs"),
  ).href) as {
    cutover075RelationSecurityCatalog: Array<{
      relationName: string;
      grants: Array<{ role: string; privileges: string[] }>;
    }>;
    cutover075SecurityFunctions: Array<{
      identity: string;
      execute: string[];
    }>;
  };
  const skipped = new Set([
    "021_dm_wiki_pgvector.sql",
    "027_wiki_search_v2.sql",
    "033_compounding_wiki_pgvector.sql",
  ]);
  const files = (await readdir(directory))
    .filter((name) => name.endsWith(".sql") && name <= "075_ai_content_three_format_cutover.sql")
    .sort();
  const client = await pool.connect();
  let plan: RoleBootstrapPlan | null = null;
  let schemaOwnerActive = false;
  let migration075Checksum: string | null = null;
  try {
    await client.query("create role postgres login superuser");
    await client.query(`create table if not exists public.schema_migrations(
      id text primary key,checksum text not null,applied_at timestamptz not null default now()
    )`);
    for (const file of files) {
      if (skipped.has(file)) continue;
      if (file === "074_ai_content_maintenance_write_fence.sql") {
        // The current role catalog already includes the three post-075 visual
        // relations. Create relation shells before the historical 074/075 harness
        // runs; their real migration and constraints have independent PostgreSQL
        // coverage, while this suite needs the current role catalog and read shape.
        await client.query(`
          create table brand_style_presets (
            id uuid primary key default gen_random_uuid(), workspace_id uuid not null,
            brand_id uuid not null, name text not null, description text not null default '',
            visual_tokens_json jsonb not null default '{}'::jsonb, status text not null default 'active',
            revision integer not null default 1, is_default boolean not null default false,
            created_by_user_id uuid not null, created_at timestamptz not null default now(),
            updated_at timestamptz not null default now()
          );
          create table brand_style_preset_references (
            id uuid primary key default gen_random_uuid(), workspace_id uuid not null,
            brand_id uuid not null, preset_id uuid not null, reference_item_id uuid not null,
            position integer not null, created_at timestamptz not null default now()
          );
          create table manual_ai_content_visual_selections (
            generation_id uuid primary key, workspace_id uuid not null, brand_id uuid not null,
            contract_version text not null, product_service_id uuid null,
            product_service_version_id uuid null, style_preset_id uuid null,
            style_preset_revision integer null, avatar_id uuid null, avatar_revision integer null,
            selection_json jsonb not null, selection_sha256 text not null,
            frozen_json jsonb null, frozen_sha256 text null, frozen_at timestamptz null,
            created_at timestamptz not null default now()
          )
        `);
        const database = await client.query(
          `select current_database() database_name,
                  pg_get_userbyid(history.relowner)::text migration_history_owner_role_name
             from pg_class history
             join pg_namespace namespace on namespace.oid=history.relnamespace
            where namespace.nspname='public' and history.relname='schema_migrations'`,
        );
        if (database.rows.length !== 1) throw new Error("migration_history_owner_missing");
        await client.query(
          `create role legacy_main login inherit nosuperuser nobypassrls
             nocreatedb nocreaterole noreplication password '${legacyMainPassword}'`,
        );
        for (const relationName of [
          ...databaseRoles.exclusiveBootstrapOwnedRelations,
          ...databaseRoles.sharedOwnerTransferSecurityCatalog.map(({ relationName }) => relationName),
        ]) {
          await client.query(`alter table public."${relationName}" owner to legacy_main`);
        }
        for (const identity of databaseRoles.applicationRuntimeFunctionOwnershipCatalog) {
          await client.query(`alter function ${identity} owner to legacy_main`);
        }
        const sharedRelationAclBefore = await databaseRoles.readSharedRelationAclCatalog(client);
        plan = databaseRoles.createRoleBootstrapPlan({
          databaseName: String(database.rows[0]?.database_name),
          preservedRelationOwners: Object.fromEntries(
            databaseRoles.sharedOwnerTransferSecurityCatalog.map(({ relationName }) => [relationName, "legacy_main"]),
          ),
          sharedRelationAclBefore,
          migrationHistoryOwnerRoleName: String(database.rows[0]?.migration_history_owner_role_name),
        });
        await databaseRoles.applyRoleBootstrap(client, plan, {
          [plan.roleNames.applicationRoleName]: applicationPassword,
          [plan.roleNames.operatorRoleName]: operatorPassword,
          [plan.roleNames.migrationRoleName]: migrationPassword,
          [plan.roleNames.cleanupRoleName]: cleanupPassword,
        });
        await client.query(`set role "${plan.roleNames.schemaOwnerRoleName}"`);
        schemaOwnerActive = true;
      }
      let sql = await readFile(resolve(directory, file), "utf8");
      if (file === "075_ai_content_three_format_cutover.sql") {
        migration075Checksum = createHash("sha256").update(sql).digest("hex");
        const start = sql.indexOf("-- 075_FENCE_REGISTRATION_BEGIN");
        const endMarker = "-- 075_FENCE_REGISTRATION_END";
        const end = sql.indexOf(endMarker);
        if (start < 0 || end <= start) throw new Error("cutover_075_fence_markers_missing");
        sql = `${sql.slice(0, start)}${sql.slice(end + endMarker.length)}`;
      }
      await client.query(sql);
    }
    if (!plan) throw new Error("role_bootstrap_plan_missing");
    const names = plan.roleNames;
    await client.query(
      `insert into public.ai_content_bootstrap_state(
         authorization_request_id,authorization_sha256,migration_role_name,
         schema_owner_role_name,application_role_name,operator_role_name,cleanup_role_name,
         migration_sha256,role_catalog_sha256,object_catalog_sha256,
         fence_security_catalog_sha256,event_trigger_catalog_before_json,
         event_trigger_catalog_before_sha256,event_trigger_catalog_before_count,
         install_request_json,install_request_sha256
       ) values(
         'restricted-role-postgres-test',repeat('a',64),$1::name,$2::name,$3::name,$4::name,$5::name,
         repeat('b',64),repeat('c',64),repeat('d',64),repeat('e',64),'{}'::jsonb,
         repeat('f',64),0,'{}'::jsonb,repeat('1',64)
       )`,
      [names.migrationRoleName, names.schemaOwnerRoleName, names.applicationRoleName,
        names.operatorRoleName, names.cleanupRoleName],
    );
    const roleName = (role: string) => {
      if (role === "application") return names.applicationRoleName;
      if (role === "operator") return names.operatorRoleName;
      if (role === "cleanup") return names.cleanupRoleName;
      throw new Error(`unexpected_cutover_role:${role}`);
    };
    for (const { relationName, grants } of migrationRunner.cutover075RelationSecurityCatalog) {
      await client.query(`revoke all on table public."${relationName}" from public`);
      for (const role of [names.applicationRoleName, names.operatorRoleName, names.cleanupRoleName]) {
        await client.query(`revoke all on table public."${relationName}" from "${role}"`);
      }
      for (const grant of grants) {
        await client.query(
          `grant ${grant.privileges.map((privilege) => privilege.toLowerCase()).join(",")}
             on table public."${relationName}" to "${roleName(grant.role)}"`,
        );
      }
    }
    for (const { identity, execute } of migrationRunner.cutover075SecurityFunctions) {
      await client.query(`revoke all on function ${identity} from public`);
      for (const role of [names.applicationRoleName, names.operatorRoleName, names.cleanupRoleName]) {
        await client.query(`revoke all on function ${identity} from "${role}"`);
      }
      for (const role of execute) {
        await client.query(`grant execute on function ${identity} to "${roleName(role)}"`);
      }
    }
    await client.query(
      `grant select on table public.ai_content_maintenance_state to "${names.applicationRoleName}"`,
    );
    await client.query(
      `grant insert,select on table public.ai_content_usage_ledger to "${names.applicationRoleName}"`,
    );
    await client.query(await readFile(
      resolve(directory, "084_ai_content_usage_reversal_identity_invoker.sql"),
      "utf8",
    ));
    await client.query("revoke all on function public.assert_ai_content_writable() from public");
    await client.query(
      `grant execute on function public.assert_ai_content_writable() to "${names.applicationRoleName}"`,
    );
    await client.query("select public.verify_ai_content_075_acl_final_catalog()");
    if (!migration075Checksum) throw new Error("cutover_075_checksum_missing");
    await client.query("reset role");
    schemaOwnerActive = false;
    await client.query(`alter function public.lock_ai_content_fixed_input_sources(
      uuid,uuid,uuid,uuid,uuid,uuid[],uuid[]
    ) owner to postgres`);
    await client.query(`revoke all on function public.lock_ai_content_fixed_input_sources(
      uuid,uuid,uuid,uuid,uuid,uuid[],uuid[]
    ) from public`);
    await client.query(`grant execute on function public.lock_ai_content_fixed_input_sources(
      uuid,uuid,uuid,uuid,uuid,uuid[],uuid[]
    ) to content_application`);
    await client.query(`create table if not exists public.schema_migrations(
      id text primary key,checksum text not null,applied_at timestamptz not null default now()
    )`);
    await client.query(
      "insert into public.schema_migrations(id,checksum) values($1,$2) on conflict(id) do update set checksum=excluded.checksum",
      ["075_ai_content_three_format_cutover.sql", migration075Checksum],
    );
    await client.query("alter table public.ai_content_bootstrap_state owner to postgres");
    await client.query(`revoke all on table public.ai_content_bootstrap_state
      from public,content_schema_owner,content_application,content_operator,content_migration,content_cleanup`);
    await client.query("grant select on table public.ai_content_bootstrap_state to content_migration,content_schema_owner");
    await client.query("alter table public.ai_content_cutovers owner to postgres");
    await client.query(`revoke all on table public.ai_content_cutovers
      from public,content_schema_owner,content_application,content_operator,content_migration,content_cleanup`);
    await client.query("grant references on table public.ai_content_cutovers to content_schema_owner");
    return plan;
  } finally {
    if (schemaOwnerActive) await client.query("reset role").catch(() => undefined);
    client.release();
  }
}

function poolWithinExistingTransaction(client: Pick<PoolClient, "query">) {
  const transactionClient = {
    query: (sql: string, params?: unknown[]) => {
      if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") {
        return Promise.resolve({ rows: [], rowCount: 0 });
      }
      return client.query(sql, params);
    },
    release: () => undefined,
  };
  return {
    connect: async () => transactionClient,
    query: transactionClient.query,
  };
}

async function waitForBlockedBackends(
  pool: Pool,
  blockerPid: number,
  minimum: number,
  timeoutMs = 5_000,
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const blocked = await pool.query(
      `select count(*)::integer as count
         from pg_stat_activity
        where datname=current_database() and pid<>$1
          and $1=any(pg_blocking_pids(pid))`,
      [blockerPid],
    );
    if (Number(blocked.rows[0]?.count ?? 0) >= minimum) return true;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return false;
}

function request(
  ids: FixtureIds,
  outputCount: 1 = 1,
  outputFormat: "reel" | "card_news" = "reel",
): ContentOrchestrationV2 {
  return {
    contractVersion: "content-orchestration.v2",
    brandId: ids.brand,
    purpose: "informational",
    seed: { kind: "topic_text", title: "V3 동시성" },
    contentInstruction: null,
    productId: null,
    outputSettings: {
      outputFormat,
      channelTargets: ["instagram"],
      aspectRatio: outputFormat === "reel" ? "9:16" : "1:1",
      outputCount,
    },
  };
}

function baseInput(
  ids: FixtureIds,
  outputCount: 1 = 1,
  outputFormat: "reel" | "card_news" = "reel",
) {
  return {
    contractVersion: "proposal-base-input.v2" as const,
    brandCore: {
      versionId: ids.core,
      companyOverview: "동시성 검증 브랜드",
      businessDescription: "V3 생성 경로 검증",
      primaryCategory: "software",
      detailedCategory: "testing",
      primaryTarget: "operators",
      differentiator: "deterministic",
      coreAppeal: "safe concurrency",
    },
    subject: { kind: "topic_text" as const, title: "V3 동시성" },
    contentInstruction: null,
    product: null,
    references: [],
    outputSettings: {
      outputFormat,
      channelTargets: ["instagram" as const],
      aspectRatio: outputFormat === "reel" ? "9:16" as const : "1:1" as const,
      outputCount,
      purpose: "informational" as const,
    },
    capturedAt: "2026-08-06T00:00:00.000Z",
  };
}

function researchEvidence(ids: FixtureIds) {
  const observed = {
    title: "검증 자료",
    url: "https://source.example/concurrency",
    publisher: "Source",
    publishedAt: null,
    claimSummary: "동시성 검증 근거",
  };
  return {
    contractVersion: "research-evidence.v1" as const,
    decision: "searched" as const,
    reason: "검증 근거 필요",
    queries: ["V3 concurrency"],
    capturedAt: "2026-08-06T01:00:00.000Z",
    items: [{
      id: ids.evidence,
      ...observed,
      capturedAt: "2026-08-06T01:00:00.000Z",
      contentHash: createHash("sha256").update(JSON.stringify(observed)).digest("hex"),
    }],
  };
}

function proposal(
  ids: FixtureIds,
  index: number,
  outputFormat: "reel" | "card_news" = "reel",
) {
  return {
    conceptKey: `v3-concurrency-${index}`,
    title: `V3 동시성 ${index}`,
    informationalType: "how_to",
    oneLineIntent: `동시성 의도 ${index}`,
    differentiator: `잠금 순서 ${index}`,
    differentiationAxes: ["narrative"],
    target: "operators",
    customerContext: "concurrent generation",
    keyMessage: `상위 행부터 잠금 ${index}`,
    hook: `교착 방지 ${index}`,
    selectionReason: `운영 안전 ${index}`,
    evidenceIds: [ids.evidence],
    referenceIds: [],
    outputFormat,
    channelTargets: ["instagram"],
    assetCount: 1,
    outline: [{ index: 1, role: "scene", headline: `안전한 잠금 ${index}`, purpose: "설명" }],
    purposeDetails: {
      kind: "informational",
      question: "동시 실행을 어떻게 안전하게 처리하나요?",
      value: "신뢰 가능한 실행",
      whyNow: "운영 배포 전",
      learningPoints: ["상위 행부터 잠근다"],
    },
  };
}

const rules = {
  contractVersion: "brand-rules.v1" as const,
  requiredPhrases: [],
  forbiddenPhrases: [],
  exaggerationRules: [],
  ctaRules: { defaultCta: "확인", allowed: ["확인"] },
  channelRules: { instagram: [] },
  designRules: { colors: [], fonts: [], notes: [], referenceImages: [] },
  autoApprovalRules: { enabled: false, conditions: [] },
};

function reelPlan(generationId: string) {
  return {
    contractVersion: "reel-plan.v2" as const,
    outputFormat: "reel" as const,
    content: { caption: "V3 concurrency", hashtags: ["V3"], cta: "확인" },
    imagePackage: {
      contractVersion: "image-generation-package.v1" as const,
      generationId,
      outputFormat: "reel" as const,
      purpose: "informational" as const,
      assetCount: 1,
      aspectRatio: "9:16" as const,
      channelTargets: ["instagram" as const],
      assets: [{
        index: 1,
        role: "scene",
        copy: "V3",
        visualDirection: "Vertical scene",
        evidenceIds: [],
        productImageAssetIds: [],
        attachmentIds: [],
      }],
      product: null,
      references: [],
      brandStyleImages: [],
      avatarStyleImageId: null,
      attachments: [],
      userImageInstruction: null,
      logoPolicy: {
        allowGeneratedLogo: false as const,
        allowReservedLogoArea: false as const,
        allowExternalReferenceLogo: false as const,
        allowExistingProductPackagingLogo: true as const,
      },
    },
  };
}

function renderedAsset(fixture: StartedFixture, outputId: string) {
  const storagePath = `ai-content/${fixture.brand}/${fixture.generationId}/${outputId}/assets/01.png`;
  return {
    index: 1,
    url: `https://assets.public.blob.vercel-storage.com/${storagePath}`,
    storagePath,
    mimeType: "image/png" as const,
    width: 1080,
    height: 1920,
    checksum: "a".repeat(64),
  };
}

function reelManifest(fixture: StartedFixture, outputId: string, asset: ReturnType<typeof renderedAsset>) {
  const prefix = `https://assets.public.blob.vercel-storage.com/ai-content/${fixture.brand}/${fixture.generationId}/${outputId}`;
  return {
    manifestUrl: `${prefix}/manifest.json`,
    manifest: {
      version: "ai-content.v3" as const,
      purpose: "informational" as const,
      outputFormat: "reel" as const,
      title: "V3 concurrency",
      assets: [
        {
          role: "scene" as const,
          index: 1,
          url: asset.url,
          fileName: "scene-01.png",
          mimeType: "image/png" as const,
          width: 1080,
          height: 1920,
        },
        {
          role: "video" as const,
          index: 1,
          url: `${prefix}/reel.mp4`,
          fileName: "reel.mp4",
          mimeType: "video/mp4" as const,
          width: 1080,
          height: 1920,
          durationSeconds: 4,
          videoCodec: "h264" as const,
          fps: 30 as const,
          audioCodec: null,
        },
      ],
      content: reelPlan(fixture.generationId).content,
    },
  };
}

describe.skipIf(process.env.RUN_POSTGRES_INTEGRATION !== "true")(
  "AI content V3 concurrency on PostgreSQL 16 final migrations",
  () => {
    let container: StartedPostgreSqlContainer | null = null;
    let pool: Pool;
    let applicationPool: Pool;
    let brandIntelligenceApplicationPool: Pool;
    let legacyMainPool: Pool;
    let catalog: VerifiedGeneratedContentCatalog;

    beforeAll(async () => {
      container = await new PostgreSqlContainer("postgres:16-alpine")
        .withDatabase("brand_pilot_v3_concurrency")
        .withUsername("brand_pilot")
        .withPassword("brand_pilot")
        .start();
      pool = new Pool({
        connectionString: container.getConnectionUri(),
        max: 10,
        application_name: "ai-content-v3-concurrency",
      });
      await pool.query("create extension if not exists pgcrypto");
      const plan = await applyMigrationsThrough075(pool);
      await pool.query(`
        create role brand_intelligence_application login inherit nosuperuser nobypassrls
          nocreatedb nocreaterole noreplication password '${brandIntelligenceApplicationPassword}'
      `);
      await pool.query("grant usage on schema public to brand_intelligence_application");
      await pool.query(
        "grant select,update on table public.brand_analysis_runs to brand_intelligence_application",
      );
      await pool.query(
        "grant select,update,delete on table public.brand_analysis_uploads to brand_intelligence_application",
      );
      await pool.query(
        "grant select,update on table public.brand_analysis_upload_attempts to brand_intelligence_application",
      );
      applicationPool = new Pool({
        connectionString: connectionStringForRole(
          container.getConnectionUri(),
          plan.roleNames.applicationRoleName,
          applicationPassword,
        ),
        max: 10,
        application_name: "ai-content-v3-restricted-application",
      });
      brandIntelligenceApplicationPool = new Pool({
        connectionString: connectionStringForRole(
          container.getConnectionUri(),
          "brand_intelligence_application",
          brandIntelligenceApplicationPassword,
        ),
        max: 4,
        application_name: "brand-intelligence-restricted-application",
      });
      legacyMainPool = new Pool({
        connectionString: connectionStringForRole(
          container.getConnectionUri(),
          "legacy_main",
          legacyMainPassword,
        ),
        max: 2,
        application_name: "legacy-main-content-denial",
      });
      catalog = JSON.parse(await readFile(
        resolve(process.cwd(), "../../packages/brand-pilot-content-contracts/generated/content-catalog.json"),
        "utf8",
      )) as VerifiedGeneratedContentCatalog;
    }, 180_000);

    afterEach(async () => {
      await pool.query("truncate table workspaces, app_users cascade");
    }, 30_000);

    afterAll(async () => {
      await applicationPool?.end();
      await brandIntelligenceApplicationPool?.end();
      await legacyMainPool?.end();
      await pool?.end();
      await container?.stop();
    }, 120_000);

    it("runs onboarding selection, linking, and cancellation as the minimum brand-intelligence role", async () => {
      const ids: FixtureIds = {
        actor: randomUUID(),
        workspace: randomUUID(),
        brand: randomUUID(),
        core: randomUUID(),
        rules: randomUUID(),
        evidence: randomUUID(),
      };
      await pool.query("insert into app_users(id,email) values($1,$2)", [ids.actor, `${ids.actor}@example.test`]);
      await pool.query(
        "insert into workspaces(id,name,slug,created_by_user_id) values($1,'Onboarding role',$2,$3)",
        [ids.workspace, `onboarding-role-${ids.workspace}`, ids.actor],
      );
      await pool.query(
        "insert into workspace_members(workspace_id,user_id,role,status) values($1,$2,'owner','active')",
        [ids.workspace, ids.actor],
      );
      await pool.query(
        "insert into brands(id,workspace_id,name,created_by_user_id) values($1,$2,'Onboarding role brand',$3)",
        [ids.brand, ids.workspace, ids.actor],
      );
      const adminRepository = createBrandIntelligenceRepository(pool);
      const requested = await adminRepository.requestBrandAnalysis({
        workspaceId: ids.workspace,
        brandId: ids.brand,
        companyName: "카드뉴스 병렬 생성 회사",
        ownedUrl: "https://example.com",
        uploadIds: [],
        idempotencyKey: `onboarding-role-${ids.brand}`,
      });
      const requestFingerprint = "c".repeat(64);
      const snapshot = {
        categoryCode: "marketing",
        subcategoryCodes: ["content_marketing"],
        suggestion: {
          id: ids.rules,
          subcategoryCode: "content_marketing",
          subcategoryName: "콘텐츠 마케팅",
          intent: "trend" as const,
          title: "분석 취소 후에도 완성할 콘텐츠",
          whyNow: "온보딩과 카드뉴스는 병렬로 실행됩니다.",
          contentBrief: "분석과 독립적으로 카드뉴스를 생성합니다.",
          sources: [{
            url: "https://source.example/article",
            title: "자료",
            publisher: "Source",
            publishedAt: null,
          }],
        },
        contentInstruction: null,
        requestFingerprint,
        proposalBatchId: null,
        generationId: null,
        requestedAt: "2026-08-14T00:00:00.000Z",
        proposalBaseInput: null,
        proposalAuthority: null,
      };
      const repository = createBrandIntelligenceRepository(brandIntelligenceApplicationPool);
      expect((await brandIntelligenceApplicationPool.query(
        "select session_user,current_user",
      )).rows[0]).toEqual({
        session_user: "brand_intelligence_application",
        current_user: "brand_intelligence_application",
      });
      await expect(repository.saveOnboardingContentSelection({
        workspaceId: ids.workspace,
        brandId: ids.brand,
        analysisId: requested.id,
        snapshot,
      })).resolves.toEqual(snapshot);
      const proposalBatchId = randomUUID();
      await expect(repository.linkOnboardingProposalBatch({
        workspaceId: ids.workspace,
        brandId: ids.brand,
        analysisId: requested.id,
        requestFingerprint,
        proposalBatchId,
      })).resolves.toMatchObject({ proposalBatchId });
      const generationId = randomUUID();
      await expect(repository.linkOnboardingGeneration({
        workspaceId: ids.workspace,
        brandId: ids.brand,
        analysisId: requested.id,
        requestFingerprint,
        generationId,
      })).resolves.toMatchObject({ generationId });
      await expect(repository.cancelBrandAnalysis({
        workspaceId: ids.workspace,
        brandId: ids.brand,
        analysisId: requested.id,
      })).resolves.toMatchObject({ status: "cancelled" });

      const stored = await pool.query(
        `select input_json,evidence_json,result_json,edited_result_json,
                has_table_privilege('content_application','public.brand_analysis_runs','SELECT')
                  as content_application_can_select_brand_analysis
           from brand_analysis_runs
          where id=$1`,
        [requested.id],
      );
      expect(stored.rows[0]).toMatchObject({
        input_json: {
          onboardingContent: {
            requestFingerprint,
            proposalBatchId,
            generationId,
          },
        },
        evidence_json: [],
        result_json: null,
        edited_result_json: null,
        content_application_can_select_brand_analysis: false,
      });
      expect(Object.keys(stored.rows[0]!.input_json)).toEqual(["onboardingContent"]);
    }, 30_000);

    async function createDraft(
      outputCount: 1 = 1,
      source: "performance" | "manual" | "onboarding" = "performance",
    ): Promise<DraftFixture> {
      const ids: FixtureIds = {
        actor: randomUUID(),
        workspace: randomUUID(),
        brand: randomUUID(),
        core: randomUUID(),
        rules: randomUUID(),
        evidence: randomUUID(),
      };
      await pool.query("insert into app_users(id,email) values($1,$2)", [ids.actor, `${ids.actor}@example.test`]);
      await pool.query(
        "insert into workspaces(id,name,slug,created_by_user_id) values($1,'V3 concurrency',$2,$3)",
        [ids.workspace, `v3-concurrency-${ids.workspace}`, ids.actor],
      );
      await pool.query(
        "insert into workspace_members(workspace_id,user_id,role,status) values($1,$2,'owner','active')",
        [ids.workspace, ids.actor],
      );
      await pool.query(
        "insert into brands(id,workspace_id,name,created_by_user_id) values($1,$2,'V3 concurrency brand',$3)",
        [ids.brand, ids.workspace, ids.actor],
      );
      if (source === "onboarding") {
        const analysis = await createBrandIntelligenceRepository(pool).requestBrandAnalysis({
          workspaceId: ids.workspace,
          brandId: ids.brand,
          companyName: "온보딩 카드뉴스 브랜드",
          ownedUrl: "https://brand.example/",
          uploadIds: [],
          idempotencyKey: `onboarding-analysis-${ids.brand}`,
        });
        ids.core = analysis.id;
      }
      const outputFormat = source === "onboarding" ? "card_news" : "reel";
      const frozenBaseInput = baseInput(ids, outputCount, outputFormat);
      if (source !== "onboarding") await pool.query(
        `insert into brand_core_versions(
           id,workspace_id,brand_id,version,status,core_json,created_by,
           created_by_user_id,approved_by_user_id,approved_at
         ) values($1,$2,$3,1,'approved',$4::jsonb,'user',$5,$5,now())`,
        [ids.core, ids.workspace, ids.brand, JSON.stringify(frozenBaseInput.brandCore), ids.actor],
      );
      if (source !== "onboarding") await pool.query(
        `insert into brand_rule_sets(
           id,workspace_id,brand_id,version,status,rules_json,created_by,
           created_by_user_id,approved_by_user_id,approved_at
         ) values($1,$2,$3,1,'approved',$4::jsonb,'user',$5,$5,now())`,
        [ids.rules, ids.workspace, ids.brand, JSON.stringify(rules), ids.actor],
      );
      if (source !== "onboarding") await pool.query(
        `insert into brand_profiles(workspace_id,brand_id,active_brand_core_id,active_brand_rule_set_id)
         values($1,$2,$3,$4)`,
        [ids.workspace, ids.brand, ids.core, ids.rules],
      );

      const proposalRepository = createAiContentProposalV2Repository(applicationPool);
      const evidence = researchEvidence(ids);
      const { contractVersion: _baseContractVersion, ...baseFields } = frozenBaseInput;
      const experimentId = randomUUID();
      const evidenceVersion = "b".repeat(64);
      const onboardingAuthority = source === "onboarding" ? {
        kind: "onboarding_provisional" as const,
        analysisId: ids.core,
        ownedUrl: "https://brand.example/",
        categoryCode: "marketing",
        subcategoryCodes: ["content_marketing"],
        suggestionId: ids.rules,
        sourceUrls: ["https://source.example/concurrency"],
        brandRules: {
          versionId: ids.rules,
          version: 1 as const,
          content: rules,
          contentSha256: proposalSha256(rules),
        },
      } : null;
      const proposalService = createAiContentProposalV2Service({
        ...proposalRepository,
        assertReady: async () => undefined,
        resolve: async () => ({
          request: request(ids, outputCount, outputFormat),
          baseInput: frozenBaseInput,
          sourceSnapshots: [],
          ...(source === "manual" ? {
            researchSourceAcquisition: {
              contractVersion: "research-source-acquisition.v1" as const,
              status: "not_applicable" as const,
              requestedUrl: null,
              canonicalUrl: null,
              contentHash: null,
              capturedAt: frozenBaseInput.capturedAt,
            },
          } : {}),
          performanceAudit: source === "performance" ? {
            experimentId,
            evidenceVersion,
            experimentDefinition: { version: "reuse-performing-pattern.v2" },
            resolvedInputFingerprint: "c".repeat(64),
            snapshotAudit: {
              policyVersion: "performance-evidence.v2",
              snapshots: [{ id: randomUUID() }],
            },
            capturedFrom: "2026-08-06T00:00:00.000Z",
            capturedTo: "2026-08-06T01:00:00.000Z",
            researchEvidence: evidence,
            composedInput: parseProposalInputSnapshotV2({
              ...baseFields,
              contractVersion: "proposal-input.v2",
              researchEvidence: evidence,
            }),
          } : null,
        }),
      });
      const created = source === "performance"
        ? await proposalService.create({
          source: "performance_experiment",
          workspaceId: ids.workspace,
          brandId: ids.brand,
          actorUserId: ids.actor,
          experimentId,
          evidenceVersion,
        })
        : source === "manual" ? await proposalService.create({
          source: "manual",
          workspaceId: ids.workspace,
          brandId: ids.brand,
          actorUserId: ids.actor,
          idempotencyKey: `v3-concurrency-${ids.brand}`,
          request: request(ids, outputCount, outputFormat),
        }) : await proposalService.create({
          source: "onboarding",
          workspaceId: ids.workspace,
          brandId: ids.brand,
          actorUserId: ids.actor,
          idempotencyKey: `onboarding-${ids.brand}`,
          request: request(ids, outputCount, outputFormat),
          baseInput: frozenBaseInput,
          authority: onboardingAuthority!,
        });
      const jobs = createContentProposalJobsRepository(applicationPool);
      if (source === "manual" || source === "onboarding") {
        const research = await jobs.claimContentProposalJob({
          workerId: "v3-research",
          leaseSeconds: 180,
        }) as ContentProposalResearchClaim;
        expect(research).toMatchObject({
          batchId: created.proposalBatchId,
          stage: "research_required",
          workerId: "v3-research",
        });
        await jobs.completeContentProposalResearch({
          jobId: research.id,
          workerId: research.workerId,
          leaseToken: research.leaseToken,
          researchAttemptId: research.researchAttemptId,
          evidence,
        });
        const researchEvents = await pool.query(
          `select count(*)::integer total,
                  count(*) filter(where event_type='research_started')::integer started,
                  count(*) filter(where event_type='evidence_committed')::integer evidence_committed,
                  count(*) filter(where event_type='attempt_succeeded')::integer succeeded
             from ai_content_proposal_research_attempt_events
            where research_attempt_id=$1`,
          [research.researchAttemptId],
        );
        expect(researchEvents.rows[0]).toEqual({
          total: 3,
          started: 1,
          evidence_committed: 1,
          succeeded: 1,
        });
      }
      const model = await jobs.claimContentProposalJob({
        workerId: "v3-model",
        leaseSeconds: 180,
      }) as ContentProposalModelClaim;
      expect(model).toMatchObject({
        batchId: created.proposalBatchId,
        stage: "composition_ready",
        workerId: "v3-model",
      });
      await jobs.startContentProposalInvocation({
        jobId: model.id,
        workerId: model.workerId,
        leaseToken: model.leaseToken,
        modelAttemptId: model.modelAttemptId,
        invocationOrdinal: 1,
      });
      await jobs.completeContentProposalJob({
        jobId: model.id,
        workerId: model.workerId,
        leaseToken: model.leaseToken,
        modelAttemptId: model.modelAttemptId,
        invocationOrdinal: 1,
        transcriptSha256: "1".repeat(64),
        outputSha256: "2".repeat(64),
        parserSha256: "3".repeat(64),
        proposalSet: {
          contractVersion: "content-proposal.v2",
          proposals: [
            proposal(ids, 1, outputFormat),
            proposal(ids, 2, outputFormat),
            proposal(ids, 3, outputFormat),
          ],
        },
      });
      const proposalRow = await pool.query(
        "select id from ai_content_proposals where batch_id=$1 and position=1",
        [created.proposalBatchId],
      );
      const proposalId = String(proposalRow.rows[0]?.id);
      const selectIdempotencyKey = `select-${ids.brand}`;
      const selected = await createAiContentRepository(applicationPool).selectAiContentProposal({
        workspaceId: ids.workspace,
        brandId: ids.brand,
        actorUserId: ids.actor,
        proposalId,
        idempotencyKey: selectIdempotencyKey,
      });
      if (source === "onboarding") {
        await createBrandIntelligenceRepository(pool).saveOnboardingContentSelection({
          workspaceId: ids.workspace,
          brandId: ids.brand,
          analysisId: ids.core,
          snapshot: {
            categoryCode: "marketing",
            subcategoryCodes: ["content_marketing"],
            suggestion: {
              id: ids.rules,
              subcategoryCode: "content_marketing",
              subcategoryName: "콘텐츠 마케팅",
              intent: "informational",
              title: "V3 동시성",
              whyNow: "온보딩 중 병렬 생성을 검증합니다.",
              contentBrief: "온보딩 카드뉴스 생성 경로를 검증합니다.",
              sources: [{
                url: "https://source.example/concurrency",
                title: "검증 자료",
                publisher: "Source",
                publishedAt: null,
              }],
            },
            contentInstruction: null,
            requestFingerprint: "d".repeat(64),
            proposalBatchId: created.proposalBatchId,
            generationId: selected.id,
            requestedAt: frozenBaseInput.capturedAt,
            proposalBaseInput: frozenBaseInput,
            proposalAuthority: onboardingAuthority!,
          },
        });
      }
      return {
        ...ids,
        batchId: created.proposalBatchId,
        proposalId,
        generationId: selected.id,
        selectIdempotencyKey,
      };
    }

    async function createStarted(outputCount: 1 = 1): Promise<StartedFixture> {
      const fixture = await createDraft(outputCount);
      const lineage = await pool.query(
        `select proposal.proposal_json,proposal.successful_model_attempt_id,
                proposal.successful_proposal_job_id,contract.id proposal_contract_id
           from ai_content_proposals proposal
           join ai_content_proposal_job_contracts contract
             on contract.job_id=proposal.successful_proposal_job_id
            and contract.workspace_id=proposal.workspace_id and contract.brand_id=proposal.brand_id
          where proposal.id=$1`,
        [fixture.proposalId],
      );
      const row = lineage.rows[0] as Record<string, unknown>;
      const generationInput = parseContentGenerationInputV3({
        contractVersion: "content-generation-input.v3",
        generationId: fixture.generationId,
        brandCore: baseInput(fixture, outputCount).brandCore,
        brandRules: {
          versionId: fixture.rules,
          version: 1,
          content: rules,
          contentSha256: proposalSha256(rules),
        },
        subject: { kind: "topic_text", title: "V3 동시성" },
        contentInstruction: null,
        product: null,
        researchEvidence: researchEvidence(fixture),
        references: {
          selected: [],
          brandStyleImages: [],
          avatarStyleImageId: null,
          attachments: [],
        },
        selectedProposal: { id: fixture.proposalId, ...(row.proposal_json as Record<string, unknown>) },
        userImageInstruction: null,
        outputSettings: {
          outputFormat: "reel",
          channelTargets: ["instagram"],
          aspectRatio: "9:16",
          outputCount,
          purpose: "informational",
        },
        capturedAt: "2026-08-06T02:00:00.000Z",
      });
      const binding = promptBindingFor("reel", "informational", catalog);
      const operationId = randomUUID();
      const reservationId = randomUUID();
      const outputIds: string[] = [];
      const jobIds: string[] = [];
      const client = await applicationPool.connect();
      try {
        await client.query("BEGIN");
        await client.query(
          `insert into ai_content_generation_operations(
             id,workspace_id,brand_id,operation_key,request_fingerprint_sha256,generation_id,status
           ) values($1,$2,$3,$4,$5,$6,'reserved')`,
          [operationId, fixture.workspace, fixture.brand, `direct-start-${fixture.brand}`,
            proposalSha256({ generationId: fixture.generationId, outputCount }), fixture.generationId],
        );
        await client.query(
          `insert into ai_content_usage_ledger(
             id,workspace_id,brand_id,generation_id,output_id,usage_type,quantity,usage_date,
             idempotency_key,operation_id,reservation_id,reversal_of_ledger_id
           ) values($1,$2,$3,$4,null,'generation',$5,'2026-08-06',$6,$7,$1,null)`,
          [reservationId, fixture.workspace, fixture.brand, fixture.generationId, outputCount,
            `generation-reservation:${operationId}`, operationId],
        );
        await client.query(
          `insert into ai_content_generation_input_snapshots(
             id,workspace_id,brand_id,generation_id,input_json,content_hash
           ) values($1,$2,$3,$4,$5::jsonb,$6)`,
          [randomUUID(), fixture.workspace, fixture.brand, fixture.generationId,
            JSON.stringify(generationInput), proposalSha256(generationInput)],
        );
        await client.query(
          "select create_ai_content_generation_prompt_binding($1,$2,$3,$4,$5,$6,$7,$8::jsonb)",
          [fixture.generationId, fixture.workspace, fixture.brand, fixture.proposalId,
            row.successful_proposal_job_id, row.proposal_contract_id,
            row.successful_model_attempt_id, JSON.stringify(binding)],
        );
        for (let index = 1; index <= outputCount; index += 1) {
          const outputId = randomUUID();
          const jobId = randomUUID();
          outputIds.push(outputId);
          jobIds.push(jobId);
          await client.query(
            `insert into ai_content_generation_outputs(
               id,generation_id,workspace_id,brand_id,output_index,status
             ) values($1,$2,$3,$4,$5,'queued')`,
            [outputId, fixture.generationId, fixture.workspace, fixture.brand, index],
          );
          await client.query(
            `insert into ai_content_output_research_snapshots(
               id,workspace_id,brand_id,generation_id,output_id,evidence_json
             ) values($1,$2,$3,$4,$5,$6::jsonb)`,
            [randomUUID(), fixture.workspace, fixture.brand, fixture.generationId,
              outputId, JSON.stringify(generationInput.researchEvidence)],
          );
          await client.query(
            `insert into ai_content_generation_jobs(
               id,generation_id,output_id,workspace_id,brand_id,job_type,output_format,status,payload_json
             ) values($1,$2,$3,$4,$5,'generate','reel','queued',$6::jsonb)`,
            [jobId, fixture.generationId, outputId, fixture.workspace, fixture.brand,
              JSON.stringify({
                generationId: fixture.generationId,
                outputId,
                contentGenerationInput: generationInput,
                planningMode: "selected_proposal",
                operationId,
                manualVisualSelection: {
                  contractVersion: "manual-visual-selection-frozen.v1",
                  product: null,
                  stylePreset: null,
                  avatar: null,
                },
              })],
          );
        }
        await client.query(
          `update ai_content_generations
              set status='queued',current_stage='generation',generation_idempotency_key=$4,
                  operation_id=$5,generation_input_snapshot=$6::jsonb,
                  attachments_locked_at=statement_timestamp(),updated_by_user_id=$7,updated_at=now()
            where id=$1 and workspace_id=$2 and brand_id=$3 and status='draft'`,
          [fixture.generationId, fixture.workspace, fixture.brand, `direct-start-${fixture.brand}`,
            operationId, JSON.stringify(generationInput), fixture.actor],
        );
        await client.query(
          "select transition_ai_content_generation_operation($1,'reserved','started')",
          [operationId],
        );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
      return { ...fixture, operationId, outputIds, jobIds };
    }

    it("starts an onboarding card-news draft through the content role without brand-analysis SELECT", async () => {
      const fixture = await createDraft(1, "onboarding");
      const provider = createBrandIntelligenceProvider(
        createBrandIntelligenceRepository(brandIntelligenceApplicationPool),
      );
      const repository = createAiContentRepository(applicationPool, {
        brandIntelligenceProvider: provider,
      });
      await expect(repository.startAiContentGenerationV3({
        workspaceId: fixture.workspace,
        brandId: fixture.brand,
        actorUserId: fixture.actor,
        generationId: fixture.generationId,
        contractVersion: "content-generation-start.v2",
        idempotencyKey: `onboarding-start-${fixture.brand}`,
        usageDate: "2026-08-06",
        dailyGenerationLimit: 10,
      }, {
        assertApprovedBrandRulesAvailable: async () => {
          throw new Error("approved_brand_rules_must_not_be_loaded");
        },
        loadApprovedCore: async () => {
          throw new Error("approved_brand_core_must_not_be_loaded");
        },
        loadApprovedProduct: async () => {
          throw new Error("unexpected_product_snapshot_load");
        },
        freezeReferences: async () => [],
        revalidateFrozenResources: async () => undefined,
        loadApprovedStyleImages: async () => [],
      })).resolves.toMatchObject({ id: fixture.generationId, status: "queued" });
      await expect(applicationPool.query(
        `update ai_content_usage_ledger
            set quantity=quantity
          where generation_id=$1`,
        [fixture.generationId],
      )).rejects.toMatchObject({ code: "42501" });

      const stored = await pool.query(
        `select batch.input_snapshot_json,generation.output_format,generation.status,
                has_table_privilege('content_application','public.brand_analysis_runs','SELECT')
                  as content_application_can_select_brand_analysis
           from ai_content_proposal_batches batch
           join ai_content_generations generation on generation.id=$2
          where batch.id=$1`,
        [fixture.batchId, fixture.generationId],
      );
      expect(Object.keys(stored.rows[0]!.input_snapshot_json).sort()).toEqual([
        "baseInput",
        "brandContextAuthority",
        "replayFingerprint",
        "researchSourceAcquisition",
        "resumeInput",
      ]);
      expect(stored.rows[0]).toMatchObject({
        output_format: "card_news",
        status: "queued",
        content_application_can_select_brand_analysis: false,
        input_snapshot_json: {
          brandContextAuthority: { kind: "onboarding_provisional", analysisId: fixture.core },
          researchSourceAcquisition: {
            contractVersion: "research-source-acquisition.v1",
            status: "not_applicable",
            requestedUrl: null,
            canonicalUrl: null,
            contentHash: null,
          },
        },
      });
    }, 30_000);

    it("lets selection replay finish while final V3 start waits on the shared batch lock", async () => {
      const fixture = await createDraft(1, "manual");
      const runtimeIdentity = await applicationPool.query("select session_user,current_user");
      expect(runtimeIdentity.rows[0]).toEqual({
        session_user: "content_application",
        current_user: "content_application",
      });
      await expect(legacyMainPool.query(
        "update ai_content_generations set updated_at=updated_at where id=$1",
        [fixture.generationId],
      )).rejects.toMatchObject({ code: "42501" });
      const legacyWorkerId = `acl-smoke-${fixture.brand}`;
      await legacyMainPool.query(
        "insert into worker_instances(worker_id,worker_type) values($1,'dm')",
        [legacyWorkerId],
      );
      await legacyMainPool.query(
        "update worker_instances set metadata=$2::jsonb where worker_id=$1",
        [legacyWorkerId, JSON.stringify({ verified: true })],
      );
      expect((await legacyMainPool.query(
        "select metadata from worker_instances where worker_id=$1",
        [legacyWorkerId],
      )).rows[0]?.metadata).toEqual({ verified: true });
      await legacyMainPool.query("delete from worker_instances where worker_id=$1", [legacyWorkerId]);
      await expect(legacyMainPool.query(
        "select transition_ai_content_generation_operation($1,'reserved','started')",
        [randomUUID()],
      )).rejects.toMatchObject({ code: "42501" });
      await expect(legacyMainPool.query(
        "select create_ai_content_generation_prompt_binding($1,$2,$3,$4,$5,$6,$7,$8::jsonb)",
        [randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID(), "{}"],
      )).rejects.toMatchObject({ code: "42501" });
      const gate = await applicationPool.connect();
      let gateOpen = false;
      let start: Promise<unknown> | null = null;
      try {
        await gate.query("BEGIN");
        gateOpen = true;
        await gate.query("select id from ai_content_proposal_batches where id=$1 for update", [fixture.batchId]);
        const blockerPid = Number((await gate.query("select pg_backend_pid() pid")).rows[0]?.pid);
        const repository = createAiContentRepository(applicationPool);
        start = repository.startAiContentGenerationV3({
          workspaceId: fixture.workspace,
          brandId: fixture.brand,
          actorUserId: fixture.actor,
          generationId: fixture.generationId,
          contractVersion: "content-generation-start.v2",
          idempotencyKey: `start-${fixture.brand}`,
          usageDate: "2026-08-06",
          dailyGenerationLimit: 10,
        }, {
          assertApprovedBrandRulesAvailable: async () => undefined,
          loadApprovedCore: async () => baseInput(fixture).brandCore,
          loadApprovedProduct: async () => {
            throw new Error("unexpected_product_snapshot_load");
          },
          freezeReferences: async () => [],
          revalidateFrozenResources: async () => undefined,
          loadApprovedStyleImages: async () => [],
        });
        expect(await waitForBlockedBackends(pool, blockerPid, 1)).toBe(true);

        const gateRepository = createAiContentRepository(poolWithinExistingTransaction(gate) as never);
        await expect(gateRepository.selectAiContentProposal({
          workspaceId: fixture.workspace,
          brandId: fixture.brand,
          actorUserId: fixture.actor,
          proposalId: fixture.proposalId,
          idempotencyKey: fixture.selectIdempotencyKey,
        })).resolves.toMatchObject({ id: fixture.generationId, status: "draft" });

        await gate.query("COMMIT");
        gateOpen = false;
        await expect(start).resolves.toMatchObject({ id: fixture.generationId, status: "queued" });
        const graph = await pool.query(
          `select generation.status,operation.status operation_status,
                  (select count(*)::integer from ai_content_generation_input_snapshots where generation_id=generation.id) snapshots,
                  (select count(*)::integer from ai_content_generation_prompt_bindings where generation_id=generation.id) bindings,
                  (select count(*)::integer from ai_content_generation_outputs where generation_id=generation.id) outputs,
                  (select count(*)::integer from ai_content_generation_jobs where generation_id=generation.id and job_type='generate') jobs
             from ai_content_generations generation
             join ai_content_generation_operations operation on operation.id=generation.operation_id
            where generation.id=$1`,
          [fixture.generationId],
        );
        expect(graph.rows[0]).toEqual({
          status: "queued",
          operation_status: "started",
          snapshots: 1,
          bindings: 1,
          outputs: 1,
          jobs: 1,
        });
      } finally {
        if (gateOpen) await gate.query("ROLLBACK").catch(() => undefined);
        gate.release();
        if (start) await start.catch(() => undefined);
      }
    }, 30_000);

    it("serializes a child-generation retry behind terminal planner failure", async () => {
      const fixture = await createStarted();
      const repository = createAiContentRepository(applicationPool);
      const claimed = await repository.claimAiContentJob({
        outputFormat: "reel",
        workerId: "terminal-worker",
        leaseSeconds: 180,
      });
      expect(claimed?.id).toBe(fixture.jobIds[0]);
      const gate = await applicationPool.connect();
      let gateOpen = false;
      let failure: Promise<unknown> | null = null;
      let retry: Promise<unknown> | null = null;
      try {
        await gate.query("BEGIN");
        gateOpen = true;
        await gate.query("select id from ai_content_generations where id=$1 for update", [fixture.generationId]);
        const blockerPid = Number((await gate.query("select pg_backend_pid() pid")).rows[0]?.pid);
        failure = repository.failAiContentJob({
          jobId: fixture.jobIds[0],
          workerId: "terminal-worker",
          leaseToken: claimed!.leaseToken!,
          errorCode: "planner_failed",
          errorMessage: "terminal planner failure",
          retryable: false,
        });
        expect(await waitForBlockedBackends(pool, blockerPid, 1)).toBe(true);
        const retryCommand = {
          workspaceId: fixture.workspace,
          brandId: fixture.brand,
          actorUserId: fixture.actor,
          outputId: fixture.outputIds[0],
          contractVersion: "content-generation-retry.v1",
          idempotencyKey: `retry-failure-${fixture.brand}`,
          reason: "planner terminal failure",
          usageDate: "2026-08-06",
          dailyGenerationLimit: 10,
        } as const;
        retry = repository.retryAiContentOutput(retryCommand);
        const retryOutcome = retry.then(
          (value) => ({ status: "fulfilled" as const, value }),
          (reason: unknown) => ({ status: "rejected" as const, reason }),
        );
        await gate.query("COMMIT");
        gateOpen = false;
        await failure;
        const raced = await retryOutcome;
        if (raced.status === "rejected") {
          expect(raced.reason).toMatchObject({ message: "ai_content_generation_retry_parent_invalid" });
          retry = repository.retryAiContentOutput(retryCommand);
        }
        const child = (raced.status === "fulfilled" ? raced.value : await retry) as { id: string; status: string };
        expect(child).toMatchObject({ status: "queued" });
        expect(child.id).not.toBe(fixture.generationId);
        const graph = await pool.query(
          `select parent.status parent_status,parent_operation.status parent_operation_status,
                  parent_output.status parent_output_status,parent_job.status parent_job_status,
                  child.parent_generation_id,child.status child_status,
                  child_operation.parent_operation_id,child_operation.status child_operation_status,
                  (select count(*)::integer from ai_content_generation_outputs where generation_id=child.id) child_outputs,
                  (select count(*)::integer from ai_content_generation_jobs where generation_id=child.id) child_jobs
             from ai_content_generations parent
             join ai_content_generation_operations parent_operation on parent_operation.id=parent.operation_id
             join ai_content_generation_outputs parent_output on parent_output.generation_id=parent.id
             join ai_content_generation_jobs parent_job on parent_job.generation_id=parent.id
             join ai_content_generations child on child.id=$2
             join ai_content_generation_operations child_operation on child_operation.id=child.operation_id
            where parent.id=$1`,
          [fixture.generationId, child.id],
        );
        expect(graph.rows[0]).toMatchObject({
          parent_status: "failed",
          parent_operation_status: "reversed",
          parent_output_status: "failed",
          parent_job_status: "failed",
          parent_generation_id: fixture.generationId,
          child_status: "queued",
          parent_operation_id: fixture.operationId,
          child_operation_status: "started",
          child_outputs: 1,
          child_jobs: 1,
        });
      } finally {
        if (gateOpen) await gate.query("ROLLBACK").catch(() => undefined);
        gate.release();
        if (failure) await failure.catch(() => undefined);
        if (retry) await retry.catch(() => undefined);
      }
    }, 30_000);

    it("serializes a child-generation retry behind final lease exhaustion", async () => {
      const fixture = await createStarted();
      const repository = createAiContentRepository(applicationPool);
      const claimed = await repository.claimAiContentJob({
        outputFormat: "reel",
        workerId: "expired-worker",
        leaseSeconds: 180,
      });
      expect(claimed?.id).toBe(fixture.jobIds[0]);
      await pool.query(
        `update ai_content_generation_jobs
            set attempt_count=max_attempts,lease_expires_at=clock_timestamp()-interval '1 second'
          where id=$1`,
        [fixture.jobIds[0]],
      );
      const gate = await applicationPool.connect();
      let gateOpen = false;
      let exhaustion: Promise<unknown> | null = null;
      let retry: Promise<unknown> | null = null;
      try {
        await gate.query("BEGIN");
        gateOpen = true;
        await gate.query("select id from ai_content_generations where id=$1 for update", [fixture.generationId]);
        const blockerPid = Number((await gate.query("select pg_backend_pid() pid")).rows[0]?.pid);
        exhaustion = repository.claimAiContentJob({
          outputFormat: "reel",
          workerId: "next-worker",
          leaseSeconds: 180,
        });
        expect(await waitForBlockedBackends(pool, blockerPid, 1)).toBe(true);
        const retryCommand = {
          workspaceId: fixture.workspace,
          brandId: fixture.brand,
          actorUserId: fixture.actor,
          outputId: fixture.outputIds[0],
          contractVersion: "content-generation-retry.v1",
          idempotencyKey: `retry-expiry-${fixture.brand}`,
          reason: "final lease exhaustion",
          usageDate: "2026-08-06",
          dailyGenerationLimit: 10,
        } as const;
        retry = repository.retryAiContentOutput(retryCommand);
        const retryOutcome = retry.then(
          (value) => ({ status: "fulfilled" as const, value }),
          (reason: unknown) => ({ status: "rejected" as const, reason }),
        );
        await gate.query("COMMIT");
        gateOpen = false;
        await exhaustion;
        const raced = await retryOutcome;
        if (raced.status === "rejected") {
          expect(raced.reason).toMatchObject({ message: "ai_content_generation_retry_parent_invalid" });
          retry = repository.retryAiContentOutput(retryCommand);
        }
        const child = (raced.status === "fulfilled" ? raced.value : await retry) as { id: string; status: string };
        expect(child).toMatchObject({ status: "queued" });
        expect(child.id).not.toBe(fixture.generationId);
        const graph = await pool.query(
          `select generation.status,operation.status operation_status,
                  output.status output_status,job.status job_status,job.error_code,
                  (select parent_generation_id from ai_content_generations where id=$2) child_parent
             from ai_content_generations generation
             join ai_content_generation_operations operation on operation.id=generation.operation_id
             join ai_content_generation_outputs output on output.generation_id=generation.id
             join ai_content_generation_jobs job on job.generation_id=generation.id
            where generation.id=$1`,
          [fixture.generationId, child.id],
        );
        expect(graph.rows[0]).toMatchObject({
          status: "failed",
          operation_status: "reversed",
          output_status: "failed",
          job_status: "failed",
          error_code: "ai_content_job_lease_exhausted",
          child_parent: fixture.generationId,
        });
      } finally {
        if (gateOpen) await gate.query("ROLLBACK").catch(() => undefined);
        gate.release();
        if (exhaustion) await exhaustion.catch(() => undefined);
        if (retry) await retry.catch(() => undefined);
      }
    }, 30_000);

    it("serializes concurrent replays of the single V3 output package completion", async () => {
      const fixture = await createStarted();
      const repository = createAiContentRepository(applicationPool);
      const plan = reelPlan(fixture.generationId);
      const finalizers: Array<{ id: string; workerId: string; leaseToken: string }> = [];
      for (const [position, outputId] of fixture.outputIds.entries()) {
        const asset = renderedAsset(fixture, outputId);
        await pool.query(
          "update ai_content_generation_outputs set status='generating',plan_json=$2::jsonb where id=$1",
          [outputId, JSON.stringify(plan)],
        );
        await pool.query(
          `insert into ai_content_generation_render_jobs(
             generation_id,output_id,workspace_id,brand_id,job_kind,asset_index,status,payload_json,
             result_json,attempt_count,completed_at
           ) values($1,$2,$3,$4,'image_asset',1,'succeeded',$5::jsonb,$6::jsonb,1,now())`,
          [fixture.generationId, outputId, fixture.workspace, fixture.brand,
            JSON.stringify({ imagePackage: plan.imagePackage }), JSON.stringify(asset)],
        );
        const workerId = `finalizer-${position + 1}`;
        const leaseToken = randomUUID();
        const finalizer = await pool.query(
          `insert into ai_content_generation_render_jobs(
             generation_id,output_id,workspace_id,brand_id,job_kind,asset_index,status,payload_json,
             attempt_count,worker_id,lease_token,lease_expires_at
           ) values($1,$2,$3,$4,'package_finalize',null,'processing',$5::jsonb,1,$6,$7,
                    clock_timestamp()+interval '3 minutes') returning id`,
          [fixture.generationId, outputId, fixture.workspace, fixture.brand,
            JSON.stringify({ contractVersion: "ai-content-render-job.v1", jobKind: "package_finalize",
              generationId: fixture.generationId, outputId }), workerId, leaseToken],
        );
        finalizers.push({ id: String(finalizer.rows[0]?.id), workerId, leaseToken });
      }
      await pool.query(
        "update ai_content_generations set status='generating',current_stage='generation' where id=$1",
        [fixture.generationId],
      );
      const gate = await applicationPool.connect();
      let gateOpen = false;
      let completions: Promise<unknown[]> | null = null;
      try {
        await gate.query("BEGIN");
        gateOpen = true;
        await gate.query("select id from ai_content_generations where id=$1 for update", [fixture.generationId]);
        const blockerPid = Number((await gate.query("select pg_backend_pid() pid")).rows[0]?.pid);
        completions = Promise.all([0, 1].map(() => {
          const finalizer = finalizers[0];
          const outputId = fixture.outputIds[0];
          const asset = renderedAsset(fixture, outputId);
          const artifact = reelManifest(fixture, outputId, asset);
          return repository.completeAiContentRenderPackage({
            jobId: finalizer.id,
            workerId: finalizer.workerId,
            leaseToken: finalizer.leaseToken,
            jobKind: "package_finalize",
            manifest: artifact.manifest,
            manifestUrl: artifact.manifestUrl,
          });
        }));
        expect(await waitForBlockedBackends(pool, blockerPid, 1)).toBe(true);
        await gate.query("COMMIT");
        gateOpen = false;
        await completions;
        const terminal = await pool.query(
          `select generation.status,generation.terminal_at,generation.retryable_until,
                  operation.status operation_status,
                  (select count(*)::integer from ai_content_generation_outputs
                    where generation_id=generation.id and status='completed') completed_outputs
             from ai_content_generations generation
             join ai_content_generation_operations operation on operation.id=generation.operation_id
            where generation.id=$1`,
          [fixture.generationId],
        );
        expect(terminal.rows[0]).toMatchObject({
          status: "completed",
          operation_status: "completed",
          completed_outputs: 1,
        });
        const terminalAt = new Date(terminal.rows[0]?.terminal_at).getTime();
        const retryableUntil = new Date(terminal.rows[0]?.retryable_until).getTime();
        expect(retryableUntil - terminalAt).toBe(15 * 24 * 60 * 60 * 1_000);
      } finally {
        if (gateOpen) await gate.query("ROLLBACK").catch(() => undefined);
        gate.release();
        if (completions) await completions.catch(() => undefined);
      }
    }, 30_000);

    it("anchors a planner heartbeat lease to the DB clock after a row-lock wait", async () => {
      const fixture = await createStarted();
      const repository = createAiContentRepository(applicationPool);
      const claimed = await repository.claimAiContentJob({
        outputFormat: "reel",
        workerId: "heartbeat-worker",
        leaseSeconds: 180,
      });
      expect(claimed?.id).toBe(fixture.jobIds[0]);
      const gate = await applicationPool.connect();
      let gateOpen = false;
      let heartbeat: Promise<boolean> | null = null;
      try {
        await gate.query("BEGIN");
        gateOpen = true;
        await gate.query("select id from ai_content_generation_jobs where id=$1 for update", [fixture.jobIds[0]]);
        const blockerPid = Number((await gate.query("select pg_backend_pid() pid")).rows[0]?.pid);
        heartbeat = repository.heartbeatAiContentJob({
          jobId: fixture.jobIds[0],
          workerId: "heartbeat-worker",
          leaseToken: claimed!.leaseToken!,
          leaseSeconds: 7,
        });
        expect(await waitForBlockedBackends(pool, blockerPid, 1)).toBe(true);
        const releaseClock = await gate.query("select clock_timestamp() at");
        const releasedAt = new Date(releaseClock.rows[0]?.at).getTime();
        await gate.query("COMMIT");
        gateOpen = false;
        await expect(heartbeat).resolves.toBe(true);
        const updated = await pool.query(
          `select last_heartbeat_at,lease_expires_at,clock_timestamp() observed_at
             from ai_content_generation_jobs where id=$1`,
          [fixture.jobIds[0]],
        );
        const lastHeartbeatAt = new Date(updated.rows[0]?.last_heartbeat_at).getTime();
        const leaseExpiresAt = new Date(updated.rows[0]?.lease_expires_at).getTime();
        const observedAt = new Date(updated.rows[0]?.observed_at).getTime();
        expect(lastHeartbeatAt).toBeGreaterThanOrEqual(releasedAt);
        expect(leaseExpiresAt - lastHeartbeatAt).toBe(7_000);
        expect(leaseExpiresAt).toBeGreaterThan(observedAt);
      } finally {
        if (gateOpen) await gate.query("ROLLBACK").catch(() => undefined);
        gate.release();
        if (heartbeat) await heartbeat.catch(() => undefined);
      }
    }, 30_000);
  },
);
