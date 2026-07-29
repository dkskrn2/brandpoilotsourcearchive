import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import type { Pool } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  createProductLibraryRepository,
  dispatchWikiRefreshOutboxOnce,
} from "./productLibraryRepository.js";

type QueryResult = { rowCount: number; rows: Record<string, unknown>[] };
function pool(database: PGlite): Pool {
  async function query(sql: string, values: unknown[] = []): Promise<QueryResult> {
    const result = await database.query(sql, values as never[]);
    return { rowCount: result.rows.length || Number(result.affectedRows ?? 0), rows: result.rows as Record<string, unknown>[] };
  }
  return { query, async connect() { return { query, release() {} }; } } as unknown as Pool;
}

const workspaceId = "21000000-0000-4000-8000-000000000001";
const brandId = "22000000-0000-4000-8000-000000000002";
const ownerId = "23000000-0000-4000-8000-000000000003";
const memberId = "24000000-0000-4000-8000-000000000004";
const analysisId = "25000000-0000-4000-8000-000000000005";
let database: PGlite;

beforeAll(async () => {
  database = await PGlite.create({ extensions: { pgcrypto } });
  const directory = resolve(process.cwd(), "../../db/migrations");
  for (const file of (await readdir(directory)).filter((name) => name.endsWith(".sql")).sort()) {
    const sql = await readFile(resolve(directory, file), "utf8");
    if (sql.startsWith("-- requires: pgvector") || file === "027_wiki_search_v2.sql") continue;
    await database.exec(sql);
  }
  await database.exec(`
    insert into app_users(id,email) values ('${ownerId}','owner-products@example.com'),('${memberId}','member-products@example.com');
    insert into workspaces(id,name,slug,created_by_user_id) values ('${workspaceId}','Products','products-repository','${ownerId}');
    insert into workspace_members(workspace_id,user_id,role,status) values
      ('${workspaceId}','${ownerId}','owner','active'),('${workspaceId}','${memberId}','member','active');
    insert into brands(id,workspace_id,name) values ('${brandId}','${workspaceId}','Product Brand');
    insert into ai_content_subject_analyses(
      id,workspace_id,brand_id,subject_type,source_url,normalized_url,status,
      facts_json,structured_data_json,targets_json,appeals_json,idempotency_key
    ) values (
      '${analysisId}','${workspaceId}','${brandId}','service','https://example.com/service','https://example.com/service','ready',
      '[{"claim":"운영 자동화"}]','{"name":"모종 애드","description":"SNS 운영","features":["생성"],"benefits":["시간 절감"]}',
      '[{"id":"owner","name":"운영자"}]','{"owner":[{"id":"time","text":"시간 절감"}]}','analysis-1'
    );
  `);
}, 45_000);

afterAll(async () => database.close());
afterEach(() => vi.useRealTimers());

