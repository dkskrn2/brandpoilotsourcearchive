import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createPublishItemsRepository } from "./publishItemsRepository.js";

const WORKSPACE = "10000000-0000-4000-8000-000000000001";
const BRAND = "20000000-0000-4000-8000-000000000001";
const OTHER_WORKSPACE = "10000000-0000-4000-8000-000000000002";
const OTHER_BRAND = "20000000-0000-4000-8000-000000000002";
const ids = {
  topicSelected: "30000000-0000-4000-8000-000000000001",
  topicReserved: "30000000-0000-4000-8000-000000000002",
  topicOutput1: "30000000-0000-4000-8000-000000000003",
  topicOutput2: "30000000-0000-4000-8000-000000000004",
  topicPartialFailed: "30000000-0000-4000-8000-000000000005",
  topicPartialActive: "30000000-0000-4000-8000-000000000006",
  topicFailed: "30000000-0000-4000-8000-000000000007",
  topicCancelled: "30000000-0000-4000-8000-000000000008",
  topicCrossTenant: "30000000-0000-4000-8000-000000000009",
  generationPending: "40000000-0000-4000-8000-000000000001",
  generationComplete: "40000000-0000-4000-8000-000000000002",
  output1: "50000000-0000-4000-8000-000000000001",
  output2: "50000000-0000-4000-8000-000000000002",
};

