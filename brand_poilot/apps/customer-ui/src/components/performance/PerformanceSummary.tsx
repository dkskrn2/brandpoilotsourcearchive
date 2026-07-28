import type { PerformanceInsights } from "../../types";

export function PerformanceSummary({ insights }: { insights: PerformanceInsights }) {
  return (
    <section className="performance-summary" aria-label="성과 요약">
      <div><span>분석 상태</span><strong>{insights.summary.dataStatus === "sufficient" ? "분석 가능" : "데이터 부족"}</strong></div>
      <div><span>측정 콘텐츠</span><strong>{insights.summary.measuredContentCount.toLocaleString("ko-KR")}건</strong></div>
      <div><span>측정 표본</span><strong>{insights.sampleSize.toLocaleString("ko-KR")}건</strong></div>
      <div><span>누적 노출</span><strong>{insights.summary.totalExposure?.toLocaleString("ko-KR") ?? "미수집"}회</strong></div>
    </section>
  );
}
