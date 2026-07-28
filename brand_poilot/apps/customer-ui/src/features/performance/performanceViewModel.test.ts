import { describe, expect, it } from "vitest";
import { createPerformanceViewModel } from "./performanceViewModel";
import type { PerformanceInsights } from "../../types";

const insights: PerformanceInsights = {
  period: "30d",
  summary: { dataStatus: "sufficient", measuredContentCount: 3, totalExposure: 950 },
  windows: [{ window: "24h", sampleSize: 3, averageExposure: 317 }],
  observations: [{
    id: "average-exposure",
    kind: "observation",
    label: "평균 노출",
    metric: { name: "평균 노출", value: 317, unit: "회", sampleSize: 3 },
    evidenceSnapshotIds: ["snapshot-1", "snapshot-2", "snapshot-3"],
    interpretation: { kind: "interpretation", statement: "24h 구간이 높았습니다.", confidence: "medium" },
  }],
  experiments: [{
    id: "experiment-1",
    kind: "experiment",
    title: "성과 패턴 재사용",
    hypothesis: "초기 노출을 개선합니다.",
    contentFamily: "informational",
    channelTargets: ["instagram"],
    outputFormats: ["card_news"],
    performanceSnapshotIds: ["snapshot-1"],
  }],
  sampleSize: 3,
  lastCollectedAt: "2026-07-28T03:00:00.000Z",
  topContents: [],
};

describe("createPerformanceViewModel", () => {
  it("keeps observations, interpretations and next experiments visibly separate", () => {
    expect(createPerformanceViewModel(insights)).toMatchObject({
      dataStatusLabel: "분석 가능",
      observations: [{ observation: "평균 노출 317회 · 표본 3건", interpretation: "24h 구간이 높았습니다." }],
      experiments: [{ title: "성과 패턴 재사용" }],
    });
  });

  it("uses a data-shortage message and removes conclusions for a small sample", () => {
    const result = createPerformanceViewModel({
      ...insights,
      summary: { ...insights.summary, dataStatus: "insufficient" },
      observations: [{ ...insights.observations[0], interpretation: null }],
      experiments: [],
    });

    expect(result.dataStatusLabel).toBe("데이터 부족");
    expect(result.observations[0].interpretation).toBe("아직 해석하지 않습니다.");
    expect(result.experiments).toEqual([]);
  });
});
