import { describe, expect, it } from "vitest";
import type { PublishItem } from "../../types";
import { canReschedulePublishItem, datedItems, entryFromPublishItem, listItems, unreservedItems } from "./publishItems";

const item = (overrides: Partial<PublishItem> = {}): PublishItem => ({
  itemKey: "output:one",
  workspaceId: "workspace-1",
  brandId: "brand-1",
  title: "SNS 마케팅 콘텐츠",
  createdAt: "2026-08-20T00:00:00.000Z",
  contentFormat: "card_news",
  channels: ["instagram"],
  source: { type: "topic_table", label: "주제표", detail: null, urls: [] },
  targets: [],
  reviewTargets: [],
  contentStatus: "completed",
  publishStatus: "scheduled",
  status: "scheduled",
  operationalStatus: "upcoming",
  operationalReason: "future_reservation",
  groupStatus: "ready",
  publicationProgress: "none",
  scheduledFor: "2026-08-23T02:30:00.000Z",
  effectiveScheduledFor: "2026-08-23T03:00:00.000Z",
  publishedAt: null,
  calendarDate: "2026-08-24T04:00:00.000Z",
  calendarPlacement: "dated",
  assignmentMode: "manual",
  sourceRefs: { contentTopicId: null, proposalId: null, generationId: null, generationOutputId: "output-1", calendarSlotId: "slot-1", topicPublishGroupId: null, queueIds: [] },
  schedulable: false,
  scheduleBlockedReason: "already_reserved",
  lastError: null,
  ...overrides
});

describe("publish item derivations", () => {
  it("allows a delayed-today reservation when publication has not started and every target is still queued or scheduled", () => {
    const delayed = item({
      operationalStatus: "delayed_today",
      operationalReason: "reserved_time_passed",
      status: "deferred",
      publishStatus: "deferred",
      scheduledFor: "2026-08-25T05:30:00.000Z",
      effectiveScheduledFor: "2026-08-25T05:45:00.000Z",
      publicationProgress: "none",
      targets: [
        { queueId: "queue-1", channelOutputId: "output-1", channel: "instagram", status: "queued", scheduledFor: "2026-08-25T05:30:00.000Z", publishedAt: null, failedAt: null, lastError: null, externalPostId: null, externalUrl: null, previewTitle: null, previewBody: null, outputJson: {}, artifactPublicUrl: null, sourceSummary: null },
        { queueId: "queue-2", channelOutputId: "output-2", channel: "threads", status: "scheduled", scheduledFor: "2026-08-25T05:30:00.000Z", publishedAt: null, failedAt: null, lastError: null, externalPostId: null, externalUrl: null, previewTitle: null, previewBody: null, outputJson: {}, artifactPublicUrl: null, sourceSummary: null },
      ],
    });

    expect(canReschedulePublishItem(delayed)).toBe(true);
  });

  it.each([
    ["action_required", "review_required"],
    ["action_required", "publish_failed"],
    ["action_required", "result_unknown"],
    ["publishing", "publishing"],
    ["partially_published", "partially_published"],
    ["published", "published"],
    ["cancelled", "cancelled"],
  ] as const)("rejects %s/%s even when the previous status and time look schedulable", (operationalStatus, operationalReason) => {
    const blocked = item({
      operationalStatus,
      operationalReason,
      scheduledFor: "2099-08-25T06:00:00.000Z",
    });

    expect(canReschedulePublishItem(blocked)).toBe(false);
  });

  it("rejects any publication progress or target state outside the repository-safe queue states", () => {
    expect(canReschedulePublishItem(item({ publicationProgress: "partial" }))).toBe(false);
    expect(canReschedulePublishItem(item({
      targets: [{ queueId: "queue-1", channelOutputId: "output-1", channel: "instagram", status: "failed", scheduledFor: null, publishedAt: null, failedAt: "2026-08-25T06:00:00.000Z", lastError: "publish_failed", externalPostId: null, externalUrl: null, previewTitle: null, previewBody: null, outputJson: {}, artifactPublicUrl: null, sourceSummary: null }],
    }))).toBe(false);
  });

  it("sorts without mutating and partitions by the server placement", () => {
    const hidden = item({ itemKey: "hidden", calendarPlacement: "hidden", calendarDate: null, createdAt: "2026-08-22T00:00:00.000Z" });
    const unreserved = item({ itemKey: "unreserved", calendarPlacement: "unreserved", calendarDate: null, scheduledFor: null, effectiveScheduledFor: null, createdAt: "2026-08-21T00:00:00.000Z" });
    const dated = item();
    const input = [unreserved, hidden, dated];

    expect(listItems(input).map(({ itemKey }) => itemKey)).toEqual(["output:one", "hidden", "unreserved"]);
    expect(input).toEqual([unreserved, hidden, dated]);
    expect(datedItems(input)).toEqual([dated]);
    expect(unreservedItems(input)).toEqual([unreserved]);
  });

  it("uses calendarDate rather than creation or generation scheduling timestamps", () => {
    expect(entryFromPublishItem(item())).toMatchObject({
      id: "output:one",
      calendarDate: "2026-08-24T04:00:00.000Z",
      scheduledFor: "2026-08-23T02:30:00.000Z",
      effectiveScheduledFor: "2026-08-23T03:00:00.000Z",
      title: "SNS 마케팅 콘텐츠",
      status: "scheduled",
      mode: "manual"
    });
  });

  it("rejects an item without a server calendar date", () => {
    expect(() => entryFromPublishItem(item({ calendarPlacement: "unreserved", calendarDate: null }))).toThrow("publish_item_not_dated");
  });
});
