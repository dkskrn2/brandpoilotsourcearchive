import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TopicPublishGroup, type TopicPublishGroupModel } from "./TopicPublishGroup";
import type { ChannelType, DeliveryFormat, PublishSlot } from "../../types";

afterEach(cleanup);

const channelFormats: Array<[ChannelType, DeliveryFormat, string]> = [
  ["instagram", "instagram_feed_carousel", "Instagram · 카드뉴스"],
  ["threads", "threads_text", "Threads · 텍스트"],
  ["x", "x_post", "X · 게시물"],
  ["linkedin", "linkedin_post", "LinkedIn · 게시물"],
  ["youtube", "youtube_short", "YouTube · Short"],
  ["tiktok", "tiktok_video", "TikTok · 영상"]
];

describe("TopicPublishGroup", () => {
  it("labels all supported channels and delivery formats", () => {
    const group: TopicPublishGroupModel = {
      id: "group-1",
      title: "멀티채널 주제",
      scheduledFor: null,
      slotNumber: 1,
      items: channelFormats.map(([channel, deliveryFormat], index) => ({
        slot: {
          id: `slot-${index}`,
          channel,
          time: "대기",
          title: "멀티채널 주제",
          approvalType: "manual",
          status: "queued",
          sourceType: "topic_table",
          sourceLabel: "주제표",
          sourceDetail: null,
          sourceUrls: [],
          queuedAt: "2026-07-15T00:00:00.000Z",
          lastError: null
        } satisfies PublishSlot,
        result: null,
        resultChannel: {
          queueId: `slot-${index}`,
          channelOutputId: `output-${index}`,
          channel,
          status: "queued",
          publishedAt: null,
          failedAt: null,
          title: "멀티채널 주제",
          previewTitle: null,
          previewBody: null,
          outputJson: { deliveryFormat },
          artifactPublicUrl: null,
          externalPostId: null,
          externalUrl: null,
          lastError: null,
          sourceSummary: null
        }
      }))
    };

    render(<TopicPublishGroup group={group} onSelectResult={vi.fn()} />);

    expect(screen.getByRole("article", { name: "멀티채널 주제" })).toHaveClass("publish-management-card");
    for (const [, , label] of channelFormats) expect(screen.getByText(label)).toBeVisible();
  });

  it("shows the actual published time for a published child channel", () => {
    const publishedAt = "2026-07-15T02:30:00.000Z";
    const resultChannel = {
      queueId: "slot-published",
      channelOutputId: "output-published",
      channel: "instagram" as const,
      status: "published" as const,
      publishedAt,
      failedAt: null,
      title: "게시 완료 주제",
      previewTitle: null,
      previewBody: null,
      outputJson: { deliveryFormat: "instagram_feed_carousel" },
      artifactPublicUrl: null,
      externalPostId: "post-1",
      externalUrl: null,
      lastError: null,
      sourceSummary: null
    };
    const group: TopicPublishGroupModel = {
      id: "group-published",
      title: "게시 완료 주제",
      scheduledFor: "2026-07-15T01:30:00.000Z",
      slotNumber: 1,
      items: [{
        slot: {
          id: "slot-published",
          channel: "instagram",
          time: "11:30",
          title: "게시 완료 주제",
          approvalType: "manual",
          status: "published",
          sourceType: "topic_table",
          sourceLabel: "주제표",
          sourceDetail: null,
          sourceUrls: [],
          queuedAt: "2026-07-15T00:00:00.000Z",
          lastError: null
        },
        result: {
          contentId: "content-published",
          title: "게시 완료 주제",
          generatedAt: "2026-07-15T00:00:00.000Z",
          sourceType: "topic_table",
          sourceLabel: "주제표",
          sourceDetail: null,
          sourceUrls: [],
          channels: [resultChannel]
        },
        resultChannel
      }]
    };

    render(<TopicPublishGroup group={group} onSelectResult={vi.fn()} />);

    const expected = new Date(publishedAt).toLocaleString("ko-KR", {
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
    expect(screen.getByText(`게시일시 ${expected}`)).toBeVisible();
    expect(screen.getByRole("button", { name: "Instagram · 카드뉴스 상세" })).toBeEnabled();
  });
});
