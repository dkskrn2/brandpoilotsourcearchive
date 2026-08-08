import { describe, expect, it } from "vitest";
import { buildPerformanceInsights } from "./performanceInsights.js";

const brandId = "22222222-2222-4222-8222-222222222222";

function snapshot(
  id: string,
  measurementWindow: "24h" | "72h" | "7d",
  exposureCount: number,
  overrides: Record<string, unknown> = {},
) {
  return {
    id,
    brandId,
    publishQueueId: `queue-${id}`,
    title: `콘텐츠 ${id}`,
    channel: "instagram" as const,
    deliveryFormat: "instagram_feed_carousel",
    measurementWindow,
    exposureCount,
    rawMetrics: {},
    contentFeatures: { strategy: "problem_solution", format: "card_news", hook: `hook-${id}` },
    collectedAt: `2026-07-2${id}T03:00:00.000Z`,
    ...overrides,
  };
}

describe("buildPerformanceInsights", () => {
  it("separates measured observations, interpretations, and user-approved experiments", () => {
    const result = buildPerformanceInsights({
      brandId,
      period: "30d",
      snapshots: [
        snapshot("1", "24h", 100),
        snapshot("2", "72h", 250),
        snapshot("3", "7d", 600),
      ],
    });

    expect(result.sampleSize).toBe(3);
    expect(result.summary.dataStatus).toBe("sufficient");
    expect(result.windows.map((window) => [window.window, window.sampleSize, window.averageExposure]))
      .toEqual([["24h", 1, 100], ["72h", 1, 250], ["7d", 1, 600]]);
    expect(result.observations[0]).toMatchObject({
      kind: "observation",
      metric: { name: "평균 노출", sampleSize: 3 },
      interpretation: { kind: "interpretation", confidence: "medium" },
    });
    expect(result.experiments[0]).toMatchObject({
      kind: "experiment",
      performanceSnapshotIds: ["1", "2", "3"],
      evidenceVersion: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
  });

  it("changes the evidence version when mutable authoritative evidence changes", () => {
    const original = [snapshot("1", "24h", 100), snapshot("2", "72h", 250), snapshot("3", "7d", 600)];
    const first = buildPerformanceInsights({ brandId, period: "30d", snapshots: original });
    const second = buildPerformanceInsights({
      brandId,
      period: "30d",
      snapshots: original.map((item, index) => index === 1
        ? { ...item, rawMetrics: { likes: 99 }, updatedAt: "2026-07-29T03:00:00.000Z" }
        : item),
    });

    expect(first.experiments[0]?.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(second.experiments[0]?.evidenceVersion).not.toBe(first.experiments[0]?.evidenceVersion);
  });

  it("reports insufficient data without presenting an improvement conclusion", () => {
    const result = buildPerformanceInsights({
      brandId,
      period: "30d",
      snapshots: [snapshot("1", "24h", 100), snapshot("2", "72h", 250)],
    });

    expect(result.summary.dataStatus).toBe("insufficient");
    expect(result.observations[0]?.interpretation).toBeNull();
    expect(result.experiments).toEqual([]);
  });

  it("does not double-count multiple milestone snapshots from the same content in the summary", () => {
    const result = buildPerformanceInsights({
      brandId,
      period: "30d",
      snapshots: [
        snapshot("1", "24h", 100, { publishQueueId: "queue-shared", collectedAt: "2026-07-21T03:00:00.000Z" }),
        snapshot("2", "72h", 250, { publishQueueId: "queue-shared", collectedAt: "2026-07-23T03:00:00.000Z" }),
        snapshot("3", "7d", 600, { publishQueueId: "queue-shared", collectedAt: "2026-07-27T03:00:00.000Z" }),
      ],
    });

    expect(result.summary).toEqual({
      dataStatus: "insufficient",
      measuredContentCount: 1,
      totalExposure: 600,
    });
  });

  it("rejects snapshot evidence owned by another brand", () => {
    expect(() => buildPerformanceInsights({
      brandId,
      period: "30d",
      snapshots: [snapshot("1", "24h", 100, { brandId: "33333333-3333-4333-8333-333333333333" })],
    })).toThrow("performance_snapshot_tenant_mismatch");
  });

  it("compares strategy, format, hook, and appeal only when orchestration metadata exists", () => {
    const result = buildPerformanceInsights({
      brandId,
      period: "30d",
      snapshots: [
        snapshot("1", "24h", 100, { contentFeatures: { strategy: "how_to", format: "card_news", hook: "질문형", appeal: "편의성" } }),
        snapshot("2", "24h", 200, { contentFeatures: { strategy: "how_to", format: "blog", hook: "질문형", appeal: "신뢰" } }),
        snapshot("3", "24h", 300, { contentFeatures: { strategy: "comparison", format: "blog", hook: "숫자형", appeal: "신뢰" } }),
      ],
    });

    expect(result.observations.map((observation) => observation.label)).toEqual(expect.arrayContaining([
      "strategy별 평균 노출",
      "format별 평균 노출",
      "hook별 평균 노출",
      "appeal별 평균 노출",
    ]));
  });
});
