import { describe, expect, it } from "vitest";
import type { AiContentUsage } from "../ai-content/types";
import type { BrandUiStatus, Dashboard } from "../../types";
import { createDashboardViewModel } from "./dashboardViewModel";

const dashboard: Dashboard = {
  period: "30d",
  generatedAt: "2026-07-16T04:00:00.000Z",
  lastCollectedAt: "2026-07-16T03:00:00.000Z",
  summary: {
    publishedCount: 12,
    exposureCount: 8430,
    pendingReviewCount: 3,
    failedPublishCount: 1,
  },
  workflow: {
    queuedTopics: 8,
    generating: 2,
    pendingReview: 3,
    scheduledOrPublished: 12,
  },
  dailyExposure: [],
  channelPerformance: [],
  topContents: [],
  attentionItems: [{ type: "sync_failed", channel: "threads", message: "internal" }],
};

const brandStatus: BrandUiStatus = {
  brandId: "brand-1",
  brandName: "모종",
  logoUrl: null,
  lastGeneratedAt: null,
  navigation: {
    onboardingRemaining: 2,
    contentReview: 3,
    publishIssues: 1,
    channelIssues: 4,
  },
  onboarding: {
    completedCount: 3,
    totalCount: 5,
    remainingCount: 2,
    steps: [],
  },
};

const usage: AiContentUsage = {
  generationUsed: 4,
  generationLimit: 10,
  newDownloadUsed: 7,
  newDownloadLimit: 20,
  resetsAt: "2026-07-17T00:00:00+09:00",
};

describe("createDashboardViewModel", () => {
  it("builds honest operational cards and sorts actionable priorities by severity", () => {
    const result = createDashboardViewModel({ dashboard, brandStatus, usage });

    expect(result.kpis.map((item) => [item.label, item.value])).toEqual([
      ["발행 완료", 12],
      ["조회·노출", 8430],
      ["검토 필요", 3],
      ["게시 실패", 1],
    ]);
    expect(result.priorities.map((item) => item.kind)).toEqual([
      "publish_failure",
      "brand_review",
      "channel_attention",
      "content_review",
    ]);
    expect(result.priorities[0]).toMatchObject({
      count: 1,
      href: "/publish-queue?status=failed",
      actionLabel: "실패 확인",
    });
    expect(result.usage).toEqual(usage);
    expect(result.performance.lastCollectedAt).toBe(dashboard.lastCollectedAt);
  });

  it("does not invent brand, DM, usage, or exposure data when no source exists", () => {
    const result = createDashboardViewModel({
      dashboard: {
        ...dashboard,
        summary: { ...dashboard.summary, exposureCount: null },
      },
      brandStatus: null,
      usage: null,
    });

    expect(result.kpis.find((item) => item.label === "조회·노출")?.value).toBeNull();
    expect(result.priorities.some((item) => item.kind === "brand_review")).toBe(false);
    expect(result.priorities.some((item) => item.kind === "dm_attention")).toBe(false);
    expect(result.usage).toBeNull();
  });
});
