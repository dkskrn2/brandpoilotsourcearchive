import type { PerformanceInsights } from "../../types";

export function createPerformanceViewModel(insights: PerformanceInsights) {
  return {
    dataStatusLabel: insights.summary.dataStatus === "sufficient" ? "분석 가능" : "데이터 부족",
    observations: insights.observations.map((item) => ({
      id: item.id,
      observation: `${item.metric.name} ${item.metric.value === null ? "미수집" : `${item.metric.value.toLocaleString("ko-KR")}${item.metric.unit}`} · 표본 ${item.metric.sampleSize}건`,
      interpretation: item.interpretation?.statement ?? "아직 해석하지 않습니다.",
      confidence: item.interpretation?.confidence ?? null,
    })),
    experiments: insights.experiments,
  };
}
