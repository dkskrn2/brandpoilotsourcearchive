import { describe, expect, it } from "vitest";
import type { PublishItem } from "../../types";
import { datedItems, entryFromPublishItem, listItems, unreservedItems } from "./publishItems";

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
