import { describe, expect, it, vi } from "vitest";
import { createPublishItemsRepository } from "./publishItemsRepository.js";

describe("publish items repository", () => {
  it("uses one workspace-and-brand-scoped canonical query", async () => {
    const query = vi.fn(async (_sql: string, _params?: unknown[]) => ({ rows: [], rowCount: 0 }));
    const repository = createPublishItemsRepository({ query } as never);

    await expect(repository.listPublishItems({
      workspaceId: "10000000-0000-4000-8000-000000000001",
      brandId: "20000000-0000-4000-8000-000000000001",
    })).resolves.toEqual([]);

    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0]?.[1]).toEqual([
      "10000000-0000-4000-8000-000000000001",
      "20000000-0000-4000-8000-000000000001",
    ]);
  });

  it("keeps cancelled slot history hidden and not schedulable", async () => {
    const query = vi.fn(async () => ({
      rowCount: 1,
      rows: [{
        item_key: "topic:topic-1", workspace_id: "workspace-1", brand_id: "brand-1",
        title: "취소 콘텐츠", created_at: "2026-08-20T00:00:00.000Z", content_format: "card_news",
        content_status: "completed", content_topic_id: "topic-1", proposal_id: null,
        generation_id: null, generation_output_id: null, source_type: "unknown", source_label: "근거 없음",
        source_detail: null, source_urls: [], base_schedulable: true,
        calendar_slot_id: "slot-1", slot_scheduled_for: "2026-08-21T00:00:00.000Z",
        assignment_mode: "manual", slot_status: "cancelled", group_status: "cancelled",
        slot_group_id: "group-1", source_group_id: "group-1", group_content_topic_id: "topic-1",
        slot_channels: ["instagram"], slot_content_format: "card_news", slot_last_error: null,
        slot_proposal_id: null, queue_id: null,
      }],
    }));
    const repository = createPublishItemsRepository({ query } as never);

    await expect(repository.listPublishItems({ workspaceId: "workspace-1", brandId: "brand-1" }))
      .resolves.toEqual([expect.objectContaining({
        status: "cancelled", calendarDate: null, calendarPlacement: "hidden", schedulable: false,
        sourceRefs: expect.objectContaining({ calendarSlotId: "slot-1", topicPublishGroupId: "group-1" }),
      })]);
  });

  it("preserves a ready group without queues as publish queued", async () => {
    const query = vi.fn(async () => ({
      rowCount: 1,
      rows: [{
        item_key: "topic:topic-2", workspace_id: "workspace-1", brand_id: "brand-1",
        title: "준비 콘텐츠", created_at: "2026-08-20T00:00:00.000Z", content_format: "reel",
        content_status: "completed", content_topic_id: "topic-2", proposal_id: null,
        generation_id: null, generation_output_id: null, source_type: "unknown", source_label: "근거 없음",
        source_detail: null, source_urls: [], base_schedulable: true, calendar_slot_id: null,
        group_status: "ready", source_group_id: "group-2", group_content_topic_id: "topic-2", queue_id: null,
      }],
    }));
    const repository = createPublishItemsRepository({ query } as never);

    await expect(repository.listPublishItems({ workspaceId: "workspace-1", brandId: "brand-1" }))
      .resolves.toEqual([expect.objectContaining({
        status: "publish_queued", calendarPlacement: "hidden", schedulable: false,
        sourceRefs: expect.objectContaining({ topicPublishGroupId: "group-2" }),
      })]);
  });

  it("does not treat a slot-less waiting group as a reservation", async () => {
    const query = vi.fn(async () => ({
      rowCount: 1,
      rows: [{
        item_key: "topic:topic-3", workspace_id: "workspace-1", brand_id: "brand-1",
        title: "대기 콘텐츠", created_at: "2026-08-20T00:00:00.000Z", content_format: "card_news",
        content_status: "pre_generation", content_topic_id: "topic-3", proposal_id: null,
        generation_id: null, generation_output_id: null, source_type: "unknown", source_label: "근거 없음",
        source_detail: null, source_urls: [], base_schedulable: true, calendar_slot_id: null,
        group_status: "waiting", source_group_id: "group-3", group_content_topic_id: "topic-3", queue_id: null,
      }],
    }));
    const repository = createPublishItemsRepository({ query } as never);

    await expect(repository.listPublishItems({ workspaceId: "workspace-1", brandId: "brand-1" }))
      .resolves.toEqual([expect.objectContaining({
        status: "pre_generation", calendarPlacement: "unreserved", schedulable: true,
        sourceRefs: expect.objectContaining({ topicPublishGroupId: "group-3" }),
      })]);
  });
});
