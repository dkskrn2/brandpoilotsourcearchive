import { describe, expect, it, vi } from "vitest";
import { createRepository } from "./repository";

const hashtags = ["#제주여행", "#가족여행", "#제주숙소", "#여행동선", "#여행준비"];

function feedManifest() {
  return {
    jobId: "job-1",
    channelOutputId: "output-1",
    model: "fixture",
    deliveryFormat: "instagram_feed_carousel",
    promptVersion: "worker-card.v4",
    sourceMode: "topic_only",
    fetchStatus: "not_requested",
    selectedAssetCount: 1,
    validation: { passed: true },
    title: "후기보다 먼저 볼 것",
    caption: "가족여행은 숙소 평점보다 이동 동선이 중요합니다.",
    hashtags,
    cards: [{
      index: 1,
      role: "hook",
      url: "https://blob.example.com/rendered-content/instagram/brand-1/output-1/job-1/card-01.png",
      mimeType: "image/png",
      width: 1080,
      height: 1080
    }]
  };
}

function runningJobRow(
  deliveryFormat = "instagram_feed_carousel",
  promptVersion = "worker-card.v4",
  options: { outputStatus?: string; autoApprovalEnabled?: boolean } = {}
) {
  return {
    id: "job-1",
    workspace_id: "workspace-1",
    brand_id: "brand-1",
    channel_output_id: "output-1",
    payload_json: {
      deliveryFormat,
      promptVersion,
      storagePrefix: "rendered-content/instagram/brand-1/output-1/job-1"
    },
    output_json: { deliveryFormat, artifactStatus: "pending" },
    output_title: "기존 제목",
    output_status: options.outputStatus ?? "auto_approval_blocked",
    topic_publish_group_id: "group-1",
    brand_channel_id: "instagram-channel-1",
    auto_approval_enabled: options.autoApprovalEnabled ?? false
  };
}

