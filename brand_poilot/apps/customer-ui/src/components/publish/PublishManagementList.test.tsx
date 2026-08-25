import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { PublishItem } from "../../types";
import { PublishManagementList } from "./PublishManagementList";

function publishItem(index: number, overrides: Partial<PublishItem> = {}): PublishItem {
  return {
    itemKey: `item-${index}`,
    workspaceId: "workspace-1",
    brandId: "brand-1",
    title: `게시 항목 ${index}`,
    createdAt: new Date(Date.UTC(2026, 7, 25, 0, 0, index)).toISOString(),
    contentFormat: "card_news",
    channels: [],
    source: { type: "unknown", label: "직접 생성", detail: null, urls: [] },
    targets: [],
    reviewTargets: [],
    contentStatus: "completed",
    publishStatus: "unreserved",
    status: "completed_unpublished",
    operationalStatus: "action_required",
    operationalReason: "review_required",
    groupStatus: null,
    publicationProgress: "none",
    scheduledFor: null,
    effectiveScheduledFor: null,
    publishedAt: null,
    calendarDate: null,
    calendarPlacement: "unreserved",
    assignmentMode: null,
    sourceRefs: {
      contentTopicId: null,
      proposalId: null,
      generationId: null,
      generationOutputId: null,
      calendarSlotId: null,
      topicPublishGroupId: null,
      queueIds: [],
    },
    schedulable: true,
    scheduleBlockedReason: null,
    lastError: null,
    ...overrides,
  };
}

function renderList(items: PublishItem[], highlightedQueueId: string | null = null) {
  return render(
    <PublishManagementList
      items={items}
      initialFilter="action_required"
      highlightedQueueId={highlightedQueueId}
      onSelectResult={vi.fn()}
      onSelectReviewTarget={vi.fn()}
      onReviewTargets={vi.fn()}
      reviewingOutputIds={new Set()}
      onRetryPublish={vi.fn()}
      onVerifyPublish={vi.fn()}
      onCancelPublish={vi.fn()}
      onSchedule={vi.fn()}
      onReschedule={vi.fn()}
    />,
  );
}

describe("PublishManagementList", () => {
  it("renders at most 30 items at a time and resets the window after a filter change", async () => {
    renderList(Array.from({ length: 306 }, (_, index) => publishItem(index)));

    expect(await screen.findAllByRole("article")).toHaveLength(30);
    await userEvent.click(screen.getByRole("button", { name: "더 보기" }));
    expect(screen.getAllByRole("article")).toHaveLength(60);
    await userEvent.click(screen.getByRole("button", { name: /전체/ }));
    expect(screen.getAllByRole("article")).toHaveLength(30);
  });

  it("keeps an out-of-window highlighted deep link reachable without rendering the full list", async () => {
    const items = Array.from({ length: 306 }, (_, index) => publishItem(index));
    items[0] = publishItem(0, {
      targets: [{
        queueId: "queue-highlighted",
        channelOutputId: "output-highlighted",
        channel: "instagram",
        status: "scheduled",
        scheduledFor: "2026-08-26T02:30:00.000Z",
        publishedAt: null,
        failedAt: null,
        lastError: null,
        externalPostId: null,
        externalUrl: null,
        previewTitle: null,
        previewBody: null,
        outputJson: {},
        artifactPublicUrl: null,
        sourceSummary: null,
      }],
    });

    renderList(items, "queue-highlighted");

    expect(await screen.findAllByRole("article")).toHaveLength(30);
    expect(screen.getByRole("article", { name: "게시 항목 0" })).toHaveAttribute("data-publish-deep-link", "true");
  });
});
