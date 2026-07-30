import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAssetLibraryRepository } from "./assetLibraryRepository.js";
import { createInstagramTrendRepository } from "./instagramTrendRepository.js";
import { createProductLibraryRepository } from "./productLibraryRepository.js";
import { createRepository } from "./repository.js";

type QueryResult = { rowCount: number; rows: Record<string, unknown>[] };

function pglitePool(database: PGlite): Pool {
  async function query(sql: string, values: unknown[] = []): Promise<QueryResult> {
    const result = await database.query(sql, values as never[]);
    return {
      rowCount: result.rows.length || Number(result.affectedRows ?? 0),
      rows: result.rows as Record<string, unknown>[],
    };
  }
  return {
    query,
    async connect() {
      return { query, release() {} };
    },
  } as unknown as Pool;
}

const workspaceId = "71000000-0000-4000-8000-000000000001";
const primaryBrandId = "72000000-0000-4000-8000-000000000002";
const otherBrandId = "73000000-0000-4000-8000-000000000003";
const ownerId = "74000000-0000-4000-8000-000000000004";
const memberId = "75000000-0000-4000-8000-000000000005";
const analysisId = "76000000-0000-4000-8000-000000000006";
const brandCoreId = "76500000-0000-4000-8000-000000000006";
const hashtagId = "77000000-0000-4000-8000-000000000007";
const mediaId = "78000000-0000-4000-8000-000000000008";
const avatarId = "79000000-0000-4000-8000-000000000009";
const wikiIssueId = "7a000000-0000-4000-8000-00000000000a";

let database: PGlite;
let pool: Pool;

beforeAll(async () => {
  database = await PGlite.create({ extensions: { pgcrypto } });
  const migrations = resolve(process.cwd(), "../../db/migrations");
  for (const file of (await readdir(migrations)).filter((name) => name.endsWith(".sql")).sort()) {
    const sql = await readFile(resolve(migrations, file), "utf8");
    if (sql.startsWith("-- requires: pgvector") || file === "027_wiki_search_v2.sql") continue;
    await database.exec(sql);
  }
  pool = pglitePool(database);
  await database.exec(`
    insert into app_users(id,email) values
      ('${ownerId}','libraries-owner@example.com'),
      ('${memberId}','libraries-member@example.com');
    insert into workspaces(id,name,slug,created_by_user_id)
    values ('${workspaceId}','Library Trust','library-trust','${ownerId}');
    insert into workspace_members(workspace_id,user_id,role,status) values
      ('${workspaceId}','${ownerId}','owner','active'),
      ('${workspaceId}','${memberId}','member','active');
    insert into brands(id,workspace_id,name,created_by_user_id) values
      ('${primaryBrandId}','${workspaceId}','Primary Library Brand','${ownerId}'),
      ('${otherBrandId}','${workspaceId}','Other Library Brand','${ownerId}');
    insert into brand_profiles(workspace_id,brand_id) values
      ('${workspaceId}','${primaryBrandId}');
    insert into brand_core_versions(
      id,workspace_id,brand_id,version,status,core_json,evidence_json,
      review_state_json,created_by,approved_at
    ) values (
      '${brandCoreId}','${workspaceId}','${primaryBrandId}',1,'approved',
      '{"contractVersion":1,"summary":{"oneLine":"Primary Library Brand","description":"승인된 브랜드 안내"}}',
      '[]','{}','migration',now()
    );
    update brand_profiles set active_brand_core_id='${brandCoreId}'
      where workspace_id='${workspaceId}' and brand_id='${primaryBrandId}';
    insert into ai_content_subject_analyses(
      id,workspace_id,brand_id,subject_type,source_url,normalized_url,status,
      facts_json,structured_data_json,targets_json,appeals_json,idempotency_key
    ) values (
      '${analysisId}','${workspaceId}','${primaryBrandId}','service',
      'https://owned.example/service','https://owned.example/service','ready',
      '[{"claim":"승인된 운영 자동화","sourceUrl":"https://owned.example/service"}]',
      '{"name":"모종 운영 서비스","description":"검증된 자사 운영 서비스","features":["예약 발행"],"benefits":["운영 시간 절감"]}',
      '[{"id":"operator","name":"운영자"}]',
      '{"operator":[{"id":"time","text":"운영 시간 절감"}]}',
      'library-trust-analysis'
    );
    insert into instagram_trend_hashtags(id,normalized_tag,display_tag,last_refreshed_at)
    values ('${hashtagId}','브랜드','브랜드',now());
    insert into instagram_trend_media(
      id,instagram_media_id,username,caption,media_type,media_url,permalink,posted_at,last_fetched_at
    ) values (
      '${mediaId}','ig-library-trust','real_creator',
      '외부 영감 콘텐츠 #브랜드','IMAGE','https://cdn.example.com/trend.webp',
      'https://www.instagram.com/p/library-trust/',now(),now()
    );
    insert into instagram_trend_hashtag_media(hashtag_id,media_id,meta_rank,first_seen_at,last_seen_at)
    values ('${hashtagId}','${mediaId}',1,now(),now());
    insert into brand_trend_searches(workspace_id,brand_id,hashtag_id,last_searched_at)
    values ('${workspaceId}','${primaryBrandId}','${hashtagId}',now());
  `);
}, 60_000);