describe("image worker completion", () => {
  it("claims format-specific Instagram render jobs", async () => {
    const query = vi.fn(async (sql: string, _values?: unknown[]) => {
      if (sql.includes("update jobs job")) return {
        rowCount: 1,
        rows: [{
          id: "job-1",
          workspace_id: "workspace-1",
          brand_id: "brand-1",
          channel_output_id: "output-1",
          lease_token: "lease-1",
          payload_json: {
            deliveryFormat: "instagram_feed_carousel",
            promptVersion: "worker-card.v4",
            topic: { title: "Topic", angle: "Angle", targetCustomer: null, region: null, season: null, notes: null },
            brand: { name: "Brand", industry: null, primaryCustomer: null, description: null, tone: null, brandColor: null },
            representativeUrl: null,
            maxImages: 5
          },
          attempt_count: "1"
        }]
      };
      return { rowCount: 0, rows: [] };
    });
    const release = vi.fn();
    const repository = createRepository({
      query: vi.fn(),
      connect: vi.fn(async () => ({ query, release }))
    } as any, { imageRenderCooldownMs: 60_000 });

    const result = await repository.claimImageRenderJob("worker-1");

    expect(result?.id).toBe("job-1");
    expect(query.mock.calls.map(([sql]) => String(sql).trim())).toEqual(expect.arrayContaining([
      "begin",
      "commit"
    ]));
    expect(query.mock.calls.some(([sql]) => String(sql).includes("pg_advisory_xact_lock"))).toBe(true);
    const sql = String(query.mock.calls.find(([statement]) => String(statement).includes("update jobs job"))?.[0]);
    expect(sql).toContain("instagram_feed_render");
    expect(sql).toContain("instagram_story_render");
    expect(sql).toContain("instagram_reel_render");
    expect(sql).toContain("active.status = 'running'");
    expect(sql).toContain("recent.attempt_count > 0");
    expect(sql).toContain("interval '1 millisecond'");
    expect(sql).not.toContain("job_type = 'instagram_render'");
    expect(query.mock.calls.find(([statement]) => String(statement).includes("update jobs job"))?.[1]).toEqual([
      "worker-1",
      60_000
    ]);
    expect(release).toHaveBeenCalledOnce();
  });

  it("validates and accepts a format-specific feed artifact", async () => {
    const clientQuery = vi.fn(async (sql: string, _values?: unknown[]) => {
      if (["begin", "commit", "rollback"].includes(sql.trim())) return { rowCount: 0, rows: [] };
      if (sql.includes("from jobs")) return { rowCount: 1, rows: [runningJobRow()] };
      if (sql.includes("insert into storage_artifacts")) return { rowCount: 1, rows: [{ id: "artifact-1" }] };
      return { rowCount: 1, rows: [] };
    });
    const poolQuery = vi.fn(async () => ({ rowCount: 1, rows: [] }));
    const repository = createRepository({
      query: poolQuery,
      connect: vi.fn(async () => ({ query: clientQuery, release: vi.fn() }))
    } as any, {
      fetchInstagramImageManifest: async () => feedManifest(),
      fetchImageAsset: async () => new Response(null, { status: 200, headers: { "content-type": "image/png" } })
    });

    const result = await repository.completeImageRenderJob("job-1", {
      workerId: "worker-1",
      leaseToken: "lease-1",
      manifestUrl: "https://blob.example.com/rendered-content/instagram/brand-1/output-1/job-1/manifest.json"
    });

    expect(result).toEqual({ id: "job-1", status: "succeeded", artifactId: "artifact-1" });
    expect(clientQuery).toHaveBeenCalledWith(expect.stringContaining("output_json = $4::jsonb"), [
      "후기보다 먼저 볼 것",
      "후기보다 먼저 볼 것",
      "정방형 카드뉴스 1장 구성",
      expect.stringContaining('"sourceMode":"topic_only"'),
      "artifact-1",
      "pending_review",
      "output-1"
    ]);
    const lockedJobQuery = String(clientQuery.mock.calls.find(([sql]) => String(sql).includes("from jobs"))?.[0]);
    expect(lockedJobQuery).toContain("join channel_outputs");
    expect(lockedJobQuery).toContain("join topic_publish_groups");
    expect(lockedJobQuery).toContain("join brand_channels");
    expect(lockedJobQuery).toContain("for update of job, co");
    const outputUpdate = String(clientQuery.mock.calls.find(([sql]) => String(sql).includes("update channel_outputs"))?.[0]);
    expect(outputUpdate).toContain("block_reasons = coalesce(block_reasons, '[]'::jsonb) - 'instagram_artifact_pending'");
    const jobCompletion = String(clientQuery.mock.calls.find(([sql]) => (
      String(sql).includes("update jobs set status = 'succeeded'")
    ))?.[0]);
    expect(jobCompletion).toContain("last_error = null");
    expect(poolQuery).not.toHaveBeenCalled();
  });

  it.each([
    { outputStatus: "approved", autoApprovalEnabled: false, expectedStatus: "approved", approvalType: "manual" },
    { outputStatus: "auto_approval_blocked", autoApprovalEnabled: true, expectedStatus: "auto_approved", approvalType: "auto" },
    { outputStatus: "auto_approval_blocked", autoApprovalEnabled: false, expectedStatus: "pending_review", approvalType: null },
    { outputStatus: "rejected", autoApprovalEnabled: true, expectedStatus: "rejected", approvalType: null },
    { outputStatus: "regenerated", autoApprovalEnabled: true, expectedStatus: "regenerated", approvalType: null }
  ])("transitions $outputStatus to $expectedStatus after artifact completion", async ({
    outputStatus,
    autoApprovalEnabled,
    expectedStatus,
    approvalType
  }) => {
    const clientQuery = vi.fn(async (sql: string, _values?: unknown[]) => {
      if (["begin", "commit", "rollback"].includes(sql.trim())) return { rowCount: 0, rows: [] };
      if (sql.includes("from jobs")) {
        return { rowCount: 1, rows: [runningJobRow("instagram_feed_carousel", "worker-card.v4", { outputStatus, autoApprovalEnabled })] };
      }
      if (sql.includes("insert into storage_artifacts")) return { rowCount: 1, rows: [{ id: "artifact-1" }] };
      return { rowCount: 1, rows: [] };
    });
    const repository = createRepository({
      query: vi.fn(),
      connect: vi.fn(async () => ({ query: clientQuery, release: vi.fn() }))
    } as any, {
      fetchInstagramImageManifest: async () => feedManifest(),
      fetchImageAsset: async () => new Response(null, { status: 200, headers: { "content-type": "image/png" } })
    });

    await repository.completeImageRenderJob("job-1", {
      workerId: "worker-1",
      leaseToken: "lease-1",
      manifestUrl: "https://blob.example.com/rendered-content/instagram/brand-1/output-1/job-1/manifest.json"
    });

    const outputUpdate = clientQuery.mock.calls.find(([sql]) => String(sql).includes("update channel_outputs"));
    expect(outputUpdate?.[1]?.[5]).toBe(expectedStatus);
    expect(String(outputUpdate?.[0])).toContain("approved_at = case when status = 'auto_approval_blocked' and $6 = 'auto_approved' then now()");
    const queueInserts = clientQuery.mock.calls.filter(([sql]) => String(sql).includes("insert into publish_queue"));
    expect(queueInserts).toHaveLength(approvalType ? 1 : 0);
    if (approvalType) {
      expect(queueInserts[0]?.[1]).toEqual([
        "workspace-1",
        "brand-1",
        "output-1",
        "group-1",
        "instagram-channel-1",
        approvalType,
        `${approvalType}:output-1`
      ]);
      expect(String(queueInserts[0]?.[0])).toContain("on conflict (channel_output_id) do nothing");
      expect(String(queueInserts[0]?.[0])).not.toContain("scheduled_for");
    }
  });

  it("marks only an invalid Reel job failed and creates no fallback format job", async () => {
    const clientQuery = vi.fn(async (sql: string) => {
      if (["begin", "commit", "rollback"].includes(sql.trim())) return { rowCount: 0, rows: [] };
      if (sql.includes("from jobs")) {
        return { rowCount: 1, rows: [runningJobRow("instagram_reel", "worker-reel.v3")] };
      }
      return { rowCount: 1, rows: [] };
    });
    const repository = createRepository({
      query: vi.fn(),
      connect: vi.fn(async () => ({ query: clientQuery, release: vi.fn() }))
    } as any, {
      fetchInstagramImageManifest: async () => ({
        jobId: "job-1",
        channelOutputId: "output-1",
        deliveryFormat: "instagram_reel",
        promptVersion: "worker-reel.v3",
        sourceMode: "direct_url",
        fetchStatus: "fetched",
        selectedAssetCount: 1,
        validation: { passed: true },
        scenes: [{ role: "hook", url: "https://blob.example.com/scene-01.png" }]
      })
    });

    await expect(repository.completeImageRenderJob("job-1", {
      workerId: "worker-1",
      leaseToken: "lease-1",
      manifestUrl: "https://blob.example.com/rendered-content/instagram/brand-1/output-1/job-1/manifest.json"
    })).rejects.toThrow("reel_video_required");

    expect(clientQuery).toHaveBeenCalledWith(
      expect.stringContaining("set status = 'failed'"),
      ["job-1", "reel_video_required"]
    );
    expect(clientQuery.mock.calls.some(([sql]) => String(sql).includes("insert into jobs"))).toBe(false);
    expect(clientQuery.mock.calls.some(([sql]) => String(sql).includes("insert into storage_artifacts"))).toBe(false);
    expect(clientQuery.mock.calls.some(([sql]) => String(sql).includes("update channel_outputs"))).toBe(false);
    expect(clientQuery.mock.calls.some(([sql]) => String(sql).includes("insert into publish_queue"))).toBe(false);
  });

  it("regenerates only the existing Story delivery format", async () => {
    const clientQuery = vi.fn(async (sql: string, _values?: unknown[]) => {
      if (["begin", "commit", "rollback"].includes(sql.trim())) return { rowCount: 0, rows: [] };
      if (sql.trimStart().startsWith("with updated as")) {
        return {
          rowCount: 1,
          rows: [{
            id: "output-1",
            status: "regenerating",
            workspace_id: "workspace-1",
            brand_id: "brand-1",
            content_topic_id: "topic-1",
            master_draft_id: "draft-1",
            channel: "instagram",
            delivery_format: "instagram_story",
            title: "기존 스토리",
            output_json: { deliveryFormat: "instagram_story", artifactStatus: "ready" },
            source_summary: "source summary",
            brand_channel_id: "channel-1",
            topic_publish_group_id: "group-1",
            brand_name: "Brand",
            category_code: "travel_tourism",
            category_name: "여행·관광",
            subcategories: [{ type: "system", code: "travel_consulting", name: "여행 상담" }],
            primary_customer: "families",
            description: "travel planning",
            tone: "clear",
            brand_color: "blue",
            draft_json: { title: "기존 스토리", contentTheme: "동선" },
            topic_title: "제주 동선",
            topic_angle: "가족 여행",
            target_customer: "families",
            region: "Jeju",
            season: null,
            reference_url: "https://reference.example.com/story",
            notes: null,
            crawl_content_url: null
          }]
        };
      }
      if (sql.includes("insert into channel_outputs")) return { rowCount: 1, rows: [{ id: "output-story-2" }] };
      return { rowCount: 1, rows: [] };
    });
    const repository = createRepository({
      query: vi.fn(),
      connect: vi.fn(async () => ({ query: clientQuery, release: vi.fn() }))
    } as any);

    await repository.reviewContentOutput("output-1", "regenerate");

    const reviewEventIndex = clientQuery.mock.calls.findIndex(([sql]) => String(sql).includes("insert into review_events"));
    const regeneratedStatusIndex = clientQuery.mock.calls.findIndex(([sql]) => String(sql).includes("set status = 'regenerated'"));
    const groupResetIndex = clientQuery.mock.calls.findIndex(([sql]) => (
      String(sql).includes("update topic_publish_groups") && String(sql).includes("status = 'waiting'")
    ));
    const outputInsertIndex = clientQuery.mock.calls.findIndex(([sql]) => String(sql).includes("insert into channel_outputs"));
    expect(reviewEventIndex).toBeGreaterThan(-1);
    expect(regeneratedStatusIndex).toBeGreaterThan(reviewEventIndex);
    expect(groupResetIndex).toBeGreaterThan(regeneratedStatusIndex);
    expect(outputInsertIndex).toBeGreaterThan(groupResetIndex);
    expect(clientQuery.mock.calls[groupResetIndex]?.[1]).toEqual(["group-1"]);
    expect(clientQuery.mock.calls[reviewEventIndex]?.[1]).toEqual([
      "workspace-1", "brand-1", "output-1", "regenerate_requested", null
    ]);
    const outputInsert = clientQuery.mock.calls.find(([sql]) => String(sql).includes("insert into channel_outputs"));
    expect(outputInsert?.[1]).toContain("instagram_story");
    const jobInserts = clientQuery.mock.calls.filter(([sql]) => String(sql).includes("insert into jobs"));
    expect(jobInserts).toHaveLength(1);
    expect(jobInserts[0]?.[1]?.[4]).toBe("instagram_story_render");
    const payload = JSON.parse(String(jobInserts[0]?.[1]?.[5]));
    expect(payload).toMatchObject({
      deliveryFormat: "instagram_story",
      promptVersion: "worker-story.v1",
      representativeUrl: "https://reference.example.com/story",
      brand: { categoryContext: "여행·관광 / 여행 상담" }
    });
  });
});
