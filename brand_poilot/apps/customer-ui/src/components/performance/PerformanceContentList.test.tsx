import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { PerformanceInsights } from "../../types";
import { PerformanceContentList } from "./PerformanceContentList";

type Content = PerformanceInsights["topContents"][number];

const content: Content = {
  publishQueueId: "queue-1",
  title: "좋았던 콘텐츠",
  channel: "instagram",
  deliveryFormat: "instagram_feed_carousel",
  exposureCount: 600,
  snapshotId: "snapshot-1",
  externalUrl: null,
};

describe("PerformanceContentList", () => {
  it("keeps channel, format, and exposure in the row's accessible description", () => {
    render(<PerformanceContentList contents={[content]} onOpen={vi.fn()} />);

    const row = screen.getByRole("button", { name: "좋았던 콘텐츠 상세 보기" });
    expect(row).toHaveAccessibleDescription("Instagram · 카드뉴스 600회");
  });
});