describe("product library repository", () => {
  it("enqueues an immediate first build when approving without an active Wiki", async () => {
    const repository = createProductLibraryRepository(pool(database));
    await database.query("delete from wiki_build_requests where workspace_id = $1 and brand_id = $2", [workspaceId, brandId]);
    await database.query("delete from wiki_versions where workspace_id = $1 and brand_id = $2", [workspaceId, brandId]);
    const first = await repository.createProductServiceFromAnalysis({ workspaceId, brandId, actorUserId: memberId, analysisId });
    const second = await repository.createProductServiceFromAnalysis({ workspaceId, brandId, actorUserId: memberId, analysisId });
    expect(second.id).toBe(first.id);
    expect(first.draft?.profile.name).toBe("모종 애드");

    await expect(repository.approveProductService({ workspaceId, brandId, actorUserId: memberId, itemId: first.id }))
      .rejects.toThrow("product_service_approval_forbidden");
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-28T17:59:00.000Z"));
    const approved = await repository.approveProductService({ workspaceId, brandId, actorUserId: ownerId, itemId: first.id });
    expect(approved.activeVersion?.status).toBe("approved");
    expect((await repository.listProductServices({ workspaceId, brandId })).map((item) => item.id)).toContain(first.id);
    const approvedBuild = await database.query<{ requested_revision: number; status: string; quiet_until: string }>(
      "select requested_revision, status, quiet_until from wiki_build_requests where workspace_id = $1 and brand_id = $2",
      [workspaceId, brandId],
    );
    expect(approvedBuild.rows).toEqual([{
      requested_revision: 1,
      status: "pending",
      quiet_until: new Date("2026-07-28T17:59:00.000Z"),
    }]);

    await repository.archiveProductService({ workspaceId, brandId, actorUserId: ownerId, itemId: first.id });
    expect(await repository.listProductServices({ workspaceId, brandId })).toEqual([]);
    expect((await repository.listProductServices({ workspaceId, brandId }, ["archived"]))[0]?.status).toBe("archived");
    const archivedBuild = await database.query<{ requested_revision: number; status: string }>(
      "select requested_revision, status from wiki_build_requests where workspace_id = $1 and brand_id = $2",
      [workspaceId, brandId],
    );
    expect(archivedBuild.rows).toEqual([{ requested_revision: 2, status: "pending" }]);
    const refreshEvents = await database.query<{
      event_type: string;
      status: string;
      attempt_count: number;
      last_error: string | null;
    }>(
      `select event_type, status, attempt_count, last_error
         from wiki_refresh_outbox
        where source_id = $1
        order by created_at`,
      [first.id],
    );
    expect(refreshEvents.rows).toEqual([
      { event_type: "approved", status: "succeeded", attempt_count: 1, last_error: null },
      { event_type: "archived", status: "succeeded", attempt_count: 1, last_error: null },
    ]);
    vi.useRealTimers();
  });

  it("commits approval when its Wiki enqueue fails", async () => {
    const repository = createProductLibraryRepository(pool(database));
    const itemId = "26000000-0000-4000-8000-000000000006";
    const versionId = "27000000-0000-4000-8000-000000000007";
    await database.exec(`
      insert into product_services(id,workspace_id,brand_id,kind,display_name)
      values ('${itemId}','${workspaceId}','${brandId}','service','롤백 서비스');
      insert into product_service_versions(
        id,workspace_id,brand_id,product_service_id,version,status,profile_json,created_by_user_id
      ) values (
        '${versionId}','${workspaceId}','${brandId}','${itemId}',1,'draft',
        '{"contractVersion":"product-service.v1","name":"롤백 서비스","kind":"service","description":"","features":[],"benefits":[],"cautions":[],"audiences":[],"appealsByTarget":{},"evergreenPurchaseInfo":"","sourceUrls":[]}',
        '${ownerId}'
      );
      create or replace function reject_product_wiki_enqueue()
      returns trigger language plpgsql as $$
      begin
        raise exception 'forced_wiki_enqueue_failure';
      end;
      $$;
      create trigger reject_product_wiki_enqueue_trigger
      before insert or update on wiki_build_requests
      for each row execute function reject_product_wiki_enqueue();
    `);

    let approval: Awaited<ReturnType<typeof repository.approveProductService>> | undefined;
    let approvalError: unknown;
    try {
      approval = await repository.approveProductService({
        workspaceId,
        brandId,
        actorUserId: ownerId,
        itemId,
      });
    } catch (error) {
      approvalError = error;
    } finally {
      await database.exec(`
        drop trigger reject_product_wiki_enqueue_trigger on wiki_build_requests;
        drop function reject_product_wiki_enqueue();
      `);
    }
    expect(approvalError).toBeUndefined();
    expect(approval).toMatchObject({ activeVersion: { status: "approved" } });

    const state = await database.query<{ active_version_id: string | null; version_status: string }>(
      `select item.active_version_id, version.status as version_status
         from product_services item
         join product_service_versions version on version.product_service_id = item.id
        where item.id = $1`,
      [itemId],
    );
    expect(state.rows).toEqual([{ active_version_id: versionId, version_status: "approved" }]);
    const recovery = await database.query<{
      status: string;
      attempt_count: number;
      last_error: string | null;
      next_attempt_at: Date;
    }>(
      `select status, attempt_count, last_error, next_attempt_at
         from wiki_refresh_outbox
        where source_id = $1 and event_type = 'approved'`,
      [itemId],
    );
    expect(recovery.rows).toHaveLength(1);
    expect(recovery.rows[0]).toMatchObject({
      status: "pending",
      attempt_count: 1,
      last_error: "forced_wiki_enqueue_failure",
    });
    expect(recovery.rows[0].next_attempt_at.getTime()).toBeGreaterThan(Date.now());
  });

  it("schedules an active Wiki refresh for the next 03:00 KST boundary", async () => {
    const repository = createProductLibraryRepository(pool(database));
    const itemId = "28000000-0000-4000-8000-000000000008";
    const versionId = "29000000-0000-4000-8000-000000000009";
    await database.query("delete from wiki_build_requests where workspace_id = $1 and brand_id = $2", [workspaceId, brandId]);
    await database.query("delete from wiki_versions where workspace_id = $1 and brand_id = $2", [workspaceId, brandId]);
    await database.exec(`
      insert into wiki_versions(
        id,workspace_id,brand_id,status,source_count,document_count,chunk_count,activated_at
      ) values (
        '30000000-0000-4000-8000-000000000010','${workspaceId}','${brandId}',
        'active',1,1,1,'2026-07-28T12:00:00Z'
      );
      insert into product_services(id,workspace_id,brand_id,kind,display_name)
      values ('${itemId}','${workspaceId}','${brandId}','service','예약 서비스');
      insert into product_service_versions(
        id,workspace_id,brand_id,product_service_id,version,status,profile_json,created_by_user_id
      ) values (
        '${versionId}','${workspaceId}','${brandId}','${itemId}',1,'draft',
        '{"contractVersion":"product-service.v1","name":"예약 서비스","kind":"service","description":"","features":[],"benefits":[],"cautions":[],"audiences":[],"appealsByTarget":{},"evergreenPurchaseInfo":"","sourceUrls":[]}',
        '${ownerId}'
      );
    `);
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-28T17:59:00.000Z"));

    await repository.approveProductService({ workspaceId, brandId, actorUserId: ownerId, itemId });
    const scheduled = await database.query<{ quiet_until: Date }>(
      "select quiet_until from wiki_build_requests where workspace_id = $1 and brand_id = $2 and status = 'pending'",
      [workspaceId, brandId],
    );
    expect(scheduled.rows).toEqual([{ quiet_until: new Date("2026-07-28T18:00:00.000Z") }]);

    await database.query(
      "update wiki_build_requests set status = 'succeeded' where workspace_id = $1 and brand_id = $2",
      [workspaceId, brandId],
    );
    vi.setSystemTime(new Date("2026-07-28T18:01:00.000Z"));
    await repository.archiveProductService({ workspaceId, brandId, actorUserId: ownerId, itemId });
    const nextDay = await database.query<{ quiet_until: Date }>(
      "select quiet_until from wiki_build_requests where workspace_id = $1 and brand_id = $2 and status = 'pending'",
      [workspaceId, brandId],
    );
    expect(nextDay.rows).toEqual([{ quiet_until: new Date("2026-07-29T18:00:00.000Z") }]);
  });

  it("does not delay an existing immediate request when an active Wiki becomes dirty", async () => {
    const repository = createProductLibraryRepository(pool(database));
    const itemId = "31000000-0000-4000-8000-000000000011";
    const versionId = "32000000-0000-4000-8000-000000000012";
    await database.query("delete from wiki_build_requests where workspace_id = $1 and brand_id = $2", [workspaceId, brandId]);
    await database.query("delete from wiki_versions where workspace_id = $1 and brand_id = $2", [workspaceId, brandId]);
    await database.exec(`
      insert into wiki_versions(
        id,workspace_id,brand_id,status,source_count,document_count,chunk_count,activated_at
      ) values (
        '33000000-0000-4000-8000-000000000013','${workspaceId}','${brandId}',
        'active',1,1,1,'2026-07-28T12:00:00Z'
      );
      insert into product_services(id,workspace_id,brand_id,kind,display_name)
      values ('${itemId}','${workspaceId}','${brandId}','service','즉시 서비스');
      insert into product_service_versions(
        id,workspace_id,brand_id,product_service_id,version,status,profile_json,created_by_user_id,
        approved_by_user_id,approved_at
      ) values (
        '${versionId}','${workspaceId}','${brandId}','${itemId}',1,'approved',
        '{"contractVersion":"product-service.v1","name":"즉시 서비스","kind":"service","description":"","features":[],"benefits":[],"cautions":[],"audiences":[],"appealsByTarget":{},"evergreenPurchaseInfo":"","sourceUrls":[]}',
        '${ownerId}','${ownerId}',now()
      );
      update product_services set active_version_id='${versionId}' where id='${itemId}';
    `);
    await database.query(
      `insert into wiki_build_requests(workspace_id, brand_id, quiet_until)
       values ($1, $2, $3)`,
      [workspaceId, brandId, new Date("2026-07-28T18:01:00.000Z")],
    );
    await repository.archiveProductService({ workspaceId, brandId, actorUserId: ownerId, itemId });
    const immediate = await database.query<{ requested_revision: number; quiet_until: Date }>(
      "select requested_revision, quiet_until from wiki_build_requests where workspace_id = $1 and brand_id = $2 and status = 'pending'",
      [workspaceId, brandId],
    );
    expect(immediate.rows).toEqual([{
      requested_revision: 2,
      quiet_until: new Date("2026-07-28T18:01:00.000Z"),
    }]);
  });

  it("preserves the next 03:00 KST target when a product changes during a Wiki build", async () => {
    const repository = createProductLibraryRepository(pool(database));
    const itemId = "34000000-0000-4000-8000-000000000014";
    const versionId = "35000000-0000-4000-8000-000000000015";
    await database.query("delete from wiki_build_requests where workspace_id = $1 and brand_id = $2", [workspaceId, brandId]);
    await database.query("delete from wiki_versions where workspace_id = $1 and brand_id = $2", [workspaceId, brandId]);
    await database.exec(`
      insert into wiki_versions(
        id,workspace_id,brand_id,status,source_count,document_count,chunk_count,activated_at
      ) values (
        '36000000-0000-4000-8000-000000000016','${workspaceId}','${brandId}',
        'active',1,1,1,'2026-07-28T12:00:00Z'
      );
      insert into product_services(id,workspace_id,brand_id,kind,display_name)
      values ('${itemId}','${workspaceId}','${brandId}','service','빌드 중 변경 서비스');
      insert into product_service_versions(
        id,workspace_id,brand_id,product_service_id,version,status,profile_json,created_by_user_id,
        approved_by_user_id,approved_at
      ) values (
        '${versionId}','${workspaceId}','${brandId}','${itemId}',1,'approved',
        '{"contractVersion":"product-service.v1","name":"빌드 중 변경 서비스","kind":"service","description":"","features":[],"benefits":[],"cautions":[],"audiences":[],"appealsByTarget":{},"evergreenPurchaseInfo":"","sourceUrls":[]}',
        '${ownerId}','${ownerId}',now()
      );
      update product_services set active_version_id='${versionId}' where id='${itemId}';
      insert into wiki_build_requests(
        workspace_id,brand_id,requested_revision,building_revision,status,quiet_until,started_at
      ) values (
        '${workspaceId}','${brandId}',1,1,'building','2026-07-28T17:00:00Z','2026-07-28T17:00:00Z'
      );
    `);
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-28T17:30:00.000Z"));

    await repository.archiveProductService({ workspaceId, brandId, actorUserId: ownerId, itemId });

    const scheduled = await database.query<{
      requested_revision: number;
      rebuild_requested: boolean;
      quiet_until: Date;
    }>(
      `select requested_revision, rebuild_requested, quiet_until
         from wiki_build_requests
        where workspace_id = $1 and brand_id = $2 and status = 'building'`,
      [workspaceId, brandId],
    );
    expect(scheduled.rows).toEqual([{
      requested_revision: 2,
      rebuild_requested: true,
      quiet_until: new Date("2026-07-28T18:00:00.000Z"),
    }]);
  });

  it("retries against the mutation's 03:00 target after dispatch crosses the boundary", async () => {
    const itemId = "37000000-0000-4000-8000-000000000017";
    const versionId = "38000000-0000-4000-8000-000000000018";
    await database.query("delete from wiki_build_requests where workspace_id = $1 and brand_id = $2", [workspaceId, brandId]);
    await database.query("delete from wiki_versions where workspace_id = $1 and brand_id = $2", [workspaceId, brandId]);
    await database.exec(`
      insert into wiki_versions(
        id,workspace_id,brand_id,status,source_count,document_count,chunk_count,activated_at
      ) values (
        '39000000-0000-4000-8000-000000000019','${workspaceId}','${brandId}',
        'active',1,1,1,'2026-07-28T12:00:00Z'
      );
      insert into product_services(id,workspace_id,brand_id,kind,display_name)
      values ('${itemId}','${workspaceId}','${brandId}','service','경계 재시도 서비스');
      insert into product_service_versions(
        id,workspace_id,brand_id,product_service_id,version,status,profile_json,created_by_user_id,
        approved_by_user_id,approved_at
      ) values (
        '${versionId}','${workspaceId}','${brandId}','${itemId}',1,'approved',
        '{"contractVersion":"product-service.v1","name":"경계 재시도 서비스","kind":"service","description":"","features":[],"benefits":[],"cautions":[],"audiences":[],"appealsByTarget":{},"evergreenPurchaseInfo":"","sourceUrls":[]}',
        '${ownerId}','${ownerId}',now()
      );
      update product_services set active_version_id='${versionId}' where id='${itemId}';
      insert into wiki_refresh_outbox(
        workspace_id,brand_id,source_kind,source_id,event_type,mutation_key,
        status,next_attempt_at,created_at
      ) values (
        '${workspaceId}','${brandId}','product_service','${itemId}','archived',
        'archived:${versionId}','pending','2026-07-28T17:59:00Z','2026-07-28T17:59:00Z'
      );
    `);
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-28T18:01:00.000Z"));

    await dispatchWikiRefreshOutboxOnce(pool(database), "api-retry");

    const scheduled = await database.query<{ quiet_until: Date }>(
      `select quiet_until
         from wiki_build_requests
        where workspace_id = $1 and brand_id = $2 and status = 'pending'`,
      [workspaceId, brandId],
    );
    expect(scheduled.rows).toEqual([{ quiet_until: new Date("2026-07-28T18:00:00.000Z") }]);
  });
});