afterAll(async () => {
  await database?.close();
});

describe("library reuse and trust boundaries", () => {
  it("promotes owned analysis facts to an approved canonical product selectable by content", async () => {
    const products = createProductLibraryRepository(pool);
    const draft = await products.createProductServiceFromAnalysis({
      workspaceId,
      brandId: primaryBrandId,
      actorUserId: memberId,
      analysisId,
    });

    expect(draft).toMatchObject({
      displayName: "모종 운영 서비스",
      activeVersionId: null,
      draft: {
        status: "draft",
        evidence: [{ claim: "승인된 운영 자동화", sourceUrl: "https://owned.example/service" }],
      },
    });
    await expect(products.approveProductService({
      workspaceId,
      brandId: primaryBrandId,
      actorUserId: memberId,
      itemId: draft.id,
    })).rejects.toThrow("product_service_approval_forbidden");

    const approved = await products.approveProductService({
      workspaceId,
      brandId: primaryBrandId,
      actorUserId: ownerId,
      itemId: draft.id,
    });
    const selectable = await products.listProductServices({ workspaceId, brandId: primaryBrandId });
    expect(selectable).toEqual([
      expect.objectContaining({
        id: approved.id,
        activeVersionId: approved.activeVersionId,
        activeVersion: expect.objectContaining({ status: "approved" }),
      }),
    ]);
  });

  it("adds and activates a Wiki item, preserves its active version, and exposes only trusted DM sources", async () => {
    const [
      workerDatabaseModule,
      sourceWorkerModule,
      compilationWorkerModule,
      finalizeWorkerModule,
    ] = await Promise.all([
      import("../../../workers/brand-pilot-dm-worker/src/db.js"),
      import("../../../workers/brand-pilot-dm-worker/src/compiledWikiSource.js"),
      import("../../../workers/brand-pilot-dm-worker/src/compiledWikiWorker.js"),
      import("../../../workers/brand-pilot-dm-worker/src/compiledWikiFinalize.js"),
    ]);
    const workerDatabase = workerDatabaseModule.createDmWorkerDbFromPool(pool);
    const repository = createRepository(pool);
    const item = await repository.createWikiItem!(
      { workspaceId, brandId: primaryBrandId, actorUserId: memberId },
      {
        contractVersion: "wiki-item.v1",
        itemType: "faq",
        title: "배송은 언제 시작하나요?",
        content: "영업일 기준 이틀 안에 시작합니다.",
        provenance: { source: "owner-reviewed" },
      },
    );
    await expect(repository.updateWikiItem!(
      { workspaceId, brandId: primaryBrandId, actorUserId: memberId, itemId: item.id },
      { status: "active" },
    )).rejects.toThrow("wiki_item_approval_forbidden");
    await repository.updateWikiItem!(
      { workspaceId, brandId: primaryBrandId, actorUserId: ownerId, itemId: item.id },
      { status: "active" },
    );
    const refresh = await repository.enqueueWikiRefresh(primaryBrandId);
    expect(refresh.status).toBe("pending");

    const sourceResults: Array<{ status: string }> = [];
    while (true) {
      const sourceResult = await sourceWorkerModule.runCompiledWikiSourceItemOnce({
        workerId: "library-trust-source-worker",
        db: workerDatabase,
        curatorPromptVersion: "library-trust.v1",
        runtimeDirectory: process.cwd(),
        runCodex: async () => { throw new Error("direct_sources_must_not_call_codex"); },
      });
      if (sourceResult.status === "idle") break;
      expect(sourceResult.status).toBe("completed");
      sourceResults.push(sourceResult);
    }
    expect(sourceResults.length).toBeGreaterThanOrEqual(1);
    expect(sourceResults.at(-1)).toMatchObject({ collectionComplete: true });

    const deterministicCompiler = async ({ prompt }: { prompt: string }) => {
      const encoded = prompt.match(/입력:\n(.+)\n\n출력 계약:/s)?.[1];
      if (!encoded) throw new Error("deterministic_compiler_input_missing");
      const input = JSON.parse(encoded) as {
        pageType: string;
        stableKey: string;
        requiredLinkedStableKeys: string[];
        sourceUnits: Array<{ id: string; title: string; content: string; hasDestinationUrl: boolean }>;
      };
      const sources = input.sourceUnits.map((source) => source.id);
      return {
        pageType: input.pageType,
        stableKey: input.stableKey,
        title: input.pageType === "brand_overview" ? "브랜드 안내" : input.sourceUnits[0].title,
        summary: input.sourceUnits[0].content,
        sections: [{
          sectionKey: "verified",
          heading: "검증된 안내",
          body: input.sourceUnits[0].content,
          sourceUnitIds: sources,
          destinationUrlId: input.sourceUnits.find((source) => source.hasDestinationUrl)?.id ?? null,
        }],
        links: input.requiredLinkedStableKeys.map((targetStableKey) => ({
          targetStableKey,
          relation: "contains",
        })),
      };
    };
    const compiled: Array<{ status: string }> = [];
    while (true) {
      const result = await compilationWorkerModule.runWikiCompilationItemOnce({
        workerId: "library-trust-compiler",
        db: workerDatabase,
        runtimeDirectory: process.cwd(),
        timeoutMs: 1_000,
        runCodex: deterministicCompiler,
      });
      if (result.status === "idle") break;
      compiled.push(result);
      expect(result.status).toBe("completed");
    }
    expect(compiled.length).toBeGreaterThanOrEqual(3);

    const finalized = await finalizeWorkerModule.runWikiFinalizeOnce({
      workerId: "library-trust-finalizer",
      db: workerDatabase,
    });
    expect(finalized).toMatchObject({ status: "ready" });
    const version = await database.query<{ id: string }>(
      `select id from wiki_versions
        where workspace_id=$1 and brand_id=$2 and status='active'`,
      [workspaceId, primaryBrandId],
    );
    expect(version.rows).toHaveLength(1);

    const managed = await repository.listWikiItems!({ workspaceId, brandId: primaryBrandId });
    expect(managed.find((candidate) => candidate.id === item.id)).toMatchObject({
      activeVersionId: version.rows[0].id,
      buildStatus: "active",
    });
    const dmSources = await database.query<{ source_kind: string; source_id: string }>(
      `select source_kind,source_id from wiki_source_units
       where workspace_id=$1 and brand_id=$2 and wiki_version_id=$3`,
      [workspaceId, primaryBrandId, version.rows[0].id],
    );
    expect(dmSources.rows).toEqual(expect.arrayContaining([
      { source_kind: "faq", source_id: item.id },
    ]));
    expect(dmSources.rows.every((source) =>
      ["faq", "product_service"].includes(source.source_kind))).toBe(true);
    const dmResult = await workerDatabase.searchCompiledWiki(
      workspaceId,
      primaryBrandId,
      "배송은 언제 시작하나요?",
    );
    expect(dmResult).toMatchObject({
      wikiVersionId: version.rows[0].id,
      chunks: expect.arrayContaining([expect.objectContaining({
        pageType: "faq",
        content: expect.stringContaining("영업일 기준 이틀"),
      })]),
    });
  }, 30_000);

  it("keeps two avatar images and their representative snapshot after default/archive", async () => {
    const assets = createAssetLibraryRepository(pool);
    await database.exec(`
      insert into brand_avatars(id,workspace_id,brand_id,name,description,created_by_user_id)
      values ('${avatarId}','${workspaceId}','${primaryBrandId}','과거 캠페인 모델','스냅샷 보존','${ownerId}');
      insert into brand_avatar_images(
        workspace_id,brand_id,avatar_id,position,is_representative,storage_url,storage_path,
        mime_type,size_bytes,checksum,created_by_user_id
      ) values
        ('${workspaceId}','${primaryBrandId}','${avatarId}',1,true,
         'https://cdn.example.com/avatar-1.webp','avatars/trust/avatar-1.webp',
         'image/webp',1024,'${"1".repeat(64)}','${ownerId}'),
        ('${workspaceId}','${primaryBrandId}','${avatarId}',2,false,
         'https://cdn.example.com/avatar-2.webp','avatars/trust/avatar-2.webp',
         'image/webp',2048,'${"2".repeat(64)}','${ownerId}');
    `);
    await expect(assets.setDefaultAvatar({
      workspaceId,
      brandId: primaryBrandId,
      actorUserId: memberId,
      avatarId,
    })).rejects.toThrow("asset_library_admin_required");
    const selected = await assets.setDefaultAvatar({
      workspaceId,
      brandId: primaryBrandId,
      actorUserId: ownerId,
      avatarId,
    });
    expect(selected.isDefault).toBe(true);
    await expect(assets.archiveAvatar({
      workspaceId,
      brandId: primaryBrandId,
      actorUserId: memberId,
      avatarId,
    })).rejects.toThrow("asset_library_admin_required");
    await assets.archiveAvatar({
      workspaceId,
      brandId: primaryBrandId,
      actorUserId: ownerId,
      avatarId,
    });

    const retained = await database.query<{
      status: string;
      image_count: number;
      representative_count: number;
    }>(
      `select avatar.status,count(image.id)::int image_count,
              count(image.id) filter(where image.is_representative)::int representative_count
         from brand_avatars avatar
         join brand_avatar_images image on image.avatar_id=avatar.id
        where avatar.id=$1 group by avatar.status`,
      [avatarId],
    );
    expect(retained.rows).toEqual([{
      status: "archived",
      image_count: 2,
      representative_count: 1,
    }]);
    // Generation-to-avatar snapshot ownership is introduced by content orchestration (060);
    // this task verifies the archival assets it will reference remain immutable and available.
  });

  it("keeps a saved trend and linked source URL as one stable patterned reference with atomic quota state", async () => {
    const trends = createInstagramTrendRepository({
      pool,
      decryptCredential: String,
      fetchTopMedia: async () => ({ items: [] }) as never,
    });
    const assets = createAssetLibraryRepository(pool);
    const first = await trends.saveInstagramTrendSource(primaryBrandId, mediaId, ownerId);
    const canonical = await database.query<{ id: string; saved_trend_id: string; source_url_id: string }>(
      `select item.id,item.saved_trend_id,provenance.source_url_id
         from reference_items item
         join reference_item_source_url_provenance provenance on provenance.reference_item_id=item.id
        where item.brand_id=$1 and item.saved_trend_id is not null`,
      [primaryBrandId],
    );
    expect(first.alreadySaved).toBe(false);
    expect(canonical.rows).toHaveLength(1);
    const referenceId = canonical.rows[0].id;
    await database.query(
      `insert into reference_patterns(
         workspace_id,brand_id,reference_item_id,observations,interpretation,
         application_ideas,do_not_copy,confidence,analysis_version,created_by_user_id
       ) values($1,$2,$3,'["짧은 도입"]','정보 구조만 참고',
         '["FAQ 도입에 적용"]','["문구 복제 금지"]',0.8,'reference-pattern.v1',$4)`,
      [workspaceId, primaryBrandId, referenceId, ownerId],
    );
    expect(await assets.getReferencePattern({
      workspaceId,
      brandId: primaryBrandId,
      referenceId,
    })).toMatchObject({
      observations: ["짧은 도입"],
      doNotCopy: ["문구 복제 금지"],
    });
    expect((await assets.listReferences(
      { workspaceId, brandId: primaryBrandId },
      { kind: "trend" },
    )).map((item) => item.id)).toEqual([referenceId]);

    await expect(assets.archiveReference({
      workspaceId,
      brandId: primaryBrandId,
      actorUserId: memberId,
      referenceId,
    })).rejects.toThrow("asset_library_admin_required");

    await database.exec(`
      create function reject_saved_trend_delete() returns trigger language plpgsql as $$
      begin
        raise exception 'forced_saved_trend_delete_failure';
      end;
      $$;
      create trigger reject_saved_trend_delete_trigger
      before delete on brand_trend_saved_media
      for each row execute function reject_saved_trend_delete();
    `);
    await expect(assets.archiveReference({
      workspaceId,
      brandId: primaryBrandId,
      actorUserId: ownerId,
      referenceId,
    })).rejects.toThrow("forced_saved_trend_delete_failure");
    expect(await trends.listInstagramTrendArchive(primaryBrandId, { page: 1, limit: 10 }))
      .toMatchObject({ total: 1, items: [expect.objectContaining({ id: mediaId })] });
    const rolledBack = await database.query<{ archived: boolean; enabled: boolean; saved_count: number }>(
      `select item.archived_at is not null archived,source.enabled,
              (select count(*)::int from brand_trend_saved_media saved
                where saved.id=$2) saved_count
         from reference_items item
         join reference_item_source_url_provenance provenance on provenance.reference_item_id=item.id
         join source_urls source on source.id=provenance.source_url_id
        where item.id=$1`,
      [referenceId, canonical.rows[0].saved_trend_id],
    );
    expect(rolledBack.rows).toEqual([{ archived: false, enabled: true, saved_count: 1 }]);
    await database.exec(`
      drop trigger reject_saved_trend_delete_trigger on brand_trend_saved_media;
      drop function reject_saved_trend_delete();
    `);

    await assets.archiveReference({
      workspaceId,
      brandId: primaryBrandId,
      actorUserId: ownerId,
      referenceId,
    });
    const archived = await database.query<{
      archived: boolean;
      enabled: boolean;
      status: string;
      saved_count: number;
    }>(
      `select item.archived_at is not null archived,source.enabled,source.status,
              (select count(*)::int from brand_trend_saved_media saved
                where saved.id=$2) saved_count
         from reference_items item
         join reference_item_source_url_provenance provenance on provenance.reference_item_id=item.id
         join source_urls source on source.id=provenance.source_url_id
        where item.id=$1`,
      [referenceId, canonical.rows[0].saved_trend_id],
    );
    expect(archived.rows).toEqual([{
      archived: true,
      enabled: false,
      status: "disabled",
      saved_count: 0,
    }]);
    expect(await trends.listInstagramTrendArchive(primaryBrandId, { page: 1, limit: 10 }))
      .toMatchObject({ total: 0, items: [] });

    const resaved = await trends.saveInstagramTrendSource(primaryBrandId, mediaId, ownerId);
    expect(resaved.alreadySaved).toBe(false);
    expect(await trends.listInstagramTrendArchive(primaryBrandId, { page: 1, limit: 10 }))
      .toMatchObject({ total: 1, items: [expect.objectContaining({ id: mediaId })] });
    const reactivated = await database.query<{
      id: string;
      saved_trend_id: string;
      archived: boolean;
      enabled: boolean;
    }>(
      `select item.id,item.saved_trend_id,item.archived_at is not null archived,source.enabled
         from reference_items item
         join reference_item_source_url_provenance provenance on provenance.reference_item_id=item.id
         join source_urls source on source.id=provenance.source_url_id
        where item.brand_id=$1 and item.metadata->>'instagramMediaId'='ig-library-trust'`,
      [primaryBrandId],
    );
    expect(reactivated.rows).toEqual([{
      id: referenceId,
      saved_trend_id: expect.any(String),
      archived: false,
      enabled: true,
    }]);
    expect(reactivated.rows[0].saved_trend_id).not.toBe(canonical.rows[0].saved_trend_id);
  });

  it("blocks cross-brand origins/upload prefixes and keeps unsupported external claims out of product and DM facts", async () => {
    const assets = createAssetLibraryRepository(pool);
    const otherSource = await database.query<{ id: string }>(
      `insert into source_urls(
         workspace_id,brand_id,source_type,url,url_hash,domain,status,enabled,content_purpose
       ) values($1,$2,'reference','https://outside.example/claim','outside-claim',
         'outside.example','active',true,'marketing') returning id`,
      [workspaceId, otherBrandId],
    );
    await expect(database.query(
      `insert into reference_items(
         workspace_id,brand_id,kind,source_url_id,title,metadata,created_by_user_id
       ) values($1,$2,'external_url',$3,'외부의 검증되지 않은 치료 주장',
         '{"unsupportedClaim":"질병을 치료한다"}',$4)`,
      [workspaceId, primaryBrandId, otherSource.rows[0].id, ownerId],
    )).rejects.toThrow();

    const upload = await assets.createUploadSession(
      { workspaceId, brandId: otherBrandId, actorUserId: ownerId },
      "reference",
      {
        fileName: "outside.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1024,
        checksum: "a".repeat(64),
      },
    );
    await expect(assets.getUploadSession(
      { workspaceId, brandId: primaryBrandId, sessionId: upload.id },
      "outside.pdf",
    )).resolves.toBeNull();
    expect(upload.storagePathPrefix).toContain(`/${otherBrandId}/`);
    expect(upload.storagePathPrefix).not.toContain(`/${primaryBrandId}/`);

    const issueSource = await createRepository(pool).createWikiItem!(
      { workspaceId, brandId: primaryBrandId, actorUserId: memberId },
      {
        contractVersion: "wiki-item.v1",
        itemType: "policy",
        title: "검증 정책",
        content: "자사 근거만 사실 답변에 사용합니다.",
        provenance: {},
      },
    );
    await createRepository(pool).updateWikiItem!(
      { workspaceId, brandId: primaryBrandId, actorUserId: ownerId, itemId: issueSource.id },
      { status: "active" },
    );
    await database.query(
      `insert into wiki_issues(
         id,workspace_id,brand_id,wiki_version_id,issue_type,severity,status,question,detail_json
       ) values(
         $1,$2,$3,
         (select id from wiki_versions where workspace_id=$2 and brand_id=$3 and status='active' limit 1),
         'knowledge_gap','warning','open','치료 효과가 있나요?','{}'
       )`,
      [wikiIssueId, workspaceId, primaryBrandId],
    );
    await expect(createRepository(pool).resolveWikiIssue!(
      { workspaceId, brandId: primaryBrandId, actorUserId: memberId, issueId: wikiIssueId },
      { sourceKind: "policy", sourceId: issueSource.id },
    )).rejects.toThrow("wiki_issue_resolution_forbidden");

    const product = (await createProductLibraryRepository(pool)
      .listProductServices({ workspaceId, brandId: primaryBrandId }))[0];
    expect(JSON.stringify(product)).not.toContain("질병을 치료한다");
    const refreshSources = await database.query<{ source_kind: string; content: string }>(
      "select source_kind,content from get_wiki_refresh_sources($1,$2)",
      [workspaceId, primaryBrandId],
    );
    expect(refreshSources.rows.map((row) => row.source_kind)).not.toContain("reference");
    expect(JSON.stringify(refreshSources.rows)).not.toContain("질병을 치료한다");

    // @ts-expect-error The repository-level smoke script is intentionally plain ESM.
    const smoke = await import("../../../scripts/compiled-wiki-smoke.mjs");
    expect(() => smoke.assertTrustedCompiledWikiSources([
      { sourceKind: "external_reference", sourceId: otherSource.rows[0].id },
    ])).toThrow("compiled_wiki_untrusted_source");
  });
});