describe("publish items repository with postgres semantics", () => {
  let db: PGlite;

  beforeEach(async () => {
    db = await PGlite.create();
    await db.exec(`
      create table source_urls (id uuid primary key,workspace_id uuid not null,brand_id uuid not null,url text not null);
      create table source_content_items (
        id uuid primary key,workspace_id uuid not null,brand_id uuid not null,content_url text not null,deleted_at timestamptz
      );
      create table source_snapshots (
        id uuid primary key,workspace_id uuid not null,brand_id uuid not null,source_url_id uuid not null,source_content_item_id uuid
      );
      create table topic_rows (id uuid primary key,workspace_id uuid not null,brand_id uuid not null,topic_title text,topic_angle text,reference_url text);
      create table content_topics (
        id uuid primary key,workspace_id uuid not null,brand_id uuid not null,topic_row_id uuid,title text not null,
        angle text not null,status text not null,source_context jsonb not null default '{}'::jsonb,
        selected_instagram_format text,created_at timestamptz not null
      );
      create table ai_content_generations (
        id uuid primary key,workspace_id uuid not null,brand_id uuid not null,title text not null,status text not null,
        output_format text,draft_json jsonb not null default '{}'::jsonb,created_at timestamptz not null
      );
      create table ai_content_generation_outputs (
        id uuid primary key,generation_id uuid not null,workspace_id uuid not null,brand_id uuid not null,
        output_index integer not null,title text,status text not null,created_at timestamptz not null
      );
      create table topic_publish_groups (
        id uuid primary key,workspace_id uuid not null,brand_id uuid not null,content_topic_id uuid not null,status text not null,created_at timestamptz not null
      );
      create table publish_calendar_slots (
        id uuid primary key,workspace_id uuid not null,brand_id uuid not null,scheduled_for timestamptz not null,
        assignment_mode text not null,status text not null,content_format text,channels text[] not null default '{}',
        content_suggestion_id uuid,proposal_id uuid,generation_id uuid,generation_output_id uuid,
        topic_publish_group_id uuid,title text,last_error text,created_at timestamptz not null
      );
      create table storage_artifacts (id uuid primary key,workspace_id uuid not null,brand_id uuid not null,public_url text);
      create table channel_outputs (
        id uuid primary key,workspace_id uuid not null,brand_id uuid not null,content_topic_id uuid,
        master_draft_id uuid,ai_content_generation_output_id uuid,channel text not null default 'instagram',
        delivery_format text,status text not null default 'approved',title text not null,preview_title text,
        preview_body text,output_json jsonb not null default '{}'::jsonb,source_summary text,
        block_reasons jsonb not null default '[]'::jsonb,rendered_artifact_id uuid,
        generated_at timestamptz not null default now(),created_at timestamptz not null
      );
      create table publish_queue (
        id uuid primary key,workspace_id uuid not null,brand_id uuid not null,channel_output_id uuid not null,
        topic_publish_group_id uuid,channel text not null,status text not null,scheduled_for timestamptz,
        deferred_until timestamptz,published_at timestamptz,failed_at timestamptz,last_error text,created_at timestamptz not null
      );
      create table publish_attempts (
        id uuid primary key,workspace_id uuid not null,brand_id uuid not null,publish_queue_id uuid not null,
        external_post_id text,external_url text,finished_at timestamptz,created_at timestamptz not null
      );
    `);

    await db.query(`insert into topic_rows values
      ('31000000-0000-4000-8000-000000000001',$1,$2,'SNS 운영 주제','사장님 관점','https://example.com/topic')`, [WORKSPACE, BRAND]);
    await db.query(`insert into source_urls values('32000000-0000-4000-8000-000000000001',$1,$2,'https://owned.example.com/source')`, [WORKSPACE, BRAND]);
    await db.query(`insert into source_content_items values(
      '34000000-0000-4000-8000-000000000001',$1,$2,'https://owned.example.com/deleted','2026-08-10T00:00:00Z'
    )`, [WORKSPACE, BRAND]);
    await db.query(`insert into source_snapshots values
      ('33000000-0000-4000-8000-000000000001',$1,$2,'32000000-0000-4000-8000-000000000001',null),
      ('33000000-0000-4000-8000-000000000002',$1,$2,'32000000-0000-4000-8000-000000000001','34000000-0000-4000-8000-000000000001')`,
      [WORKSPACE, BRAND]);
    await db.query(`insert into content_topics values
      ($3,$1,$2,'31000000-0000-4000-8000-000000000001','선택 주제','각도','selected',jsonb_build_object('sourceSnapshotId','33000000-0000-4000-8000-000000000001'),'instagram_feed_carousel','2026-08-01T00:00:00Z'),
      ($4,$1,$2,null,'예약 전 생성 주제','각도','generated','{}','instagram_reel','2026-08-02T00:00:00Z'),
      ($5,$1,$2,null,'출력 1 bridge','각도','generated',jsonb_build_object('aiContentOutputId',$11::text),null,'2026-08-03T00:00:00Z'),
      ($6,$1,$2,null,'출력 2 bridge','각도','generated',jsonb_build_object('aiContentOutputId',$12::text,'sourceSnapshotIds',jsonb_build_array('33000000-0000-4000-8000-000000000001')),null,'2026-08-04T00:00:00Z'),
      ($7,$1,$2,null,'부분 실패','각도','generated','{}','instagram_feed_carousel','2026-08-05T00:00:00Z'),
      ($8,$1,$2,null,'부분 진행','각도','generated',jsonb_build_object('sourceSnapshotIds',jsonb_build_array('33000000-0000-4000-8000-000000000002')),'instagram_feed_carousel','2026-08-06T00:00:00Z'),
      ($9,$1,$2,null,'실패','각도','failed',jsonb_build_object('sourceSnapshotId','not-a-uuid','sourceSnapshotIds','not-an-array'),'instagram_feed_carousel','2026-08-07T00:00:00Z'),
      ($10,$1,$2,null,'취소','각도','cancelled','{}','instagram_feed_carousel','2026-08-08T00:00:00Z'),
      ($13,$14,$15,null,'다른 tenant','각도','selected','{}','instagram_feed_carousel','2026-08-09T00:00:00Z')`, [
        WORKSPACE, BRAND, ids.topicSelected, ids.topicReserved, ids.topicOutput1, ids.topicOutput2,
        ids.topicPartialFailed, ids.topicPartialActive, ids.topicFailed, ids.topicCancelled,
        ids.output1, ids.output2, ids.topicCrossTenant, OTHER_WORKSPACE, OTHER_BRAND,
      ]);
    await db.query(`insert into ai_content_generations values
      ($3,$1,$2,'생성 중','generating','card_news','{}','2026-08-10T00:00:00Z'),
      ($4,$1,$2,'완료 생성','completed','reel','{}','2026-08-11T00:00:00Z')`,
      [WORKSPACE, BRAND, ids.generationPending, ids.generationComplete]);
    await db.query(`insert into ai_content_generation_outputs values
      ($3,$4,$1,$2,1,'완료 출력 1','completed','2026-08-12T00:00:00Z'),
      ($5,$4,$1,$2,2,'완료 출력 2','completed','2026-08-12T01:00:00Z')`,
      [WORKSPACE, BRAND, ids.output1, ids.generationComplete, ids.output2]);

    const topics = [ids.topicReserved, ids.topicOutput1, ids.topicOutput2, ids.topicPartialFailed,
      ids.topicPartialActive, ids.topicFailed, ids.topicCancelled];
    const groupStatuses = ["waiting", "scheduled", "ready", "partially_published", "partially_published", "failed", "cancelled"];
    for (let index = 0; index < topics.length; index += 1) {
      await db.query(`insert into topic_publish_groups values($1,$2,$3,$4,$5,'2026-08-13T00:00:00Z')`, [
        `60000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`, WORKSPACE, BRAND, topics[index],
        groupStatuses[index],
      ]);
    }
    await db.query(`insert into publish_calendar_slots values
      ('70000000-0000-4000-8000-000000000001',$1,$2,'2026-08-25T02:00:00Z','manual','generation_pending','reel',array['instagram'],null,null,null,null,'60000000-0000-4000-8000-000000000001','예약 전 생성 주제',null,'2026-08-13T00:00:00Z'),
      ('70000000-0000-4000-8000-000000000002',$1,$2,'2026-08-26T02:00:00Z','automatic','scheduled','reel',array['instagram'],null,null,$3,null,'60000000-0000-4000-8000-000000000002','완료 출력 1',null,'2026-08-13T01:00:00Z'),
      ('70000000-0000-4000-8000-000000000003',$1,$2,'2026-08-20T02:00:00Z','manual','cancelled','card_news',array['instagram'],null,null,null,null,'60000000-0000-4000-8000-000000000007','취소','cancelled','2026-08-13T02:00:00Z'),
      ('70000000-0000-4000-8000-000000000004',$1,$2,'2026-08-29T02:00:00Z','automatic','open','card_news',array['instagram'],null,null,null,null,null,null,null,'2026-08-13T03:00:00Z'),
      ('70000000-0000-4000-8000-000000000005',$1,$2,'2026-08-29T03:00:00Z','automatic','cancelled','card_news',array['instagram'],null,null,null,null,null,null,null,'2026-08-13T04:00:00Z')`,
      [WORKSPACE, BRAND, ids.generationComplete]);

    const outputRows: Array<[string, string, string | null, string, string]> = [
      ["80000000-0000-4000-8000-000000000001", ids.topicOutput1, ids.output1, "출력1 인스타", "instagram_reel"],
      ["80000000-0000-4000-8000-000000000002", ids.topicOutput2, ids.output2, "출력2 인스타", "instagram_reel"],
      ["80000000-0000-4000-8000-000000000003", ids.topicPartialFailed, null, "부분실패 인스타", "instagram_feed_carousel"],
      ["80000000-0000-4000-8000-000000000004", ids.topicPartialFailed, null, "부분실패 스레드", "threads_text"],
      ["80000000-0000-4000-8000-000000000005", ids.topicPartialActive, null, "부분진행 인스타", "instagram_feed_carousel"],
      ["80000000-0000-4000-8000-000000000006", ids.topicPartialActive, null, "부분진행 스레드", "threads_text"],
      ["80000000-0000-4000-8000-000000000007", ids.topicFailed, null, "실패 인스타", "instagram_feed_carousel"],
      ["80000000-0000-4000-8000-000000000008", ids.topicCancelled, null, "취소 인스타", "instagram_feed_carousel"],
    ];
    for (const [id, topicId, outputId, title, format] of outputRows) {
      await db.query(`insert into channel_outputs (
        id,workspace_id,brand_id,content_topic_id,ai_content_generation_output_id,delivery_format,title,
        preview_title,preview_body,output_json,source_summary,rendered_artifact_id,generated_at,created_at
      ) values($1,$2,$3,$4,$5,$6,$7,null,null,'{}',$8,null,'2026-08-14T00:00:00Z','2026-08-14T00:00:00Z')`,
        [id, WORKSPACE, BRAND, topicId, outputId, format, title, outputId === ids.output2 ? "브랜드 자료 요약" : null]);
    }
    const queues: Array<[string, string, string | null, string, string, string | null, string | null, string | null]> = [
      ["90000000-0000-4000-8000-000000000001", outputRows[0][0], "60000000-0000-4000-8000-000000000002", "instagram", "scheduled", "2026-08-26T02:00:00Z", null, null],
      ["90000000-0000-4000-8000-000000000002", outputRows[1][0], "60000000-0000-4000-8000-000000000003", "instagram", "queued", "2026-08-27T02:00:00Z", null, null],
      ["90000000-0000-4000-8000-000000000003", outputRows[2][0], null, "instagram", "published", null, "2026-08-18T02:00:00Z", null],
      ["90000000-0000-4000-8000-000000000004", outputRows[3][0], null, "threads", "failed", null, null, "provider_failed"],
      ["90000000-0000-4000-8000-000000000005", outputRows[4][0], null, "instagram", "published", null, "2026-08-19T02:00:00Z", null],
      ["90000000-0000-4000-8000-000000000006", outputRows[5][0], null, "threads", "scheduled", "2026-08-28T02:00:00Z", null, null],
      ["90000000-0000-4000-8000-000000000007", outputRows[6][0], "60000000-0000-4000-8000-000000000006", "instagram", "failed", null, null, "failed"],
      ["90000000-0000-4000-8000-000000000008", outputRows[7][0], "60000000-0000-4000-8000-000000000007", "instagram", "cancelled", null, null, null],
    ];
    for (const [id, channelOutputId, groupId, targetChannel, status, scheduledFor, publishedAt, lastError] of queues) {
      await db.query(`insert into publish_queue (
        id,workspace_id,brand_id,channel_output_id,topic_publish_group_id,channel,status,scheduled_for,
        deferred_until,published_at,last_error,created_at
      ) values($1,$2,$3,$4,$5,$6,$7,$8,null,$9,$10,'2026-08-15T00:00:00Z')`,
        [id, WORKSPACE, BRAND, channelOutputId, groupId, targetChannel, status, scheduledFor, publishedAt, lastError]);
    }
  });

  afterEach(async () => db?.close());

  it("returns one canonical item per scoped publication unit", async () => {
    const reviewDraftId = "41000000-0000-4000-8000-000000000001";
    await db.query(`insert into channel_outputs (
      id,workspace_id,brand_id,master_draft_id,channel,delivery_format,status,title,preview_title,preview_body,
      output_json,source_summary,block_reasons,generated_at,created_at
    ) values (
      '42000000-0000-4000-8000-000000000001',$1,$2,$3,'instagram','instagram_feed_carousel','pending_review',
      '검토할 콘텐츠','검토 제목','검토 본문','{}','검토 근거','["manual_review"]','2026-08-16T00:00:00Z','2026-08-16T00:00:00Z'
    )`, [WORKSPACE, BRAND, reviewDraftId]);
    await db.query(`update publish_queue set failed_at='2026-08-20T02:00:00Z'
      where id='90000000-0000-4000-8000-000000000007'`);
    await db.query(`insert into publish_attempts values (
      '91000000-0000-4000-8000-000000000001',$1,$2,'90000000-0000-4000-8000-000000000007',
      'external-post-1','https://instagram.example/post','2026-08-20T02:00:00Z','2026-08-20T01:59:00Z'
    )`, [WORKSPACE, BRAND]);
    const query = async (sql: string, values: unknown[] = []) => {
      const result = await db.query(sql, values as never[]);
      return { rows: result.rows, rowCount: result.rows.length || Number(result.affectedRows ?? 0) };
    };
    const repository = createPublishItemsRepository({ query } as never);
    const items = await repository.listPublishItems({ workspaceId: WORKSPACE, brandId: BRAND });
    const keys = items.map((item) => item.itemKey);

    expect(keys).toEqual(expect.arrayContaining([
      `topic:${ids.topicSelected}`, `topic:${ids.topicReserved}`, `generation:${ids.generationPending}`,
      `output:${ids.output1}`, `output:${ids.output2}`,
      `draft:${reviewDraftId}`,
    ]));
    expect(keys.filter((key) => key === `topic:${ids.topicReserved}`)).toHaveLength(1);
    expect(keys).not.toContain(`topic:${ids.topicOutput1}`);
    expect(keys).not.toContain(`generation:${ids.generationComplete}`);
    expect(keys).not.toContain(`topic:${ids.topicCrossTenant}`);
    expect(keys).not.toContain("slot:70000000-0000-4000-8000-000000000004");
    expect(keys).not.toContain("slot:70000000-0000-4000-8000-000000000005");
    expect(items.every((item) => item.workspaceId === WORKSPACE && item.brandId === BRAND)).toBe(true);
    expect(items.find((item) => item.itemKey === `topic:${ids.topicSelected}`)).toMatchObject({
      status: "pre_generation", calendarPlacement: "unreserved", schedulable: true,
      source: { type: "mixed", urls: expect.arrayContaining(["https://owned.example.com/source"]) },
    });
    expect(items.find((item) => item.itemKey === `topic:${ids.topicReserved}`)).toMatchObject({
      status: "reserved", calendarPlacement: "dated", scheduledFor: "2026-08-25T02:00:00.000Z",
    });
    expect(items.find((item) => item.itemKey === `topic:${ids.topicPartialFailed}`)).toMatchObject({
      status: "failed", publicationProgress: "partial", calendarDate: "2026-08-18T02:00:00.000Z",
    });
    expect(items.find((item) => item.itemKey === `topic:${ids.topicPartialActive}`)).toMatchObject({
      status: "scheduled", publicationProgress: "partial", calendarDate: "2026-08-28T02:00:00.000Z",
      source: { urls: [] },
    });
    expect(items.find((item) => item.itemKey === `topic:${ids.topicFailed}`)?.calendarPlacement).toBe("hidden");
    expect(items.find((item) => item.itemKey === `topic:${ids.topicCancelled}`)?.calendarPlacement).toBe("hidden");
    expect(items.find((item) => item.itemKey === `output:${ids.output2}`)).toMatchObject({
      assignmentMode: "direct", sourceRefs: { generationOutputId: ids.output2 },
      source: { type: "source_url", detail: "브랜드 자료 요약", urls: ["https://owned.example.com/source"] },
    });
    expect(items.find((item) => item.itemKey === `draft:${reviewDraftId}`)).toMatchObject({
      contentStatus: "completed", schedulable: false, calendarPlacement: "hidden",
      reviewTargets: [{
        channelOutputId: "42000000-0000-4000-8000-000000000001", status: "pending_review",
        previewTitle: "검토 제목", sourceSummary: "검토 근거", blockReasons: ["manual_review"],
      }],
    });
    expect(items.find((item) => item.itemKey === `topic:${ids.topicFailed}`)?.targets[0]).toMatchObject({
      failedAt: "2026-08-20T02:00:00.000Z", externalPostId: "external-post-1",
      externalUrl: "https://instagram.example/post",
    });
  });
});
