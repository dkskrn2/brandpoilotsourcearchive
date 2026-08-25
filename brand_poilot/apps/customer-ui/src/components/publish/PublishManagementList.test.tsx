import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { PublishItem } from "../../types";
import { PublishManagementList, type PublishManagementListFilterId } from "./PublishManagementList";

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
  function ListHarness() {
    const [activeFilter, setActiveFilter] = useState<PublishManagementListFilterId>("action_required");
    return <PublishManagementList
      items={items}
      activeFilter={activeFilter}
      onFilterChange={setActiveFilter}
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
    />;
  }

  return render(<ListHarness />);
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

  it("keeps more available when an outside highlight displaces the thirtieth filtered item", async () => {
    const filtered = Array.from({ length: 30 }, (_, index) => publishItem(index + 1));
    const highlighted = publishItem(0, {
      operationalStatus: "upcoming",
      operationalReason: "future_reservation",
      publishStatus: "scheduled",
      status: "scheduled",
      targets: [{
        queueId: "queue-outside-filter",
        channelOutputId: "output-outside-filter",
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

    renderList([...filtered, highlighted], "queue-outside-filter");

    expect(await screen.findAllByRole("article")).toHaveLength(30);
    expect(screen.queryByRole("article", { name: "게시 항목 1" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "더 보기" }));
    expect(screen.getAllByRole("article")).toHaveLength(31);
    expect(screen.getByRole("article", { name: "게시 항목 1" })).toBeVisible();
  });
});
